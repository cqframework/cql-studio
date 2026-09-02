// Author: Preston Lee

import { Component, computed, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MeasureReport } from 'fhir/r4';
import { firstValueFrom } from 'rxjs';
import { MeasureService } from '../../../services/measure.service';
import { SettingsService } from '../../../services/settings.service';
import { ToastService } from '../../../services/toast.service';
import { isResourceType } from '../../../services/fhir-resource-type.lib';

@Component({
  selector: 'app-measure-reports-list',
  imports: [FormsModule, RouterLink],
  templateUrl: './measure-reports-list.component.html',
  styleUrl: './measure-reports-list.component.scss',

  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeasureReportsListComponent implements OnInit {
  protected readonly measureFilter = signal('');

  protected readonly results = signal<MeasureReport[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly totalCount = signal(0);
  protected readonly availablePageSizes = [5, 10, 20, 50];

  protected readonly hasValidConfiguration = computed(() => {
    this.settingsService.settings();
    return this.settingsService.getEffectiveEvaluationServerUrl().trim() !== '';
  });

  protected readonly totalPages = computed(() => {
    const total = this.totalCount();
    const size = this.pageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  protected readonly startIndex = computed(() => (this.currentPage() - 1) * this.pageSize() + 1);
  protected readonly endIndex = computed(() => {
    const total = this.totalCount();
    const end = this.currentPage() * this.pageSize();
    return Math.min(end, total);
  });

  private readonly measureService = inject(MeasureService);
  protected readonly settingsService = inject(SettingsService);
  private readonly toastService = inject(ToastService);

  ngOnInit(): void {
    if (this.hasValidConfiguration() && !this.loading()) {
      void this.searchReports();
    }
  }

  async searchReports(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      const msg = 'Configure FHIR base URL in Settings.';
      this.error.set(msg);
      this.toastService.showWarning(msg, 'Configuration Required');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const measure = this.measureFilter().trim();
      const page = this.currentPage();
      const size = this.pageSize();
      const params: {
        measure?: string;
        _count: number;
        _offset: number;
      } = {
        _count: size,
        _offset: (page - 1) * size,
      };
      if (measure) {
        params.measure = measure;
      }
      const bundle = await firstValueFrom(this.measureService.searchMeasureReports(params));
      const entries = bundle?.entry ?? [];
      this.results.set(
        entries.map(e => e.resource!).filter((r): r is MeasureReport => isResourceType(r, 'MeasureReport')),
      );
      this.totalCount.set(bundle?.total ?? this.results().length);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Search failed.';
      this.error.set(msg);
      this.toastService.showError(msg, 'MeasureReport Search');
      this.results.set([]);
      this.totalCount.set(0);
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(): void {
    this.currentPage.set(1);
    void this.searchReports();
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
    void this.searchReports();
  }

  goToPage(page: number): void {
    const max = this.totalPages();
    if (page < 1 || page > max) {
      return;
    }
    this.currentPage.set(page);
    void this.searchReports();
  }

  getReportTrackId(report: MeasureReport, index: number): string {
    return report.id ?? report.measure ?? `report-${index}`;
  }

  getReportTitle(report: MeasureReport): string {
    return report.id ?? 'Unnamed report';
  }

  getReportSubtitle(report: MeasureReport): string | null {
    if (report.measure) {
      return report.measure;
    }
    if (report.period?.start && report.period?.end) {
      return `${report.period.start} – ${report.period.end}`;
    }
    return null;
  }
}
