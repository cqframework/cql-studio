// Author: Preston Lee

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { TeamMemberRole, WorkspaceRole } from '@prisma/client';
import { getPrisma } from '../db/prisma.js';
import type { ServerEnv } from '../config/env.js';
import { requireAuth, requireSsoConfigured } from '../auth/session.js';
import { uniqueSlug } from '../workspace/access.js';

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

async function requireTeamAdmin(teamId: string, userId: string): Promise<boolean> {
  const membership = await getPrisma().teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  return membership?.role === TeamMemberRole.ADMIN;
}

export function createTeamRouter(env: ServerEnv): Router {
  const router = Router();
  router.use(requireSsoConfigured(env));
  router.use(requireAuth(env));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const memberships = await getPrisma().teamMembership.findMany({
        where: { userId: user.id },
        include: { team: true },
        orderBy: { createdAt: 'asc' },
      });
      res.json(
        memberships.map((m) => ({
          ...m.team,
          myRole: m.role,
        }))
      );
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
      const slug = await uniqueSlug('team', name);
      const prisma = getPrisma();
      const team = await prisma.team.create({
        data: {
          name,
          slug,
          createdByUserId: user.id,
          memberships: {
            create: { userId: user.id, role: TeamMemberRole.ADMIN },
          },
        },
      });
      res.status(201).json({ ...team, myRole: TeamMemberRole.ADMIN });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const team = await getPrisma().team.findUnique({
        where: { id: req.params.id },
        include: {
          memberships: {
            include: {
              user: { select: { id: true, email: true, displayName: true } },
            },
          },
        },
      });
      if (!team) {
        res.status(404).json({ error: 'Team not found' });
        return;
      }
      const mine = team.memberships.find((m) => m.userId === user.id);
      if (!mine) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      res.json({ ...team, myRole: mine.role });
    })
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const teamId = req.params.id;
      if (!(await requireTeamAdmin(teamId, user.id))) {
        res.status(403).json({ error: 'Team admin required' });
        return;
      }
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const team = await getPrisma().team.update({
        where: { id: teamId },
        data: { name },
      });
      res.json(team);
    })
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const teamId = req.params.id;
      if (!(await requireTeamAdmin(teamId, user.id))) {
        res.status(403).json({ error: 'Team admin required' });
        return;
      }
      const soleOwnerCount = await getPrisma().workspaceAccessGrant.count({
        where: {
          principalType: 'TEAM',
          principalId: teamId,
          role: WorkspaceRole.OWNER,
        },
      });
      // Block delete if this team is an owner of any workspace where it is the only owner grant
      if (soleOwnerCount > 0) {
        const ownerGrants = await getPrisma().workspaceAccessGrant.findMany({
          where: {
            principalType: 'TEAM',
            principalId: teamId,
            role: WorkspaceRole.OWNER,
          },
        });
        for (const grant of ownerGrants) {
          const owners = await getPrisma().workspaceAccessGrant.count({
            where: { workspaceId: grant.workspaceId, role: WorkspaceRole.OWNER },
          });
          if (owners <= 1) {
            res.status(409).json({
              error:
                'Cannot delete team: it is the sole owner of one or more workspaces. Reassign ownership first.',
            });
            return;
          }
        }
      }
      await getPrisma().team.delete({ where: { id: teamId } });
      res.status(204).send();
    })
  );

  router.post(
    '/:id/members',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const teamId = req.params.id;
      if (!(await requireTeamAdmin(teamId, user.id))) {
        res.status(403).json({ error: 'Team admin required' });
        return;
      }
      const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
      const roleRaw = typeof req.body?.role === 'string' ? req.body.role.toUpperCase() : 'MEMBER';
      const role = roleRaw === 'ADMIN' ? TeamMemberRole.ADMIN : TeamMemberRole.MEMBER;
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      const target = await getPrisma().user.findUnique({ where: { id: userId } });
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const membership = await getPrisma().teamMembership.upsert({
        where: { teamId_userId: { teamId, userId } },
        create: { teamId, userId, role },
        update: { role },
        include: { user: { select: { id: true, email: true, displayName: true } } },
      });
      res.status(201).json(membership);
    })
  );

  router.delete(
    '/:id/members/:userId',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const teamId = req.params.id;
      const targetUserId = req.params.userId;
      if (!(await requireTeamAdmin(teamId, user.id)) && user.id !== targetUserId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const membership = await getPrisma().teamMembership.findUnique({
        where: { teamId_userId: { teamId, userId: targetUserId } },
      });
      if (!membership) {
        res.status(404).json({ error: 'Membership not found' });
        return;
      }
      if (membership.role === TeamMemberRole.ADMIN) {
        const adminCount = await getPrisma().teamMembership.count({
          where: { teamId, role: TeamMemberRole.ADMIN },
        });
        if (adminCount <= 1) {
          res.status(409).json({ error: 'Cannot remove the last team admin' });
          return;
        }
      }
      await getPrisma().teamMembership.delete({
        where: { teamId_userId: { teamId, userId: targetUserId } },
      });
      res.status(204).send();
    })
  );

  return router;
}
