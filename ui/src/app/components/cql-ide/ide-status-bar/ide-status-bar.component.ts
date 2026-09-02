// Author: Preston Lee

import {Component, ChangeDetectionStrategy, computed, input} from '@angular/core';
import { IdeContextType } from '../../../models/ide-context.model';

@Component({
  selector: 'app-ide-status-bar',
  imports: [],
  templateUrl: './ide-status-bar.component.html',

  styleUrls: ['./ide-status-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IdeStatusBarComponent {
  editorState = input<any>();
  isExecuting = input<boolean>(false);
  isEvaluating = input<boolean>(false);
  isTranslating = input<boolean>(false);
  executionProgress = input<number>(0);
  executionStatus = input<string>('');
  selectedContextCount = input<number>(0);
  contextType = input<IdeContextType>('Patient');
  isLoadingLibraries = input<boolean>(false);

  protected readonly cursorPosition = computed(() => this.editorState()?.cursorPosition);
  protected readonly wordCount = computed(() => this.editorState()?.wordCount);
  protected readonly isValidSyntax = computed(() => this.editorState()?.isValidSyntax);
}
