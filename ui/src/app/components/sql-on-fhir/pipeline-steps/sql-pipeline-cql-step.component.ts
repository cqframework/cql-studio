// Author: Preston Lee
// Editable authoring mode: Eugene Vestel

import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SyntaxHighlighterComponent } from '../../shared/syntax-highlighter/syntax-highlighter.component';

@Component({
  selector: 'app-sql-pipeline-cql-step',
  standalone: true,
  imports: [FormsModule, SyntaxHighlighterComponent],
  templateUrl: './sql-pipeline-cql-step.component.html',
  styleUrl: './sql-pipeline-cql-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SqlPipelineCqlStepComponent {
  readonly cqlPreview = input('');
  /** Emitted when the user applies edits; parent re-runs translation + SQL generation. */
  readonly cqlChanged = output<string>();

  protected readonly isEditing = signal(false);
  protected readonly draft = signal('');
  /** Original CQL captured when edit mode was entered, for Revert. */
  private original = '';

  constructor() {
    // If the library selection changes underneath an open editor, exit edit mode
    // so the editor never shows stale content.
    effect(() => {
      const preview = this.cqlPreview();
      if (this.isEditing() && preview !== this.draft() && preview !== this.original) {
        this.isEditing.set(false);
      }
    });
  }

  protected startEditing(): void {
    this.original = this.cqlPreview();
    this.draft.set(this.original);
    this.isEditing.set(true);
  }

  protected apply(): void {
    this.isEditing.set(false);
    if (this.draft() !== this.original) {
      this.cqlChanged.emit(this.draft());
    }
  }

  protected revert(): void {
    this.draft.set(this.original);
    this.isEditing.set(false);
  }
}
