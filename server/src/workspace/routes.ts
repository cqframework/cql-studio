// Author: Preston Lee

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  Prisma,
  WorkspacePrincipalType,
  WorkspaceRole,
  WorkspaceVisibility,
} from '@prisma/client';
import { getPrisma } from '../db/prisma.js';
import type { ServerEnv } from '../config/env.js';
import { requireAuth } from '../auth/session.js';
import {
  countOwners,
  listAccessibleWorkspaceIds,
  recordActivity,
  resolveEffectiveWorkspaceRole,
  roleAtLeast,
  uniqueSlug,
} from './access.js';
import {
  fillActivitySeriesBuckets,
  parseWorkspaceActivityPageQuery,
  parseWorkspaceActivityStatsQuery,
  WorkspaceActivityStatsInterval,
  WorkspaceActivityStatsMetric,
  WorkspaceActivityTargetType,
  WorkspaceActivityVerb,
} from './activity.js';
import {
  addressesFromConfig,
  configFromStoredEnvironment,
  headerRowsFromConfig,
  normalizeSharedEnvironmentConfig,
} from '../user/environment-persist.js';

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const sharedEnvInclude = {
  headers: {
    orderBy: [{ name: 'asc' as const }],
  },
};

function sharedEnvironmentDto(row: {
  id: string;
  workspaceId: string;
  name: string;
  evaluationServerAddress: string;
  dataEndpointAddress: string;
  terminologyEndpointAddress: string;
  contentEndpointAddress: string;
  createdAt: Date;
  updatedAt: Date;
  headers: Array<{ endpointRole: 'EVALUATION' | 'DATA' | 'TERMINOLOGY' | 'CONTENT'; name: string; value: string }>;
}) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    config: configFromStoredEnvironment(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseRole(raw: unknown): WorkspaceRole | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const upper = raw.toUpperCase();
  if (upper === 'OWNER' || upper === 'EDITOR' || upper === 'VIEWER') {
    return upper as WorkspaceRole;
  }
  return null;
}

function parsePrincipalType(raw: unknown): WorkspacePrincipalType | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const upper = raw.toUpperCase();
  if (upper === 'USER' || upper === 'TEAM') {
    return upper as WorkspacePrincipalType;
  }
  return null;
}

