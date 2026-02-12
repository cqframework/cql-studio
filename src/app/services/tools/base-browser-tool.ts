// Author: Preston Lee

import type { IdeStateService } from '../ide-state.service';
import type { SettingsService } from '../settings.service';
import type { ClipboardService } from '../clipboard.service';
import type { CqlValidationService } from '../cql-validation.service';
import type { CqlFormatterService } from '../cql-formatter.service';

export interface BrowserToolMCPMetadata {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface BrowserToolContext {
  ideStateService: IdeStateService;
  settingsService: SettingsService;
  clipboardService: ClipboardService;
  cqlValidationService: CqlValidationService;
  cqlFormatterService: CqlFormatterService;
}

export abstract class BaseBrowserTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: BrowserToolMCPMetadata['parameters'];

  /** If true, tool is read-only and allowed in Plan Mode. Default false (blocked). */
  static planModeAllowed: boolean = false;
  /** User-facing message shown while the tool is executing. */
  static statusMessage?: string;

  constructor(protected readonly ctx: BrowserToolContext) {}

  toMCPTool(): BrowserToolMCPMetadata {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters
    };
  }

  abstract execute(params: Record<string, unknown>): unknown;
}
