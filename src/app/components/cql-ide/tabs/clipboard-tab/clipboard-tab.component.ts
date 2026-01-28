// Author: Preston Lee

import { Component, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { output } from '@angular/core';
import { IdeStateService } from '../../../../services/ide-state.service';
import {
  ClipboardItem,
  ClipboardService,
  ClipboardSortBy,
  ClipboardSortOrder
} from '../../../../services/clipboard.service';

@Component({
  selector: 'app-clipboard-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: 'clipboard-tab.component.html',
  styleUrls: ['clipboard-tab.component.scss']
})
export class ClipboardTabComponent {
  // Outputs
  insertCqlCode = output<string>();

  // Local UI state
  private readonly searchSignal = signal<string>('');
  private readonly sortBySignal = signal<ClipboardSortBy>('addedAt');
  private readonly sortOrderSignal = signal<ClipboardSortOrder>('desc');

  // Services
  private readonly clipboardService = inject(ClipboardService);
  private readonly ideStateService = inject(IdeStateService);

  // Derived state
  readonly hasActiveLibrary = computed(() => !!this.ideStateService.activeLibraryId());

  readonly items = computed<ClipboardItem[]>(() =>
    this.clipboardService.query({
      search: this.searchSignal(),
      sortBy: this.sortBySignal(),
      sortOrder: this.sortOrderSignal()
    })
  );

  // Accessors for template binding to signals
  get searchTerm(): string {
    return this.searchSignal();
  }

  set searchTerm(value: string) {
    this.searchSignal.set(value);
  }

  get sortBy(): ClipboardSortBy {
    return this.sortBySignal();
  }

  set sortBy(value: ClipboardSortBy) {
    this.sortBySignal.set(value);
  }

  get sortOrder(): ClipboardSortOrder {
    return this.sortOrderSignal();
  }

  // Template handlers
  onSortByChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const value = target.value as ClipboardSortBy;
    this.sortBySignal.set(value);
  }

  toggleSortOrder(): void {
    this.sortOrderSignal.set(this.sortOrderSignal() === 'asc' ? 'desc' : 'asc');
  }

  onClearClipboard(): void {
    this.clipboardService.clear();
  }

  onRemoveItem(item: ClipboardItem, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.clipboardService.remove(item.id);
  }

  onInsertItem(item: ClipboardItem, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    if (!this.canInsertIntoCql(item)) {
      return;
    }

    const cql = this.generateCqlForItem(item);
    if (!cql) {
      return;
    }

    this.insertCqlCode.emit(cql);
  }

  canInsertIntoCql(item: ClipboardItem): boolean {
    if (!this.hasActiveLibrary()) {
      return false;
    }

    if (item.kind === 'coding') {
      const coding = item.payload as any;
      return !!coding && !!coding.system && !!coding.code;
    }

    const resource: any = item.payload;
    if (!resource || !resource.resourceType) {
      return false;
    }

    if (resource.resourceType === 'ValueSet' || resource.resourceType === 'CodeSystem') {
      return !!resource.url;
    }

    return false;
  }

  getIconForItem(item: ClipboardItem): string {
    const resource: any = item.payload;
    if (item.kind === 'coding') {
      return '123';
    }
    switch (resource?.resourceType) {
      case 'ValueSet':
        return 'collection';
      case 'CodeSystem':
        return 'database';
      case 'Library':
        return 'book';
      default:
        return 'file-earmark';
    }
  }

  getTypeLabel(item: ClipboardItem): string {
    const resource: any = item.payload;
    if (item.kind === 'coding') {
      return 'Coding';
    }
    return resource?.resourceType || item.fhirType || 'Resource';
  }

  getAddedAtLabel(item: ClipboardItem): string {
    try {
      const dt = new Date(item.addedAt);
      if (isNaN(dt.getTime())) {
        return '';
      }
      return dt.toLocaleString();
    } catch {
      return '';
    }
  }

  private generateCqlForItem(item: ClipboardItem): string | null {
    if (!this.hasActiveLibrary()) {
      return null;
    }

    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    const currentContent = activeLibrary?.cqlContent || '';

    if (item.kind === 'coding') {
      return this.generateCqlForCoding(item, currentContent);
    }

    const resource: any = item.payload;
    if (!resource || !resource.resourceType) {
      return null;
    }

    if (resource.resourceType === 'ValueSet') {
      return this.generateCqlForValueSet(resource);
    }

    if (resource.resourceType === 'CodeSystem') {
      return this.generateCqlForCodeSystem(resource);
    }

    return null;
  }

  private generateCqlForValueSet(valueSet: any): string | null {
    if (!valueSet.url) {
      return null;
    }

    const nameSource = valueSet.name || valueSet.title || valueSet.id || 'ValueSet';
    const safeName = this.sanitizeIdentifier(nameSource);
    const url = this.escapeCqlString(valueSet.url);

    return `valueset "${safeName}": '${url}'\n`;
  }

  private generateCqlForCodeSystem(codeSystem: any): string | null {
    if (!codeSystem.url) {
      return null;
    }

    const nameSource = codeSystem.name || codeSystem.title || codeSystem.id || 'CodeSystem';
    const safeName = this.sanitizeIdentifier(nameSource);
    const url = this.escapeCqlString(codeSystem.url);

    return `codesystem "${safeName}": '${url}'\n`;
  }

  private generateCqlForCoding(item: ClipboardItem, currentContent: string): string | null {
    const coding = item.payload as any;
    if (!coding || !coding.system || !coding.code) {
      return null;
    }

    const systemUri: string = coding.system;
    const code: string = coding.code;
    const display: string | undefined = coding.display;

    const existing = this.findExistingCodesystemDeclarations(currentContent);
    const existingByUri = existing.find(e => e.uri === systemUri);
    const existingNames = new Set(existing.map(e => e.name));

    let codesystemName: string;
    let needsCodesystemDeclaration = false;

    if (existingByUri) {
      codesystemName = existingByUri.name;
    } else {
      codesystemName = this.deriveCodesystemName(systemUri, existingNames);
      needsCodesystemDeclaration = true;
    }

    const safeCodeLabelSource = item.name || display || code;
    const safeCodeLabel = this.sanitizeIdentifier(safeCodeLabelSource);
    const escapedSystem = this.escapeCqlString(systemUri);
    const escapedCode = this.escapeCqlString(code);
    const displayClause = display ? ` display '${this.escapeCqlString(display)}'` : '';

    const lines: string[] = [];

    if (needsCodesystemDeclaration) {
      lines.push(`codesystem "${codesystemName}": '${escapedSystem}'`);
    }

    lines.push(
      `code "${safeCodeLabel}": '${escapedCode}' from "${codesystemName}"${displayClause}`
    );

    return lines.join('\n') + '\n';
  }

  private findExistingCodesystemDeclarations(content: string): Array<{ name: string; uri: string }> {
    const results: Array<{ name: string; uri: string }> = [];
    const regex = /codesystem\s+"([^"]+)"\s*:\s*'([^']+)'/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const uri = match[2];
      results.push({ name, uri });
    }
    return results;
  }

  private deriveCodesystemName(systemUri: string, existingNames: Set<string>): string {
    const knownMap: Record<string, string> = {
      'http://loinc.org': 'LOINC',
      'http://snomed.info/sct': 'SNOMED',
      'http://hl7.org/fhir/sid/icd-10-cm': 'ICD10CM'
    };

    if (knownMap[systemUri]) {
      const candidate = knownMap[systemUri];
      if (!existingNames.has(candidate)) {
        return candidate;
      }
    }

    let base = systemUri;
    const hashIndex = base.lastIndexOf('#');
    const slashIndex = base.lastIndexOf('/');
    const idx = Math.max(hashIndex, slashIndex);
    if (idx >= 0 && idx < base.length - 1) {
      base = base.substring(idx + 1);
    }

    base = base.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!base) {
      base = 'CODESYSTEM';
    }

    let candidate = base;
    let counter = 1;
    while (existingNames.has(candidate)) {
      candidate = `${base}_${counter}`;
      counter += 1;
    }

    return candidate;
  }

  private sanitizeIdentifier(name: string): string {
    const trimmed = (name || '').toString().trim();
    if (!trimmed) {
      return 'Unnamed';
    }
    // Remove double quotes to keep CQL identifier valid within quotes
    return trimmed.replace(/"/g, '\'');
  }

  private escapeCqlString(value: string): string {
    return (value || '').replace(/'/g, "''");
  }
}

