// Author: Preston Lee

import {Component, ChangeDetectionStrategy, signal} from '@angular/core';

@Component({
  selector: 'app-results-documentation',
  imports: [],
  templateUrl: './results-documentation.component.html',

  styleUrl: './results-documentation.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsDocumentationComponent {
  protected readonly activeTab = signal('query-parameters');

  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
  }
}
