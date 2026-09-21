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

  protected openFhirValue(value: string): void {
    let opened = false;
    try {
      const parsed: unknown = JSON.parse(value);
      const resource =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { resourceType?: unknown; id?: unknown })
          : null;
      const resourceType =
        typeof resource?.resourceType === 'string' ? resource.resourceType : null;
      const id = typeof resource?.id === 'string' ? resource.id : null;
      const base = this.settingsService.getEffectiveDataEndpointAddress().replace(/\/+$/, '');
      if (resourceType && id && base) {
        window.open(`${base}/${resourceType}/${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer');
        opened = true;
      }
    } catch {
      /* fall through to blob */
    }
    if (opened) {
      return;
    }
    const blob = new Blob([value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
