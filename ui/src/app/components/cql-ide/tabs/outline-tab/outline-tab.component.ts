// Author: Preston Lee

import { ChangeDetectionStrategy, Component, output, computed, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IdeStateService } from '../../../../services/ide-state.service';
import { OutlineItem } from '../../shared/ide-types';

@Component({
  selector: 'app-outline-tab',
  imports: [FormsModule],
  templateUrl: './outline-tab.component.html',

  styleUrls: ['./outline-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutlineTabComponent {
  public readonly outlineSearchTerm = signal('');
  public readonly outlineSortBy = signal<'name' | 'type' | 'line'>('name');
  public readonly outlineSortOrder = signal<'asc' | 'desc'>('asc');

  navigateToLine = output<number>();

  protected readonly ideStateService = inject(IdeStateService);

  public outlineItems = computed(() => {
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    if (!activeLibrary) return [];

    const items: OutlineItem[] = [];
    const lines = activeLibrary.cqlContent.split('\n');
    
    lines.forEach((line: string, index: number) => {
      const trimmed = line.trim();
      const lineNumber = index + 1;
      
      if (trimmed.startsWith('library ')) {
        items.push({ name: trimmed, type: 'library', line: lineNumber });
      } else if (trimmed.startsWith('define ')) {
        const name = trimmed.replace('define ', '').split(':')[0].trim();
        items.push({ name, type: 'define', line: lineNumber });
      } else if (trimmed.startsWith('function ')) {
        const name = trimmed.replace('function ', '').split('(')[0].trim();
        items.push({ name, type: 'function', line: lineNumber });
      } else if (trimmed.startsWith('parameter ')) {
        const name = trimmed.replace('parameter ', '').split(':')[0].trim();
        items.push({ name, type: 'parameter', line: lineNumber });
      } else if (trimmed.startsWith('valueset ')) {
        const name = trimmed.replace('valueset ', '').split(':')[0].trim();
        items.push({ name, type: 'valueset', line: lineNumber });
      } else if (trimmed.startsWith('codesystem ')) {
        const name = trimmed.replace('codesystem ', '').split(':')[0].trim();
        items.push({ name, type: 'codesystem', line: lineNumber });
      }
    });
    
    return items;
  });

  public filteredOutlineItems = computed(() => {
    let filtered = [...this.outlineItems()];
    
    if (this.outlineSearchTerm().trim()) {
      const searchTerm = this.outlineSearchTerm().toLowerCase();
      filtered = filtered.filter(item => 
        item.name.toLowerCase().includes(searchTerm) ||
        item.type.toLowerCase().includes(searchTerm)
      );
    }
    
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (this.outlineSortBy()) {
        case 'name':
          comparison = this.normalizeNameForSorting(a.name).localeCompare(this.normalizeNameForSorting(b.name));
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'line':
          comparison = a.line - b.line;
          break;
      }
      
      return this.outlineSortOrder() === 'asc' ? comparison : -comparison;
    });
    
    return filtered;
  });

  onSortByChange(sortBy: 'name' | 'type' | 'line'): void {
    this.changeOutlineSorting(sortBy);
  }

  changeOutlineSorting(sortBy: 'name' | 'type' | 'line'): void {
    if (this.outlineSortBy() === sortBy) {
      this.outlineSortOrder.set(this.outlineSortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.outlineSortBy.set(sortBy);
      this.outlineSortOrder.set('asc');
    }
  }

  onOutlineItemClick(item: OutlineItem): void {
    this.navigateToLine.emit(item.line);
  }

  trackByOutlineItem(index: number, item: OutlineItem): string {
    return `${item.type}-${item.line}-${item.name}`;
  }

  getIconForType(type: string): string {
    switch (type) {
      case 'library':
        return 'book';
      case 'define':
        return 'code';
      case 'function':
        return 'gear';
      case 'parameter':
        return 'sliders';
      case 'valueset':
        return 'collection';
      case 'codesystem':
        return 'database';
      default:
        return 'file-text';
    }
  }

  private normalizeNameForSorting(name: string): string {
    let normalized = name.trim();
    
    normalized = normalized.replace(/["']/g, '');
    
    if (normalized.startsWith('function ')) {
      normalized = normalized.substring(9);
    }
    
    if (normalized.startsWith('library ')) {
      normalized = normalized.substring(8);
    }
    
    return normalized;
  }
}
