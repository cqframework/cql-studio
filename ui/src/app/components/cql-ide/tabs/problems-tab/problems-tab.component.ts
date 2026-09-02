// Author: Preston Lee

import {Component, ChangeDetectionStrategy, computed, inject} from '@angular/core';
import { IdeStateService } from '../../../../services/ide-state.service';
import {
  parseProblemMessage,
  ParsedProblemMessage
} from '../../../../services/cql-problems-message.lib';

@Component({
  selector: 'app-problems-tab',
  imports: [],
  templateUrl: './problems-tab.component.html',

  styleUrls: ['./problems-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProblemsTabComponent {
  protected readonly ideStateService = inject(IdeStateService);

  protected readonly syntaxErrors = computed(
    () => this.ideStateService.editorState().syntaxErrors
  );

  protected readonly isValidSyntax = computed(
    () => this.ideStateService.editorState().isValidSyntax
  );

  parse(error: string): ParsedProblemMessage {
    return parseProblemMessage(error);
  }

  iconClass(error: string): string {
    const severity = this.parse(error).severity;
    if (severity === 'warning') {
      return 'bi bi-exclamation-triangle text-warning';
    }
    if (severity === 'info') {
      return 'bi bi-info-circle text-info';
    }
    return 'bi bi-exclamation-octagon text-danger';
  }

  onProblemClick(error: string): void {
    const parsed = this.parse(error);
    if (parsed.line == null) {
      return;
    }
    const column = parsed.column != null ? Math.max(0, parsed.column - 1) : 0;
    this.ideStateService.requestNavigateToPosition(parsed.line, column);
  }
}
