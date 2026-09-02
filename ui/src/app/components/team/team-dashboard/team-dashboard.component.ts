// Author: Preston Lee

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';
import { WorkspaceService } from '../../../services/workspace.service';
import { workspaceActivityVerbLabel } from '../../../services/workspace-activity.lib';
import {
  WORKSPACE_ACTIVITY_PAGE_SIZES,
  WORKSPACE_ACTIVITY_STATS_INTERVALS,
  WORKSPACE_ACTIVITY_STATS_RANGES,
  WORKSPACE_ACTIVITY_STATS_TOP_OPTIONS,
  Workspace,
  WorkspaceActivity,
  WorkspaceActivitySortBy,
  WorkspaceActivitySortOrder,
  WorkspaceActivityStatsInterval,
  WorkspaceActivityStatsRange,
} from '../../../models/team.model';

const CHART_COLORS = [
  '#0d6efd',
  '#198754',
  '#ffc107',
  '#dc3545',
  '#6f42c1',
  '#fd7e14',
  '#20c997',
  '#6c757d',
  '#0dcaf0',
  '#d63384',
];

@Component({
  selector: 'app-team-dashboard',
  standalone: true,
  imports: [DatePipe, RouterLink, FormsModule, BaseChartDirective],
  templateUrl: './team-dashboard.component.html',
  styleUrl: './team-dashboard.component.scss',
})
export class TeamDashboardComponent implements OnInit {
  private readonly workspaceService = inject(WorkspaceService);

  readonly activity = signal<WorkspaceActivity[]>([]);
  readonly workspaces = signal<Workspace[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly workspaceFilter = signal('');

  readonly page = signal(1);
  readonly pageSize = signal<number>(25);
  readonly sortBy = signal<WorkspaceActivitySortBy>('createdAt');
  readonly sortOrder = signal<WorkspaceActivitySortOrder>('desc');
  readonly total = signal(0);

  readonly availablePageSizes = WORKSPACE_ACTIVITY_PAGE_SIZES;
  readonly statsRanges = WORKSPACE_ACTIVITY_STATS_RANGES;
  readonly statsIntervals = WORKSPACE_ACTIVITY_STATS_INTERVALS;
  readonly statsTopOptions = WORKSPACE_ACTIVITY_STATS_TOP_OPTIONS;
  readonly sortByOptions: { value: WorkspaceActivitySortBy; label: string }[] = [
    { value: 'createdAt', label: 'Created' },
    { value: 'updatedAt', label: 'Updated' },
  ];

  readonly seriesRange = signal<WorkspaceActivityStatsRange>('30d');
  readonly seriesInterval = signal<WorkspaceActivityStatsInterval>('day');
  readonly seriesLoading = signal(false);
  readonly seriesError = signal('');
  readonly seriesBuckets = signal<{ bucket: string; count: number }[]>([]);

  readonly actorRange = signal<WorkspaceActivityStatsRange>('30d');
  readonly actorTop = signal<number>(10);
  readonly actorLoading = signal(false);
  readonly actorError = signal('');
  readonly actorRows = signal<
    { actorUserId: string; displayName: string | null; email: string | null; count: number }[]
  >([]);

  readonly verbRange = signal<WorkspaceActivityStatsRange>('30d');
  readonly verbLoading = signal(false);
  readonly verbError = signal('');
  readonly verbRows = signal<{ verb: string; count: number }[]>([]);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly hasPreviousPage = computed(() => this.page() > 1);
  readonly hasNextPage = computed(() => this.page() < this.totalPages());
  readonly startIndex = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1
  );
  readonly endIndex = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  readonly seriesChartData = computed((): ChartData<'line'> => {
    const buckets = this.seriesBuckets();
    const interval = this.seriesInterval();
    return {
      labels: buckets.map((b) => this.formatBucketLabel(b.bucket, interval)),
      datasets: [
        {
          label: 'Activity',
          data: buckets.map((b) => b.count),
          borderColor: '#0d6efd',
          backgroundColor: 'rgba(13, 110, 253, 0.15)',
          fill: true,
          tension: 0.25,
          pointRadius: buckets.length > 60 ? 0 : 3,
        },
      ],
    };
  });

