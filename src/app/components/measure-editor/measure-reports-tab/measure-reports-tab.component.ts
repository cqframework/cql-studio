// Author: Preston Lee

import { Component, input, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Measure, MeasureReport } from 'fhir/r4';
import { firstValueFrom } from 'rxjs';
import { MeasureService } from '../../../services/measure.service';
import { SettingsService } from '../../../services/settings.service';
import { ToastService } from '../../../services/toast.service';
import { MeasureReportViewComponent } from '../measure-report-view/measure-report-view.component';

@Component({
  selector: 'app-measure-reports-tab',
  standalone: true,
  imports: [CommonModule, MeasureReportViewComponent],
  templateUrl: './measure-reports-tab.component.html',
  styleUrl: './measure-reports-tab.component.scss'
})
export class MeasureReportsTabComponent {
  measure = input<Measure | null>(null);

  protected readonly reports = signal<MeasureReport[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedReport = signal<MeasureReport | null>(null);

  protected readonly hasValidConfiguration = () => this.settingsService.getEffectiveFhirBaseUrl().trim() !== '';

  private measureService = inject(MeasureService);
  private settingsService = inject(SettingsService);
  private toastService = inject(ToastService);

  protected async loadReports(): Promise<void> {
    const m = this.measure();
    if (!m) return;
    if (!this.hasValidConfiguration()) {
      this.error.set('Configure FHIR base URL in Settings.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.selectedReport.set(null);
    try {
      const measureRef = m.url ?? `Measure/${m.id}`;
      const bundle = await firstValueFrom(this.measureService.searchMeasureReports({ measure: measureRef, _count: 50 }));
      const entries = bundle?.entry ?? [];
      this.reports.set(entries.map(e => e.resource!).filter((r): r is MeasureReport => r?.resourceType === 'MeasureReport'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load reports.';
      this.error.set(msg);
      this.toastService.showError(msg, 'Reports');
      this.reports.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected selectReport(report: MeasureReport | null): void {
    this.selectedReport.set(report);
  }

  protected getReportDisplay(report: MeasureReport): string {
    return report.id ?? report.measure ?? 'Report';
  }
}
