// Author: Preston Lee

import {Component, ChangeDetectionStrategy, computed, inject, input, linkedSignal} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IdeStateService, IdeValuesetPeekResult } from '../../../../services/ide-state.service';
import { TerminologyResourceOpenerService } from '../../../../services/terminology-resource-opener.service';

@Component({
  selector: 'app-valueset-peek-tab',
  imports: [FormsModule],
  templateUrl: './valueset-peek-tab.component.html',
  styleUrls: ['./valueset-peek-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValuesetPeekTabComponent {
  private readonly ideStateService = inject(IdeStateService);
  private readonly terminologyOpener = inject(TerminologyResourceOpenerService);

  /** Bound from the panel so zoneless CD delivers updates with the panel refresh. */
  readonly result = input<IdeValuesetPeekResult | null>(null);

  /** Resets whenever a new peek result arrives. */
  readonly filterTerm = linkedSignal(() => {
    this.result();
    return '';
  });

  readonly filteredCodes = computed(() => {
    const peek = this.result();
    if (!peek) {
      return [];
    }
    const term = this.filterTerm().trim().toLowerCase();
    if (!term) {
      return peek.codes;
    }
    return peek.codes.filter((code) => {
      const haystack = [code.system, code.code, code.display]
        .filter((part): part is string => !!part)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  });

  async onOpenInTerminology(): Promise<void> {
    const peek = this.result();
    if (!peek?.id) {
      return;
    }
    await this.terminologyOpener.requestOpen({
      resourceType: 'ValueSet',
      id: peek.id,
      url: peek.url
    });
  }

  onClear(): void {
    this.ideStateService.setValuesetPeekResult(null);
  }
}
