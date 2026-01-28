// Author: Preston Lee

import { Injectable, computed, signal } from '@angular/core';
import { Coding, Resource } from 'fhir/r4';

export type ClipboardPayload = Resource | Coding;

export type ClipboardItemKind = 'resource' | 'coding';

export type ClipboardSortBy = 'addedAt' | 'type' | 'name';

export type ClipboardSortOrder = 'asc' | 'desc';

export interface ClipboardItem {
  /**
   * Stable identifier used for deduplication and updates.
   * For resources, this is typically based on url or resourceType/id.
   * For codings, this is typically system|code.
   */
  id: string;
  kind: ClipboardItemKind;
  fhirType: string;
  name?: string;
  urlOrSystem?: string;
  code?: string;
  display?: string;
  /**
   * ISO timestamp string for when the item was added.
   * Stored as string to make JSON serialization simple.
   */
  addedAt: string;
  payload: ClipboardPayload;
}

export interface ClipboardQuery {
  search?: string;
  /**
   * Optional filter by FHIR type (e.g., ValueSet, CodeSystem, Coding).
   */
  typeFilter?: string | null;
  sortBy?: ClipboardSortBy;
  sortOrder?: ClipboardSortOrder;
}

@Injectable({
  providedIn: 'root'
})
export class ClipboardService {
  private static readonly STORAGE_KEY = 'cqlStudio.clipboard';

  private readonly _items = signal<ClipboardItem[]>([]);

  /**
   * Reactive list of clipboard items.
   */
  readonly items = computed(() => this._items());

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Return a snapshot of all clipboard items.
   */
  list(): ClipboardItem[] {
    return this._items();
  }

  /**
   * Clear all clipboard items and persisted storage.
   */
  clear(): void {
    this._items.set([]);
    this.saveToStorage();
  }

  /**
   * Add or update a FHIR Resource on the clipboard.
   */
  addResource(resource: Resource): void {
    const id = this.getKeyForResource(resource);
    const now = new Date().toISOString();

    const metadata = this.buildMetadataForResource(resource);

    this._items.update(items => {
      const existingIndex = items.findIndex(item => item.id === id);
      const nextItem: ClipboardItem = {
        id,
        kind: 'resource',
        fhirType: metadata.fhirType,
        name: metadata.name,
        urlOrSystem: metadata.urlOrSystem,
        code: undefined,
        display: metadata.display,
        addedAt: existingIndex >= 0 ? items[existingIndex].addedAt : now,
        payload: resource
      };

      if (existingIndex >= 0) {
        const updated = [...items];
        updated[existingIndex] = nextItem;
        return updated;
      }

      return [...items, nextItem];
    });

    this.saveToStorage();
  }

  /**
   * Add or update a Coding on the clipboard.
   */
  addCoding(coding: Coding): void {
    const id = this.getKeyForCoding(coding);
    const now = new Date().toISOString();

    const metadata = this.buildMetadataForCoding(coding);

    this._items.update(items => {
      const existingIndex = items.findIndex(item => item.id === id);
      const nextItem: ClipboardItem = {
        id,
        kind: 'coding',
        fhirType: 'Coding',
        name: metadata.name,
        urlOrSystem: metadata.urlOrSystem,
        code: metadata.code,
        display: metadata.display,
        addedAt: existingIndex >= 0 ? items[existingIndex].addedAt : now,
        payload: coding
      };

      if (existingIndex >= 0) {
        const updated = [...items];
        updated[existingIndex] = nextItem;
        return updated;
      }

      return [...items, nextItem];
    });

    this.saveToStorage();
  }

  /**
   * Update an existing clipboard item by id.
   */
  update(id: string, patch: Partial<Omit<ClipboardItem, 'id'>>): void {
    this._items.update(items => {
      const index = items.findIndex(item => item.id === id);
      if (index === -1) {
        return items;
      }

      const current = items[index];
      const updated: ClipboardItem = {
        ...current,
        ...patch,
        id: current.id // never allow id to change
      };

      const next = [...items];
      next[index] = updated;
      return next;
    });

    this.saveToStorage();
  }

  /**
   * Remove a single clipboard item by id.
   */
  remove(id: string): void {
    this._items.update(items => items.filter(item => item.id !== id));
    this.saveToStorage();
  }

