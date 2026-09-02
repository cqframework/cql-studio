// Author: Preston Lee

import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  EXAMPLE_BADGES,
  EXAMPLE_CATALOG,
  ExampleBadge
} from './examples.catalog';

@Component({
  selector: 'app-examples',
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './examples.component.html'
})
export class ExamplesComponent {
  protected readonly allBadges = EXAMPLE_BADGES;
  protected readonly catalogSize = EXAMPLE_CATALOG.length;
  protected readonly searchQuery = signal('');
  protected readonly selectedBadges = signal<Set<ExampleBadge>>(new Set());

  protected readonly filteredExamples = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const badges = this.selectedBadges();
    return EXAMPLE_CATALOG.filter((entry) => {
      if (badges.size > 0 && !entry.badges.some((b) => badges.has(b))) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        entry.title.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q)
      );
    });
  });

  protected readonly isFiltered = computed(
    () => this.searchQuery().trim().length > 0 || this.selectedBadges().size > 0
  );

  protected onSearchInput(value: string): void {
    this.searchQuery.set(value);
  }

  protected toggleBadgeFilter(badge: ExampleBadge): void {
    this.selectedBadges.update((prev) => {
      const next = new Set(prev);
      if (next.has(badge)) {
        next.delete(badge);
      } else {
        next.add(badge);
      }
      return next;
    });
  }

  protected isBadgeSelected(badge: ExampleBadge): boolean {
    return this.selectedBadges().has(badge);
  }

  protected badgeFilterId(badge: ExampleBadge): string {
    return 'examples-filter-' + badge.replaceAll(' ', '-').toLowerCase();
  }
}