  readonly seriesChartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        ticks: { precision: 0 },
      },
    },
    plugins: {
      legend: { display: false },
    },
  };

  readonly actorChartData = computed((): ChartData<'bar'> => {
    const rows = this.actorRows();
    return {
      labels: rows.map((r) => r.displayName || r.email || r.actorUserId),
      datasets: [
        {
          label: 'Events',
          data: rows.map((r) => r.count),
          backgroundColor: '#0d6efd',
        },
      ],
    };
  });

  readonly actorChartOptions: ChartConfiguration<'bar'>['options'] = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        beginAtZero: true,
        ticks: { precision: 0 },
      },
    },
    plugins: {
      legend: { display: false },
    },
  };

  readonly verbChartData = computed((): ChartData<'doughnut'> => {
    const rows = this.verbRows();
    return {
      labels: rows.map((r) => workspaceActivityVerbLabel(r.verb)),
      datasets: [
        {
          data: rows.map((r) => r.count),
          backgroundColor: rows.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          borderWidth: 2,
          borderColor: '#fff',
        },
      ],
    };
  });

  readonly verbChartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
      },
    },
  };

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.workspaceService
        .list()
        .then((workspaces) => this.workspaces.set(workspaces))
        .catch((e: unknown) => {
          if (!this.error()) {
            this.error.set((e as Error).message || 'Failed to load workspaces');
          }
        }),
      this.loadActivity(),
      this.loadAllCharts(),
    ]);
  }

  async onFilterChange(workspaceId: string): Promise<void> {
    this.workspaceFilter.set(workspaceId);
    this.page.set(1);
    await Promise.all([this.loadActivity(), this.loadAllCharts()]);
  }

  async onPageSizeChange(size: number): Promise<void> {
    this.pageSize.set(size);
    this.page.set(1);
    await this.loadActivity();
  }

  async onSortByChange(sortBy: WorkspaceActivitySortBy): Promise<void> {
    this.sortBy.set(sortBy);
    this.page.set(1);
    await this.loadActivity();
  }

  async onSortOrderChange(sortOrder: WorkspaceActivitySortOrder): Promise<void> {
    this.sortOrder.set(sortOrder);
    this.page.set(1);
    await this.loadActivity();
  }

  async goToPage(page: number): Promise<void> {
    const next = Math.min(Math.max(1, page), this.totalPages());
    if (next === this.page()) {
      return;
    }
    this.page.set(next);
    await this.loadActivity();
  }

  async onSeriesRangeChange(range: WorkspaceActivityStatsRange): Promise<void> {
    this.seriesRange.set(range);
    await this.loadSeriesChart();
  }

  async onSeriesIntervalChange(interval: WorkspaceActivityStatsInterval): Promise<void> {
    this.seriesInterval.set(interval);
    await this.loadSeriesChart();
  }

  async onActorRangeChange(range: WorkspaceActivityStatsRange): Promise<void> {
    this.actorRange.set(range);
    await this.loadActorChart();
  }

  async onActorTopChange(top: number): Promise<void> {
    this.actorTop.set(top);
    await this.loadActorChart();
  }

  async onVerbRangeChange(range: WorkspaceActivityStatsRange): Promise<void> {
    this.verbRange.set(range);
    await this.loadVerbChart();
  }

  actorLabel(item: WorkspaceActivity): string {
    return item.actor?.displayName || item.actor?.email || item.actorUserId;
  }

  verbLabel(verb: string): string {
    return workspaceActivityVerbLabel(verb);
  }

  private workspaceIdOrUndefined(): string | undefined {
    return this.workspaceFilter() || undefined;
  }

  private async loadAllCharts(): Promise<void> {
    await Promise.all([this.loadSeriesChart(), this.loadActorChart(), this.loadVerbChart()]);
  }

  private async loadSeriesChart(): Promise<void> {
    this.seriesLoading.set(true);
    this.seriesError.set('');
    try {
      const stats = await this.workspaceService.activityStats({
        workspaceId: this.workspaceIdOrUndefined(),
        range: this.seriesRange(),
        interval: this.seriesInterval(),
        metrics: ['series'],
      });
      this.seriesBuckets.set(stats.series ?? []);
    } catch (e) {
      this.seriesError.set((e as Error).message || 'Failed to load activity over time');
      this.seriesBuckets.set([]);
    } finally {
      this.seriesLoading.set(false);
    }
  }

  private async loadActorChart(): Promise<void> {
    this.actorLoading.set(true);
    this.actorError.set('');
    try {
      const stats = await this.workspaceService.activityStats({
        workspaceId: this.workspaceIdOrUndefined(),
        range: this.actorRange(),
        top: this.actorTop(),
        metrics: ['byActor'],
      });
      this.actorRows.set(stats.byActor ?? []);
    } catch (e) {
      this.actorError.set((e as Error).message || 'Failed to load activity by actor');
      this.actorRows.set([]);
    } finally {
      this.actorLoading.set(false);
    }
  }

  private async loadVerbChart(): Promise<void> {
    this.verbLoading.set(true);
    this.verbError.set('');
    try {
      const stats = await this.workspaceService.activityStats({
        workspaceId: this.workspaceIdOrUndefined(),
        range: this.verbRange(),
        metrics: ['byVerb'],
      });
      this.verbRows.set(stats.byVerb ?? []);
    } catch (e) {
      this.verbError.set((e as Error).message || 'Failed to load activity by type');
      this.verbRows.set([]);
    } finally {
      this.verbLoading.set(false);
    }
  }

  private formatBucketLabel(iso: string, interval: WorkspaceActivityStatsInterval): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    if (interval === 'week') {
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    }
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  private async loadActivity(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const workspaceId = this.workspaceIdOrUndefined();
      const page = await this.workspaceService.activity({
        workspaceId,
        page: this.page(),
        pageSize: this.pageSize(),
        sortBy: this.sortBy(),
        sortOrder: this.sortOrder(),
      });
      this.activity.set(page.items);
      this.total.set(page.total);
      if (page.page !== this.page()) {
        this.page.set(page.page);
      }
    } catch (e) {
      this.error.set((e as Error).message || 'Failed to load activity');
      this.activity.set([]);
      this.total.set(0);
    } finally {
      this.loading.set(false);
    }
  }
}