  /**
   * Query clipboard items with optional text search, type filter, and sorting.
   * Sorting defaults to addedAt descending (newest first).
   */
  query(criteria: ClipboardQuery = {}): ClipboardItem[] {
    const {
      search,
      typeFilter,
      sortBy = 'addedAt',
      sortOrder = 'desc'
    } = criteria;

    let results = [...this._items()];

    if (typeFilter) {
      const typeLower = typeFilter.toLowerCase();
      results = results.filter(item => item.fhirType.toLowerCase() === typeLower);
    }

    if (search && search.trim().length > 0) {
      const term = search.toLowerCase();
      results = results.filter(item => {
        return (
          (item.name && item.name.toLowerCase().includes(term)) ||
          (item.urlOrSystem && item.urlOrSystem.toLowerCase().includes(term)) ||
          (item.code && item.code.toLowerCase().includes(term)) ||
          (item.display && item.display.toLowerCase().includes(term)) ||
          item.fhirType.toLowerCase().includes(term)
        );
      });
    }

    results.sort((a, b) => {
      const valueA = this.getSortValue(a, sortBy);
      const valueB = this.getSortValue(b, sortBy);

      if (valueA < valueB) {
        return sortOrder === 'asc' ? -1 : 1;
      }
      if (valueA > valueB) {
        return sortOrder === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return results;
  }

  /**
   * Convenience method primarily for the Settings UI.
   * Clears the clipboard and removes persisted storage.
   */
  resetClipboard(): void {
    this.clear();
  }

  private getKeyForResource(resource: Resource): string {
    const anyResource = resource as any;
    const url: string | undefined = typeof anyResource.url === 'string' ? anyResource.url.trim() : undefined;
    if (url && url.length > 0) {
      return `resource-url:${url}`;
    }

    const id: string | undefined = typeof anyResource.id === 'string' ? anyResource.id.trim() : undefined;
    if (id && id.length > 0) {
      return `${resource.resourceType}/${id}`;
    }

    // Fallback to a hash based on resourceType and JSON
    return `resource:${resource.resourceType}:${this.simpleHash(JSON.stringify(resource))}`;
  }

  private getKeyForCoding(coding: Coding): string {
    const system = (coding.system || '').trim() || 'unknown-system';
    const code = (coding.code || '').trim() || 'unknown-code';
    return `coding:${system}|${code}`;
  }

  private buildMetadataForResource(resource: Resource): {
    fhirType: string;
    name?: string;
    urlOrSystem?: string;
    display?: string;
  } {
    const anyResource = resource as any;
    const fhirType = resource.resourceType || 'Resource';

    const name: string | undefined =
      typeof anyResource.name === 'string'
        ? anyResource.name
        : Array.isArray(anyResource.name) && anyResource.name.length > 0 && typeof anyResource.name[0] === 'string'
        ? anyResource.name[0]
        : anyResource.title || anyResource.id;

    const urlOrSystem: string | undefined = typeof anyResource.url === 'string' ? anyResource.url : undefined;

    const display: string | undefined = anyResource.title || anyResource.description;

    return {
      fhirType,
      name,
      urlOrSystem,
      display
    };
  }

  private buildMetadataForCoding(coding: Coding): {
    name?: string;
    urlOrSystem?: string;
    code?: string;
    display?: string;
  } {
    const code = coding.code || undefined;
    const display = coding.display || undefined;
    const urlOrSystem = coding.system || undefined;
    const name = display || code || undefined;

    return {
      name,
      urlOrSystem,
      code,
      display
    };
  }

  private getSortValue(item: ClipboardItem, sortBy: ClipboardSortBy): string | number {
    switch (sortBy) {
      case 'addedAt': {
        const time = Date.parse(item.addedAt || '');
        return isNaN(time) ? 0 : time;
      }
      case 'type':
        return item.fhirType.toLowerCase();
      case 'name':
      default:
        return (item.name || '').toLowerCase();
    }
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(ClipboardService.STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const restored: ClipboardItem[] = [];

      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }

        const id = typeof entry.id === 'string' ? entry.id : undefined;
        const kind = entry.kind === 'coding' ? 'coding' : 'resource';
        const fhirType = typeof entry.fhirType === 'string' ? entry.fhirType : 'Resource';
        const addedAt =
          typeof entry.addedAt === 'string' && entry.addedAt.length > 0
            ? entry.addedAt
            : new Date().toISOString();

        if (!id || !entry.payload) {
          continue;
        }

        const item: ClipboardItem = {
          id,
          kind,
          fhirType,
          name: typeof entry.name === 'string' ? entry.name : undefined,
          urlOrSystem: typeof entry.urlOrSystem === 'string' ? entry.urlOrSystem : undefined,
          code: typeof entry.code === 'string' ? entry.code : undefined,
          display: typeof entry.display === 'string' ? entry.display : undefined,
          addedAt,
          payload: entry.payload as ClipboardPayload
        };

        restored.push(item);
      }

      if (restored.length > 0) {
        this._items.set(restored);
      }
    } catch (error) {
      // If anything goes wrong, fail silently and start with an empty clipboard
      // eslint-disable-next-line no-console
      console.warn('Failed to load clipboard from storage:', error);
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }

    try {
      const serialized = JSON.stringify(this._items());
      window.localStorage.setItem(ClipboardService.STORAGE_KEY, serialized);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to save clipboard to storage:', error);
    }
  }

  private simpleHash(value: string): string {
    let hash = 0;
    if (!value) {
      return '0';
    }
    for (let i = 0; i < value.length; i++) {
      const chr = value.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return hash.toString(16);
  }
}

