// Author: Preston Lee

import {
  Prisma,
  WorkspacePrincipalType,
  WorkspaceRole,
  WorkspaceVisibility,
  type User,
} from '@prisma/client';
import { getPrisma } from '../db/prisma.js';
import type { WorkspaceActivityTargetType, WorkspaceActivityVerb } from './activity.js';

const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

export function maxRole(a: WorkspaceRole | null, b: WorkspaceRole | null): WorkspaceRole | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

export function roleAtLeast(actual: WorkspaceRole | null, required: WorkspaceRole): boolean {
  if (!actual) {
    return false;
  }
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export async function resolveEffectiveWorkspaceRole(
  user: User,
  workspaceId: string
): Promise<WorkspaceRole | null> {
  const prisma = getPrisma();
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    return null;
  }

  const memberships = await prisma.teamMembership.findMany({
    where: { userId: user.id },
    select: { teamId: true },
  });
  const teamIds = memberships.map((m) => m.teamId);

  const grants = await prisma.workspaceAccessGrant.findMany({
    where: {
      workspaceId,
      OR: [
        { principalType: WorkspacePrincipalType.USER, principalId: user.id },
        ...(teamIds.length
          ? [{ principalType: WorkspacePrincipalType.TEAM, principalId: { in: teamIds } }]
          : []),
      ],
    },
  });

  let effective: WorkspaceRole | null = null;
  for (const grant of grants) {
    effective = maxRole(effective, grant.role);
  }

  if (workspace.visibility === WorkspaceVisibility.PUBLIC) {
    effective = maxRole(effective, WorkspaceRole.VIEWER);
  }

  return effective;
}

export async function listAccessibleWorkspaceIds(user: User): Promise<string[]> {
  const prisma = getPrisma();
  const memberships = await prisma.teamMembership.findMany({
    where: { userId: user.id },
    select: { teamId: true },
  });
  const teamIds = memberships.map((m) => m.teamId);

  const grants = await prisma.workspaceAccessGrant.findMany({
    where: {
      OR: [
        { principalType: WorkspacePrincipalType.USER, principalId: user.id },
        ...(teamIds.length
          ? [{ principalType: WorkspacePrincipalType.TEAM, principalId: { in: teamIds } }]
          : []),
      ],
    },
    select: { workspaceId: true },
  });

  const publicWorkspaces = await prisma.workspace.findMany({
    where: { visibility: WorkspaceVisibility.PUBLIC },
    select: { id: true },
  });

  return [...new Set([...grants.map((g) => g.workspaceId), ...publicWorkspaces.map((w) => w.id)])];
}

export async function countOwners(workspaceId: string): Promise<number> {
  return getPrisma().workspaceAccessGrant.count({
    where: { workspaceId, role: WorkspaceRole.OWNER },
  });
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'item';
}

export async function uniqueSlug(
  kind: 'team' | 'workspace',
  name: string
): Promise<string> {
  const prisma = getPrisma();
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing =
      kind === 'team'
        ? await prisma.team.findUnique({ where: { slug: candidate } })
        : await prisma.workspace.findUnique({ where: { slug: candidate } });
    if (!existing) {
      return candidate;
    }
  }
  return `${base}-${cryptoRandom()}`;
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function recordActivity(
  workspaceId: string,
  actorUserId: string,
  verb: WorkspaceActivityVerb,
  targetType?: WorkspaceActivityTargetType,
  targetId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await getPrisma().workspaceActivity.create({
    data: {
      workspaceId,
      actorUserId,
      verb,
      targetType,
      targetId,
      metadata: metadata
        ? (metadata as Prisma.InputJsonValue)
        : undefined,
    },
  });
}
