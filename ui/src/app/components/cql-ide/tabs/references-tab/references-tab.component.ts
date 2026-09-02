// Author: Preston Lee

import {Component, ChangeDetectionStrategy, computed, inject, input, linkedSignal} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IdeFindReferencesResult, IdeStateService } from '../../../../services/ide-state.service';

@Component({
  selector: 'app-references-tab',
  imports: [FormsModule],
  templateUrl: './references-tab.component.html',
  styleUrls: ['./references-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferencesTabComponent {
  private readonly ideStateService = inject(IdeStateService);

  /** Bound from the panel so zoneless CD delivers updates with the panel refresh. */
  readonly result = input<IdeFindReferencesResult | null>(null);

  /** Resets whenever a new references result arrives. */
  readonly filterTerm = linkedSignal(() => {
    this.result();
    return '';
  });

  readonly filteredLocations = computed(() => {
    const refs = this.result();
    if (!refs) {
      return [];
    }
    const term = this.filterTerm().trim().toLowerCase();
    if (!term) {
      return refs.locations;
    }
    return refs.locations.filter((loc) => {
      const haystack = [
        loc.preview,
        loc.kind,
        String(loc.line),
        String(loc.column)
      ].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  });

  onNavigate(line: number, column: number): void {
    this.ideStateService.requestNavigateToPosition(line, column);
  }

  onClear(): void {
    this.ideStateService.setFindReferencesResult(null);
  }
}
