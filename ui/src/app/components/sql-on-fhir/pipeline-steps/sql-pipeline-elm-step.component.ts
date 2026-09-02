// Author: Preston Lee

import { Component, input } from '@angular/core';
import { SyntaxHighlighterComponent } from '../../shared/syntax-highlighter/syntax-highlighter.component';

@Component({
  selector: 'app-sql-pipeline-elm-step',
  imports: [SyntaxHighlighterComponent],
  templateUrl: './sql-pipeline-elm-step.component.html',
  styleUrl: './sql-pipeline-elm-step.component.scss',

})
export class SqlPipelineElmStepComponent {
  readonly elmTranslationErrors = input<string[]>([]);
  readonly elmTranslationWarnings = input<string[]>([]);
  readonly elmTranslationMessages = input<string[]>([]);
  readonly isTranslatingElm = input(false);
  readonly formattedElmXml = input('');
  readonly cqlPreview = input('');
  readonly hasElmTranslationErrors = input(false);
  readonly hasElmTranslationWarnings = input(false);
}
