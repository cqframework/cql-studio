// Author: Preston Lee

import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Measure } from 'fhir/r4';
import { MeasureService } from '../../../services/measure.service';
import { SettingsService } from '../../../services/settings.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-measure-library',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './measure-library.component.html',
  styleUrl: './measure-library.component.scss'
})
export class MeasureLibraryComponent implements OnInit {
  private readonly searchTermSignal = signal('');
  protected readonly results = signal<Measure[]>([]);

  get searchTerm(): string {
    return this.searchTermSignal();
  }
  set searchTerm(value: string) {
    this.searchTermSignal.set(value);
  }
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly totalCount = signal(0);
  protected readonly availablePageSizes = [5, 10, 20, 50];

  protected readonly hasValidConfiguration = computed(() => {
    this.settingsService.settings();
    const baseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    return baseUrl.trim() !== '';
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

  private measureService = inject(MeasureService);
  protected settingsService = inject(SettingsService);
  private toastService = inject(ToastService);

  ngOnInit(): void {
    if (this.hasValidConfiguration() && !this.loading()) {
      this.searchMeasures();
    }
  }

  async searchMeasures(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      const msg = 'Configure FHIR base URL in Settings.';
      this.error.set(msg);
      this.toastService.showWarning(msg, 'Configuration Required');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const term = this.searchTermSignal().trim();
      const page = this.currentPage();
      const size = this.pageSize();
      const params: { name?: string; title?: string; _count: number; _offset: number } = {
        _count: size,
        _offset: (page - 1) * size
      };
      if (term) params.name = term;
      const bundle = await firstValueFrom(this.measureService.searchMeasures(params));
      const entries = bundle?.entry ?? [];
      this.results.set(entries.map(e => e.resource!).filter((r): r is Measure => r?.resourceType === 'Measure'));
      this.totalCount.set(bundle?.total ?? this.results().length);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Search failed.';
      this.error.set(msg);
      this.toastService.showError(msg, 'Measure Search');
      this.results.set([]);
      this.totalCount.set(0);
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(): void {
    this.currentPage.set(1);
    this.searchMeasures();
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
    this.searchMeasures();
  }

  goToPage(page: number): void {
    const max = this.totalPages();
    if (page < 1 || page > max) return;
    this.currentPage.set(page);
    this.searchMeasures();
  }

  getMeasureTitle(m: Measure): string {
    return m.title ?? m.name ?? m.id ?? 'Unnamed';
  }

  getMeasureTrackId(m: Measure, index: number): string {
    return m.id ?? m.url ?? `measure-${index}`;
  }
}
