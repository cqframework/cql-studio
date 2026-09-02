// Author: Preston Lee

import { Component, input } from '@angular/core';
import { SyntaxHighlighterComponent } from '../../shared/syntax-highlighter/syntax-highlighter.component';

@Component({
  selector: 'app-sql-pipeline-sql-gen-step',
  imports: [SyntaxHighlighterComponent],
  templateUrl: './sql-pipeline-sql-gen-step.component.html',
  styleUrl: './sql-pipeline-sql-gen-step.component.scss',

})
export class SqlPipelineSqlGenStepComponent {
  readonly sqlText = input('');
}
