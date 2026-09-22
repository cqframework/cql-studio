// Author: Preston Lee

import { EnvironmentInjector, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { EnvironmentService } from './environment.service';
import { IdeStateService } from './ide-state.service';
import { CqlDebugService } from './cql-debug/cql-debug.service';
import { OpenCodeEditorBridgeService } from './opencode-editor-bridge.service';

/**
 * Reinitializes the IDE when the active environment selection changes.
 * Lives for the app session so a switch made while the IDE route is closed
 * is already applied the next time the route opens.
 */
@Injectable({ providedIn: 'root' })
export class IdeEnvironmentSessionService {
  private readonly injector = inject(EnvironmentInjector);
  private readonly environmentService = inject(EnvironmentService);
  private readonly ideStateService = inject(IdeStateService);
  private readonly cqlDebugService = inject(CqlDebugService);
  private readonly openCodeEditorBridge = inject(OpenCodeEditorBridgeService);

  private boundSelectionKey: string | null = null;

  /** Child IDE views are recreated when this changes. */
  readonly viewGeneration = signal(0);

  constructor() {
    effect(() => {
      const key = this.environmentService.activeSelectionKey();
      untracked(() => this.adopt(key));
    }, { injector: this.injector });
  }

  private adopt(key: string): void {
    if (this.boundSelectionKey === key) {
      return;
    }
    const switching = this.boundSelectionKey !== null || this.hasEditorState();
    this.boundSelectionKey = key;
    if (switching) {
      this.reinitialize();
    }
  }

  private hasEditorState(): boolean {
    return this.ideStateService.libraryResources().length > 0
      || this.ideStateService.outputSections().length > 0
      || this.ideStateService.elmTranslationResults() != null
      || this.ideStateService.findReferencesResult() != null
      || this.ideStateService.valuesetPeekResult() != null
      || this.ideStateService.isExecuting()
      || this.cqlDebugService.isDebugging()
      || this.cqlDebugService.breakpoints().length > 0;
  }

  private reinitialize(): void {
    this.cqlDebugService.resetForEnvironmentChange();
    this.openCodeEditorBridge.clear();
    this.ideStateService.resetEditorSession();
    this.viewGeneration.update(value => value + 1);
  }
}
