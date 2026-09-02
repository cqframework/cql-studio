// Author: Preston Lee

import type { Request } from 'express';

export const WorkspaceActivityVerb = {
  WorkspaceCreated: 'workspace.created',
  WorkspaceUpdated: 'workspace.updated',
  GrantUpserted: 'grant.upserted',
  GrantUpdated: 'grant.updated',
  GrantRemoved: 'grant.removed',
  EnvironmentShared: 'environment.shared',
  EnvironmentUpdated: 'environment.updated',
  EnvironmentRemoved: 'environment.removed',
  ResourceAdded: 'resource.added',
  ResourceRemoved: 'resource.removed',
} as const;

export type WorkspaceActivityVerb =
  (typeof WorkspaceActivityVerb)[keyof typeof WorkspaceActivityVerb];

export const WorkspaceActivityTargetType = {
  Workspace: 'workspace',
  Grant: 'grant',
  Environment: 'environment',
  Resource: 'resource',
} as const;

export type WorkspaceActivityTargetType =
  (typeof WorkspaceActivityTargetType)[keyof typeof WorkspaceActivityTargetType];

/** Sort fields backed by indexes on WorkspaceActivity DateTime columns. */
export const WorkspaceActivitySortBy = {
  CreatedAt: 'createdAt',
  UpdatedAt: 'updatedAt',
} as const;

export type WorkspaceActivitySortBy =
  (typeof WorkspaceActivitySortBy)[keyof typeof WorkspaceActivitySortBy];

export type WorkspaceActivitySortOrder = 'asc' | 'desc';

export const WORKSPACE_ACTIVITY_DEFAULT_PAGE_SIZE = 25;
export const WORKSPACE_ACTIVITY_MAX_PAGE_SIZE = 100;
export const WORKSPACE_ACTIVITY_ALLOWED_PAGE_SIZES = [10, 25, 50, 100] as const;

export interface WorkspaceActivityPageQuery {
  page: number;
  pageSize: number;
  skip: number;
  sortBy: WorkspaceActivitySortBy;
  sortOrder: WorkspaceActivitySortOrder;
}

export function parseWorkspaceActivityPageQuery(req: Request): WorkspaceActivityPageQuery {
  const rawPage = Number(req.query.page);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawPageSize = Number(req.query.pageSize ?? req.query.limit);
  let pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1
    ? Math.floor(rawPageSize)
    : WORKSPACE_ACTIVITY_DEFAULT_PAGE_SIZE;
  pageSize = Math.min(pageSize, WORKSPACE_ACTIVITY_MAX_PAGE_SIZE);

  const rawSortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : '';
  const sortBy: WorkspaceActivitySortBy =
    rawSortBy === WorkspaceActivitySortBy.UpdatedAt
      ? WorkspaceActivitySortBy.UpdatedAt
      : WorkspaceActivitySortBy.CreatedAt;

  const rawSortOrder = typeof req.query.sortOrder === 'string' ? req.query.sortOrder.toLowerCase() : '';
  const sortOrder: WorkspaceActivitySortOrder = rawSortOrder === 'asc' ? 'asc' : 'desc';

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    sortBy,
    sortOrder,
  };
}

export const WorkspaceActivityStatsRange = {
  Days7: '7d',
  Days30: '30d',
  Days90: '90d',
} as const;

export type WorkspaceActivityStatsRange =
  (typeof WorkspaceActivityStatsRange)[keyof typeof WorkspaceActivityStatsRange];

export const WorkspaceActivityStatsInterval = {
  Day: 'day',
  Week: 'week',
} as const;

export type WorkspaceActivityStatsInterval =
  (typeof WorkspaceActivityStatsInterval)[keyof typeof WorkspaceActivityStatsInterval];

export const WorkspaceActivityStatsMetric = {
  Series: 'series',
  ByActor: 'byActor',
  ByVerb: 'byVerb',
} as const;

export type WorkspaceActivityStatsMetric =
  (typeof WorkspaceActivityStatsMetric)[keyof typeof WorkspaceActivityStatsMetric];

