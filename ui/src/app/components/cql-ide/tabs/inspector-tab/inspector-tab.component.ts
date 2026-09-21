// Author: Preston Lee

import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CqlDebugService } from '../../../../services/cql-debug/cql-debug.service';
import { IdeStateService } from '../../../../services/ide-state.service';
import { SettingsService } from '../../../../services/settings.service';

@Component({
  selector: 'app-inspector-tab',
  imports: [FormsModule],
  templateUrl: './inspector-tab.component.html',
  styleUrls: ['./inspector-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorTabComponent {
  protected readonly debugService = inject(CqlDebugService);
  private readonly ideStateService = inject(IdeStateService);
  private readonly settingsService = inject(SettingsService);

  constructor() {
    effect(() => {
      const focusId = this.debugService.focusBreakpointId();
      if (!focusId) {
        return;
      }
      // Clear after Inspector has had a chance to highlight the row.
      queueMicrotask(() => this.debugService.clearFocusBreakpoint());
    });
  }

  protected resume(): void {
    this.debugService.resume();
  }

  protected stepInto(): void {
    this.debugService.stepInto();
  }

  protected stepOver(): void {
    this.debugService.stepOver();
  }

  protected stepOut(): void {
    this.debugService.stepOut();
  }

  protected stop(): void {
    this.debugService.stop();
  }

  protected selectCallStackFrame(index: number, line: number | null): void {
    this.debugService.selectStackFrame(index);
    // Navigation is also triggered via pausedLine → setDebugPausedLine(scrollIntoView);
    // keep an explicit navigate for library-aware pending navigation.
    this.navigateToLine(line);
  }

  protected onConditionChange(id: string, value: string): void {
    this.debugService.updateBreakpointCondition(id, value);
  }

  protected onEnabledChange(id: string, enabled: boolean): void {
    this.debugService.setBreakpointEnabled(id, enabled);
  }

  protected removeBreakpoint(id: string): void {
    this.debugService.removeBreakpoint(id);
  }

  protected navigateToLine(line: number | null): void {
    if (line == null) {
      return;
    }
    this.ideStateService.requestNavigateToPosition(line, 0);
  }

  protected logFhirValue(label: string, value: string): void {
    this.ideStateService.addJsonOutput(`Debug: ${label}`, value, 'success');
    this.ideStateService.activateOutputTab();
  }

  /**
   * True when the displayed FHIR value is a single resource (JSON object or
   * compact `ResourceType/id`), not a list or list summary.
   */
  protected canOpenFhirValueInNewTab(value: string): boolean {
    return this.resolveSingleFhirResourceRef(value) != null;
  }

  protected openFhirValue(value: string): void {
    const ref = this.resolveSingleFhirResourceRef(value);
    const base = this.settingsService.getEffectiveDataEndpointAddress().replace(/\/+$/, '');
    if (ref?.id && base) {
      window.open(`${base}/${ref.resourceType}/${encodeURIComponent(ref.id)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!this.isSingleFhirResourceJson(value)) {
      return;
    }
    const blob = new Blob([value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  private resolveSingleFhirResourceRef(
    value: string,
  ): { resourceType: string; id: string | null } | null {
    const trimmed = value.trim();
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      const resource = parsed as { resourceType?: unknown; id?: unknown };
      if (typeof resource.resourceType !== 'string' || !resource.resourceType) {
        return null;
      }
      return {
        resourceType: resource.resourceType,
        id: typeof resource.id === 'string' ? resource.id : null,
      };
    } catch {
      const match = /^([A-Z][A-Za-z0-9]+)\/([^/\s]+)$/.exec(trimmed);
      if (!match) {
        return null;
      }
      return { resourceType: match[1], id: match[2] };
    }
  }

  private isSingleFhirResourceJson(value: string): boolean {
    try {
      const parsed: unknown = JSON.parse(value);
      return (
        !!parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as { resourceType?: unknown }).resourceType === 'string'
      );
    } catch {
      return false;
    }
  }
}
