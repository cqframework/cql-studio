// Author: Preston Lee

import {Component, ChangeDetectionStrategy, signal} from '@angular/core';

@Component({
  selector: 'app-runner-documentation',
  imports: [],
  templateUrl: './runner-documentation.component.html',

  styleUrl: './runner-documentation.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunnerDocumentationComponent {
  protected readonly activeTab = signal('overview');

  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
  }
}