export function createWorkspaceRouter(env: ServerEnv): Router {
  const router = Router();
  router.use(requireAuth(env));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const ids = await listAccessibleWorkspaceIds(req.user!);
      const workspaces = await getPrisma().workspace.findMany({
        where: { id: { in: ids } },
        orderBy: { updatedAt: 'desc' },
      });
      const withRoles = await Promise.all(
        workspaces.map(async (w) => ({
          ...w,
          myRole: await resolveEffectiveWorkspaceRole(req.user!, w.id),
        }))
      );
      res.json(withRoles);
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      let visibility: WorkspaceVisibility = WorkspaceVisibility.PRIVATE;
      if (typeof req.body?.visibility === 'string') {
        const v = req.body.visibility.toUpperCase();
        if (v === 'PUBLIC') {
          visibility = WorkspaceVisibility.PUBLIC;
        } else {
          visibility = WorkspaceVisibility.PRIVATE;
        }
      }
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim() : null;
      const slug = await uniqueSlug('workspace', name);
      const prisma = getPrisma();
      const workspace = await prisma.workspace.create({
        data: {
          name,
          slug,
          visibility,
          description,
          createdByUserId: user.id,
          grants: {
            create: {
              principalType: WorkspacePrincipalType.USER,
              principalId: user.id,
              role: WorkspaceRole.OWNER,
              grantedByUserId: user.id,
            },
          },
        },
      });
      await recordActivity(
        workspace.id,
        user.id,
        WorkspaceActivityVerb.WorkspaceCreated,
        WorkspaceActivityTargetType.Workspace,
        workspace.id
      );
      res.status(201).json({ ...workspace, myRole: WorkspaceRole.OWNER });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.VIEWER)) {
        res.status(role ? 403 : 404).json({ error: role ? 'Forbidden' : 'Workspace not found' });
        return;
      }
      const workspace = await getPrisma().workspace.findUnique({ where: { id: req.params.id } });
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      res.json({ ...workspace, myRole: role });
    })
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.OWNER)) {
        res.status(403).json({ error: 'Owner role required' });
        return;
      }
      const data: { name?: string; description?: string | null; visibility?: WorkspaceVisibility } =
        {};
      if (typeof req.body?.name === 'string' && req.body.name.trim()) {
        data.name = req.body.name.trim();
      }
      if (req.body?.description === null || typeof req.body?.description === 'string') {
        data.description =
          typeof req.body.description === 'string' ? req.body.description.trim() : null;
      }
      if (typeof req.body?.visibility === 'string') {
        const v = req.body.visibility.toUpperCase();
        if (v === 'PUBLIC') {
          data.visibility = WorkspaceVisibility.PUBLIC;
        } else if (v === 'PRIVATE') {
          data.visibility = WorkspaceVisibility.PRIVATE;
        }
      }
      const workspace = await getPrisma().workspace.update({
        where: { id: req.params.id },
        data,
      });
      await recordActivity(
        workspace.id,
        req.user!.id,
        WorkspaceActivityVerb.WorkspaceUpdated,
        WorkspaceActivityTargetType.Workspace,
        workspace.id
      );
      res.json({ ...workspace, myRole: role });
    })
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.OWNER)) {
        res.status(403).json({ error: 'Owner role required' });
        return;
      }
      await getPrisma().workspace.delete({ where: { id: req.params.id } });
      res.status(204).send();
    })
  );

  router.get(
    '/:id/grants',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.VIEWER)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const grants = await getPrisma().workspaceAccessGrant.findMany({
        where: { workspaceId: req.params.id },
        orderBy: { createdAt: 'asc' },
      });
      const userIds = grants
        .filter((g) => g.principalType === WorkspacePrincipalType.USER)
        .map((g) => g.principalId);
      const teamIds = grants
        .filter((g) => g.principalType === WorkspacePrincipalType.TEAM)
        .map((g) => g.principalId);
      const [users, teams] = await Promise.all([
        userIds.length
          ? getPrisma().user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, email: true, displayName: true },
            })
          : Promise.resolve([]),
        teamIds.length
          ? getPrisma().team.findMany({
              where: { id: { in: teamIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);
      const userById = new Map(users.map((u) => [u.id, u]));
      const teamById = new Map(teams.map((t) => [t.id, t]));
      res.json(
        grants.map((grant) => {
          if (grant.principalType === WorkspacePrincipalType.USER) {
            const user = userById.get(grant.principalId);
            return {
              ...grant,
              principalEmail: user?.email ?? null,
              principalDisplayName: user?.displayName ?? null,
            };
          }
          const team = teamById.get(grant.principalId);
          return {
            ...grant,
            principalName: team?.name ?? null,
          };
        })
      );
    })
  );

  router.post(
    '/:id/grants',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.OWNER)) {
        res.status(403).json({ error: 'Owner role required' });
        return;
      }
      const principalType = parsePrincipalType(req.body?.type ?? req.body?.principalType);
      const grantRole = parseRole(req.body?.role);
      if (!principalType || !grantRole) {
        res.status(400).json({ error: 'type and role are required' });
        return;
      }

      let principalId = '';
      if (principalType === WorkspacePrincipalType.USER) {
        const email =
          typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        if (!email) {
          res.status(400).json({ error: 'email is required for USER grants' });
          return;
        }
        const matches = await getPrisma().user.findMany({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
          take: 2,
        });
        if (matches.length === 0) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        if (matches.length > 1) {
          res.status(409).json({ error: 'Multiple users match that email' });
          return;
        }
        principalId = matches[0].id;
      } else {
        principalId =
          typeof req.body?.id === 'string'
            ? req.body.id.trim()
            : typeof req.body?.principalId === 'string'
              ? req.body.principalId.trim()
              : '';
        if (!principalId) {
          res.status(400).json({ error: 'id is required for TEAM grants' });
          return;
        }
        const t = await getPrisma().team.findUnique({ where: { id: principalId } });
        if (!t) {
          res.status(404).json({ error: 'Team not found' });
          return;
        }
      }

      const grant = await getPrisma().workspaceAccessGrant.upsert({
        where: {
          workspaceId_principalType_principalId: {
            workspaceId: req.params.id,
            principalType,
            principalId,
          },
        },
        create: {
          workspaceId: req.params.id,
          principalType,
          principalId,
          role: grantRole,
          grantedByUserId: req.user!.id,
        },
        update: { role: grantRole, grantedByUserId: req.user!.id },
      });
      await recordActivity(
        req.params.id,
        req.user!.id,
        WorkspaceActivityVerb.GrantUpserted,
        WorkspaceActivityTargetType.Grant,
        grant.id,
        { principalType, principalId, role: grantRole }
      );
      res.status(201).json(grant);
    })
  );

  router.patch(
    '/:id/grants/:grantId',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.OWNER)) {
        res.status(403).json({ error: 'Owner role required' });
        return;
      }
      const grantRole = parseRole(req.body?.role);
      if (!grantRole) {
        res.status(400).json({ error: 'role is required' });
        return;
      }
      const existing = await getPrisma().workspaceAccessGrant.findFirst({
        where: { id: req.params.grantId, workspaceId: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Grant not found' });
        return;
      }
      if (
        existing.role === WorkspaceRole.OWNER &&
        grantRole !== WorkspaceRole.OWNER &&
        (await countOwners(req.params.id)) <= 1
      ) {
        res.status(409).json({ error: 'Workspace must have at least one owner' });
        return;
      }
      const grant = await getPrisma().workspaceAccessGrant.update({
        where: { id: existing.id },
        data: { role: grantRole },
      });
      await recordActivity(
        req.params.id,
        req.user!.id,
        WorkspaceActivityVerb.GrantUpdated,
        WorkspaceActivityTargetType.Grant,
        grant.id
      );
      res.json(grant);
    })
  );

  router.delete(
    '/:id/grants/:grantId',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.OWNER)) {
        res.status(403).json({ error: 'Owner role required' });
        return;
      }
      const existing = await getPrisma().workspaceAccessGrant.findFirst({
        where: { id: req.params.grantId, workspaceId: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Grant not found' });
        return;
      }
      if (existing.role === WorkspaceRole.OWNER && (await countOwners(req.params.id)) <= 1) {
        res.status(409).json({ error: 'Workspace must have at least one owner' });
        return;
      }
      await getPrisma().workspaceAccessGrant.delete({ where: { id: existing.id } });
      await recordActivity(
        req.params.id,
        req.user!.id,
        WorkspaceActivityVerb.GrantRemoved,
        WorkspaceActivityTargetType.Grant,
        existing.id
      );
      res.status(204).send();
    })
  );

  router.get(
    '/:id/activity',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.VIEWER)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const { page, pageSize, skip, sortBy, sortOrder } = parseWorkspaceActivityPageQuery(req);
      const where = { workspaceId: req.params.id };
      const [items, total] = await Promise.all([
        getPrisma().workspaceActivity.findMany({
          where,
          include: { actor: { select: { id: true, email: true, displayName: true } } },
          orderBy: { [sortBy]: sortOrder },
          skip,
          take: pageSize,
        }),
        getPrisma().workspaceActivity.count({ where }),
      ]);
      res.json({ items, total, page, pageSize, sortBy, sortOrder });
    })
  );

  router.get(
    '/:id/environments',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.VIEWER)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const envs = await getPrisma().sharedEnvironment.findMany({
        where: { workspaceId: req.params.id },
        include: sharedEnvInclude,
        orderBy: { name: 'asc' },
      });
      res.json(envs.map(sharedEnvironmentDto));
    })
  );

  router.post(
    '/:id/environments',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.EDITOR)) {
        res.status(403).json({ error: 'Editor role required' });
        return;
      }
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const config = normalizeSharedEnvironmentConfig(req.body?.config);
      const addresses = addressesFromConfig(config);
      const headers = headerRowsFromConfig(config);
      const envRow = await getPrisma().sharedEnvironment.create({
        data: {
          workspaceId: req.params.id,
          name,
          ...addresses,
          headers: { create: headers },
        },
        include: sharedEnvInclude,
      });
      await recordActivity(
        req.params.id,
        req.user!.id,
        WorkspaceActivityVerb.EnvironmentShared,
        WorkspaceActivityTargetType.Environment,
        envRow.id
      );
      res.status(201).json(sharedEnvironmentDto(envRow));
    })
  );

  router.patch(
    '/:id/environments/:envId',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.EDITOR)) {
        res.status(403).json({ error: 'Editor role required' });
        return;
      }
      const existing = await getPrisma().sharedEnvironment.findFirst({
        where: { id: req.params.envId, workspaceId: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Environment not found' });
        return;
      }
      const name =
        typeof req.body?.name === 'string' && req.body.name.trim()
          ? req.body.name.trim()
          : undefined;
      const envRow = await getPrisma().$transaction(async (tx) => {
        if (req.body?.config !== undefined) {
          const config = normalizeSharedEnvironmentConfig(req.body.config);
          const addresses = addressesFromConfig(config);
          const headers = headerRowsFromConfig(config);
          await tx.sharedEnvironmentHttpHeader.deleteMany({
            where: { environmentId: existing.id },
          });
          return tx.sharedEnvironment.update({
            where: { id: existing.id },
            data: {
              ...(name ? { name } : {}),
              ...addresses,
              headers: { create: headers },
            },
            include: sharedEnvInclude,
          });
        }
        return tx.sharedEnvironment.update({
          where: { id: existing.id },
          data: name ? { name } : {},
          include: sharedEnvInclude,
        });
      });
      await recordActivity(
        req.params.id,
        req.user!.id,
        WorkspaceActivityVerb.EnvironmentUpdated,
        WorkspaceActivityTargetType.Environment,
        envRow.id
      );
      res.json(sharedEnvironmentDto(envRow));
    })
  );

  router.delete(
    '/:id/environments/:envId',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.EDITOR)) {
        res.status(403).json({ error: 'Editor role required' });
        return;
      }
      const existing = await getPrisma().sharedEnvironment.findFirst({
        where: { id: req.params.envId, workspaceId: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Environment not found' });
        return;
      }
      await getPrisma().sharedEnvironment.delete({ where: { id: existing.id } });
      await recordActivity(
        req.params.id,
        req.user!.id,
        WorkspaceActivityVerb.EnvironmentRemoved,
        WorkspaceActivityTargetType.Environment,
        existing.id
      );
      res.status(204).send();
    })
  );

  router.get(
    '/:id/resources',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.VIEWER)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const refs = await getPrisma().workspaceResourceReference.findMany({
        where: { workspaceId: req.params.id },
        orderBy: [{ resourceType: 'asc' }, { displayName: 'asc' }, { resourceId: 'asc' }],
      });
      res.json(refs);
    })
  );

  router.post(
    '/:id/resources',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.EDITOR)) {
        res.status(403).json({ error: 'Editor role required' });
        return;
      }
      const resourceType =
        typeof req.body?.resourceType === 'string' ? req.body.resourceType.trim() : '';
      const resourceId =
        typeof req.body?.resourceId === 'string' ? req.body.resourceId.trim() : '';
      if (!resourceType || !resourceId) {
        res.status(400).json({ error: 'resourceType and resourceId are required' });
        return;
      }
      const canonicalUrl =
        typeof req.body?.canonicalUrl === 'string' && req.body.canonicalUrl.trim()
          ? req.body.canonicalUrl.trim()
          : null;
      const displayName =
        typeof req.body?.displayName === 'string' && req.body.displayName.trim()
          ? req.body.displayName.trim()
          : null;
      try {
        const ref = await getPrisma().workspaceResourceReference.create({
          data: {
            workspaceId: req.params.id,
            resourceType,
            resourceId,
            canonicalUrl,
            displayName,
            createdByUserId: req.user!.id,
          },
        });
        await recordActivity(
          req.params.id,
          req.user!.id,
          WorkspaceActivityVerb.ResourceAdded,
          WorkspaceActivityTargetType.Resource,
          ref.id,
          { resourceType, resourceId, displayName }
        );
        res.status(201).json(ref);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          res.status(409).json({ error: 'Resource reference already exists in this workspace' });
          return;
        }
        throw err;
      }
    })
  );

  router.delete(
    '/:id/resources/:refId',
    asyncHandler(async (req, res) => {
      const role = await resolveEffectiveWorkspaceRole(req.user!, req.params.id);
      if (!roleAtLeast(role, WorkspaceRole.EDITOR)) {
        res.status(403).json({ error: 'Editor role required' });
        return;
      }
      const existing = await getPrisma().workspaceResourceReference.findFirst({
        where: { id: req.params.refId, workspaceId: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Resource reference not found' });
        return;
      }
      await getPrisma().workspaceResourceReference.delete({ where: { id: existing.id } });
      await recordActivity(
        req.params.id,
        req.user!.id,
        WorkspaceActivityVerb.ResourceRemoved,
        WorkspaceActivityTargetType.Resource,
        existing.id,
        {
          resourceType: existing.resourceType,
          resourceId: existing.resourceId,
          displayName: existing.displayName,
        }
      );
      res.status(204).send();
    })
  );

  return router;
}

export function createActivityRouter(env: ServerEnv): Router {
  const router = Router();
  router.use(requireAuth(env));

  router.get(
    '/stats',
    asyncHandler(async (req, res) => {
      const ids = await listAccessibleWorkspaceIds(req.user!);
      const workspaceId =
        typeof req.query.workspaceId === 'string' && req.query.workspaceId.trim()
          ? req.query.workspaceId.trim()
          : undefined;
      if (workspaceId && !ids.includes(workspaceId)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const { range, interval, top, metrics, from, to } = parseWorkspaceActivityStatsQuery(req);
      const emptyAccess = !workspaceId && ids.length === 0;

      const response: {
        range: typeof range;
        interval: typeof interval;
        from: string;
        to: string;
        series?: { bucket: string; count: number }[];
        byActor?: {
          actorUserId: string;
          displayName: string | null;
          email: string | null;
          count: number;
        }[];
        byVerb?: { verb: string; count: number }[];
      } = {
        range,
        interval,
        from: from.toISOString(),
        to: to.toISOString(),
      };

      if (emptyAccess) {
        if (metrics.has(WorkspaceActivityStatsMetric.Series)) {
          response.series = fillActivitySeriesBuckets([], from, to, interval);
        }
        if (metrics.has(WorkspaceActivityStatsMetric.ByActor)) {
          response.byActor = [];
        }
        if (metrics.has(WorkspaceActivityStatsMetric.ByVerb)) {
          response.byVerb = [];
        }
        res.json(response);
        return;
      }

      const whereBase = {
        createdAt: { gte: from, lte: to },
        workspaceId: workspaceId ? workspaceId : { in: ids },
      };

      const tasks: Promise<void>[] = [];

      if (metrics.has(WorkspaceActivityStatsMetric.Series)) {
        tasks.push(
          (async () => {
            const workspaceSql = workspaceId
              ? Prisma.sql`"workspaceId" = ${workspaceId}::uuid`
              : Prisma.sql`"workspaceId" IN (${Prisma.join(
                  ids.map((id) => Prisma.sql`${id}::uuid`)
                )})`;
            const rows =
              interval === WorkspaceActivityStatsInterval.Week
                ? await getPrisma().$queryRaw<{ bucket: string; count: bigint }[]>`
                    SELECT to_char(
                             date_trunc('week', "createdAt" AT TIME ZONE 'UTC'),
                             'YYYY-MM-DD"T"HH24:MI:SS"Z"'
                           ) AS bucket,
                           COUNT(*)::bigint AS count
                    FROM "WorkspaceActivity"
                    WHERE ${workspaceSql}
                      AND "createdAt" >= ${from}
                      AND "createdAt" <= ${to}
                    GROUP BY 1
                    ORDER BY 1
                  `
                : await getPrisma().$queryRaw<{ bucket: string; count: bigint }[]>`
                    SELECT to_char(
                             date_trunc('day', "createdAt" AT TIME ZONE 'UTC'),
                             'YYYY-MM-DD"T"HH24:MI:SS"Z"'
                           ) AS bucket,
                           COUNT(*)::bigint AS count
                    FROM "WorkspaceActivity"
                    WHERE ${workspaceSql}
                      AND "createdAt" >= ${from}
                      AND "createdAt" <= ${to}
                    GROUP BY 1
                    ORDER BY 1
                  `;
            response.series = fillActivitySeriesBuckets(
              rows.map((r) => ({ bucket: new Date(r.bucket), count: Number(r.count) })),
              from,
              to,
              interval
            );
          })()
        );
      }

      if (metrics.has(WorkspaceActivityStatsMetric.ByActor)) {
        tasks.push(
          (async () => {
            const grouped = await getPrisma().workspaceActivity.groupBy({
              by: ['actorUserId'],
              where: whereBase,
              _count: { _all: true },
              orderBy: { _count: { actorUserId: 'desc' } },
              take: top,
            });
            const actorIds = grouped.map((g) => g.actorUserId);
            const users =
              actorIds.length === 0
                ? []
                : await getPrisma().user.findMany({
                    where: { id: { in: actorIds } },
                    select: { id: true, email: true, displayName: true },
                  });
            const byId = new Map(users.map((u) => [u.id, u]));
            response.byActor = grouped.map((g) => {
              const user = byId.get(g.actorUserId);
              return {
                actorUserId: g.actorUserId,
                displayName: user?.displayName ?? null,
                email: user?.email ?? null,
                count: g._count._all,
              };
            });
          })()
        );
      }

      if (metrics.has(WorkspaceActivityStatsMetric.ByVerb)) {
        tasks.push(
          (async () => {
            const grouped = await getPrisma().workspaceActivity.groupBy({
              by: ['verb'],
              where: whereBase,
              _count: { _all: true },
              orderBy: { _count: { verb: 'desc' } },
            });
            response.byVerb = grouped.map((g) => ({
              verb: g.verb,
              count: g._count._all,
            }));
          })()
        );
      }

      await Promise.all(tasks);
      res.json(response);
    })
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const ids = await listAccessibleWorkspaceIds(req.user!);
      const { page, pageSize, skip, sortBy, sortOrder } = parseWorkspaceActivityPageQuery(req);
      const workspaceId =
        typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      if (workspaceId && !ids.includes(workspaceId)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (!workspaceId && ids.length === 0) {
        res.json({
          items: [],
          total: 0,
          page,
          pageSize,
          sortBy,
          sortOrder,
        });
        return;
      }
      const where = {
        workspaceId: workspaceId ? workspaceId : { in: ids },
      };
      const [items, total] = await Promise.all([
        getPrisma().workspaceActivity.findMany({
          where,
          include: {
            actor: { select: { id: true, email: true, displayName: true } },
            workspace: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { [sortBy]: sortOrder },
          skip,
          take: pageSize,
        }),
        getPrisma().workspaceActivity.count({ where }),
      ]);
      res.json({ items, total, page, pageSize, sortBy, sortOrder });
    })
  );

  return router;
}
