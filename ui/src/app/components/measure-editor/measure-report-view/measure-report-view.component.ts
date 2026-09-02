// Author: Preston Lee

import { Component, input, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { MeasureReport } from 'fhir/r4';
import { SyntaxHighlighterComponent } from '../../shared/syntax-highlighter/syntax-highlighter.component';
import {
  formatMeasureScoreQuantity,
  formatReference,
  getPopulationLabel,
  hasPopulations,
} from '../measure-report-display.lib';

@Component({
  selector: 'app-measure-report-view',
  imports: [SyntaxHighlighterComponent],
  templateUrl: './measure-report-view.component.html',
  styleUrl: './measure-report-view.component.scss',

  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeasureReportViewComponent {
  report = input<MeasureReport | null>(null);
  showRawJson = input(false);
  hideHeader = input(false);

  protected readonly groups = computed(() => this.report()?.group ?? []);
  protected readonly hasPopulations = computed(() => hasPopulations(this.report()));
  protected readonly rawJson = computed(() => {
    const r = this.report();
    return r ? JSON.stringify(r, null, 2) : '';
  });
  protected readonly showJsonPanel = signal(false);

  protected readonly getPopulationLabel = getPopulationLabel;
  protected readonly formatMeasureScoreQuantity = formatMeasureScoreQuantity;
  protected readonly formatReference = formatReference;

  protected toggleJsonPanel(): void {
    this.showJsonPanel.update(v => !v);
  }
}
