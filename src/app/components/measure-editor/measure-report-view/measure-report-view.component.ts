// Author: Preston Lee

import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeasureReport } from 'fhir/r4';

@Component({
  selector: 'app-measure-report-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './measure-report-view.component.html',
  styleUrl: './measure-report-view.component.scss'
})
export class MeasureReportViewComponent {
  report = input<MeasureReport | null>(null);

  protected readonly hasReport = computed(() => !!this.report());
  protected readonly groups = computed(() => this.report()?.group ?? []);

  protected displayQuantity(q: { value?: number; unit?: string; code?: string } | undefined): string {
    if (q == null) return '—';
    const v = q.value;
    if (v == null) return '—';
    const u = q.unit ?? q.code ?? '';
    return u ? `${v} ${u}` : String(v);
  }

  protected getPopulationCode(pop: { code?: { coding?: Array<{ code?: string }> } }): string {
    return pop?.code?.coding?.[0]?.code ?? '—';
  }

  protected getPopulationCount(pop: { count?: number }): string {
    return pop?.count != null ? String(pop.count) : '—';
  }
}
