// Author: Preston Lee

import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal, ChangeDetectionStrategy, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MeasureReport } from 'fhir/r4';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { MeasureService } from '../../../services/measure.service';
import { ToastService } from '../../../services/toast.service';
import { isResourceType } from '../../../services/fhir-resource-type.lib';
import { MeasureReportViewComponent } from '../measure-report-view/measure-report-view.component';

@Component({
  selector: 'app-measure-report-viewer',
  imports: [RouterLink, MeasureReportViewComponent, DatePipe],
  templateUrl: './measure-report-viewer.component.html',
  styleUrl: './measure-report-viewer.component.scss',

  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeasureReportViewerComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly measureService = inject(MeasureService);
  private readonly toastService = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notFound = signal(false);
  protected readonly invalidResource = signal(false);
  protected readonly report = signal<MeasureReport | null>(null);

  protected readonly reportId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('reportId')?.trim() ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('reportId')?.trim() ?? '' }
  );

  private loadGeneration = 0;

  constructor() {
    effect(() => {
      const id = this.reportId();
      untracked(() => {
        void this.loadReport(id);
      });
    });
  }

  protected async retryLoad(): Promise<void> {
    await this.loadReport(this.reportId());
  }

  protected statusBadgeClass(status: string | undefined): string {
    switch (status) {
      case 'complete':
        return 'bg-success';
      case 'pending':
        return 'bg-warning text-dark';
      case 'error':
        return 'bg-danger';
      default:
        return 'bg-secondary';
    }
  }

  protected measureDisplayName(measureUrl: string | undefined): string {
    if (!measureUrl?.trim()) {
      return '—';
    }
    const segment = measureUrl.split('/').filter(Boolean).pop();
    return segment ?? measureUrl;
  }

  private async loadReport(id: string): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.error.set(null);
    this.notFound.set(false);
    this.invalidResource.set(false);
    this.report.set(null);

    if (!id) {
      this.loading.set(false);
      this.notFound.set(true);
      return;
    }

    try {
      const resource = await firstValueFrom(this.measureService.getMeasureReport(id));
      if (generation !== this.loadGeneration) {
        return;
      }
      if (!isResourceType(resource, 'MeasureReport')) {
        this.invalidResource.set(true);
        return;
      }
      this.report.set(resource);
    } catch (err: unknown) {
      if (generation !== this.loadGeneration) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof HttpErrorResponse && err.status === 404) {
        this.notFound.set(true);
      } else if (/404|not found/i.test(msg)) {
        this.notFound.set(true);
      } else {
        this.error.set(msg);
        this.toastService.showError(msg, 'MeasureReport');
      }
    } finally {
      if (generation === this.loadGeneration) {
        this.loading.set(false);
      }
    }
  }
}
