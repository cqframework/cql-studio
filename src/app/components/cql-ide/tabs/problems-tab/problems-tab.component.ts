// Author: Preston Lee

import { Component, Input, OnInit } from '@angular/core';
import { IdeStateService } from '../../../../services/ide-state.service';

@Component({
  selector: 'app-problems-tab',
  standalone: true,
  imports: [],
  templateUrl: './problems-tab.component.html',
  styleUrls: ['./problems-tab.component.scss']
})
export class ProblemsTabComponent implements OnInit {
  get syntaxErrors() {
    return this.ideStateService.editorState().syntaxErrors;
  }
  
  get isValidSyntax() {
    return this.ideStateService.editorState().isValidSyntax;
  }

  constructor(public ideStateService: IdeStateService) {}

  ngOnInit(): void {
    // Component initialization
  }

  /**
   * Extract the error message without line/column info (for cleaner display)
   */
  getErrorMessage(error: string): string {
    // Error format: "Error: message (line X, column Y)" or "Warning: message (line X, column Y)"
    // Remove the "(line X, column Y)" part for the main message display
    return error.replace(/\s*\(line\s+\d+(?:,\s*column\s+\d+)?\)\s*$/i, '').trim();
  }

  /**
   * Extract line number from error message
   */
  getErrorLine(error: string): number | null {
    // Error format: "Error: message (line X, column Y)" or "Warning: message (line X, column Y)"
    const match = error.match(/\(line\s+(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
    return null;
  }

}