export const WORKSPACE_ACTIVITY_STATS_DEFAULT_TOP = 10;
export const WORKSPACE_ACTIVITY_STATS_MAX_TOP = 20;

const RANGE_DAYS: Record<WorkspaceActivityStatsRange, number> = {
  [WorkspaceActivityStatsRange.Days7]: 7,
  [WorkspaceActivityStatsRange.Days30]: 30,
  [WorkspaceActivityStatsRange.Days90]: 90,
};

export interface WorkspaceActivityStatsQuery {
  range: WorkspaceActivityStatsRange;
  interval: WorkspaceActivityStatsInterval;
  top: number;
  metrics: Set<WorkspaceActivityStatsMetric>;
  from: Date;
  to: Date;
}

export interface WorkspaceActivitySeriesBucket {
  bucket: string;
  count: number;
}

export function parseWorkspaceActivityStatsQuery(req: Request): WorkspaceActivityStatsQuery {
  const rawRange = typeof req.query.range === 'string' ? req.query.range : '';
  const range: WorkspaceActivityStatsRange =
    rawRange === WorkspaceActivityStatsRange.Days7 || rawRange === WorkspaceActivityStatsRange.Days90
      ? rawRange
      : WorkspaceActivityStatsRange.Days30;

  const rawInterval = typeof req.query.interval === 'string' ? req.query.interval : '';
  const interval: WorkspaceActivityStatsInterval =
    rawInterval === WorkspaceActivityStatsInterval.Week
      ? WorkspaceActivityStatsInterval.Week
      : WorkspaceActivityStatsInterval.Day;

  const rawTop = Number(req.query.top);
  let top =
    Number.isFinite(rawTop) && rawTop >= 1
      ? Math.floor(rawTop)
      : WORKSPACE_ACTIVITY_STATS_DEFAULT_TOP;
  top = Math.min(top, WORKSPACE_ACTIVITY_STATS_MAX_TOP);

  const metrics = new Set<WorkspaceActivityStatsMetric>();
  const rawMetrics = typeof req.query.metrics === 'string' ? req.query.metrics : '';
  if (rawMetrics.trim()) {
    for (const part of rawMetrics.split(',')) {
      const trimmed = part.trim();
      if (
        trimmed === WorkspaceActivityStatsMetric.Series ||
        trimmed === WorkspaceActivityStatsMetric.ByActor ||
        trimmed === WorkspaceActivityStatsMetric.ByVerb
      ) {
        metrics.add(trimmed);
      }
    }
  }
  if (metrics.size === 0) {
    metrics.add(WorkspaceActivityStatsMetric.Series);
    metrics.add(WorkspaceActivityStatsMetric.ByActor);
    metrics.add(WorkspaceActivityStatsMetric.ByVerb);
  }

  const to = new Date();
  const from = new Date(to.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);

  return { range, interval, top, metrics, from, to };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfUtcWeek(d: Date): Date {
  const day = startOfUtcDay(d);
  // Postgres date_trunc('week') uses Monday as week start.
  const weekday = day.getUTCDay(); // 0=Sun … 6=Sat
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  day.setUTCDate(day.getUTCDate() - daysFromMonday);
  return day;
}

export function fillActivitySeriesBuckets(
  rows: { bucket: Date; count: number }[],
  from: Date,
  to: Date,
  interval: WorkspaceActivityStatsInterval
): WorkspaceActivitySeriesBucket[] {
  const normalize =
    interval === WorkspaceActivityStatsInterval.Week ? startOfUtcWeek : startOfUtcDay;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = normalize(new Date(row.bucket)).toISOString();
    counts.set(key, Number(row.count) || 0);
  }

  const stepMs =
    interval === WorkspaceActivityStatsInterval.Week ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  let cursor = normalize(from);
  const end = normalize(to);

  const series: WorkspaceActivitySeriesBucket[] = [];
  while (cursor.getTime() <= end.getTime()) {
    const key = cursor.toISOString();
    series.push({ bucket: key, count: counts.get(key) ?? 0 });
    cursor = new Date(cursor.getTime() + stepMs);
  }
  return series;
}
