// Author: Preston Lee

import type { ClipboardQuery } from '../clipboard.service';
import { BaseBrowserTool } from './base-browser-tool';

const MAX_ITEMS = 50;

export class ListClipboardTool extends BaseBrowserTool {
  static readonly id = 'list_clipboard';
  static override planModeAllowed = true;
  static override statusMessage = 'Listing clipboard...';
  readonly name = ListClipboardTool.id;
  readonly description = 'List or query items on the FHIR clipboard (ValueSets, CodeSystems, Codings, etc.). Use search or typeFilter to narrow results.';
  readonly parameters = {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Optional text search in name, url, code, display, or type' },
      typeFilter: { type: 'string', description: 'Optional FHIR type filter (e.g. ValueSet, CodeSystem, Coding)' },
      sortBy: { type: 'string', description: 'Sort by: addedAt, type, or name (default: addedAt)' },
      sortOrder: { type: 'string', description: 'Sort order: asc or desc (default: desc)' }
    }
  };

  execute(params: Record<string, unknown>): unknown {
    const search = params['search'] as string | undefined;
    const typeFilter = params['typeFilter'] as string | undefined;
    const sortBy = params['sortBy'] as ClipboardQuery['sortBy'];
    const sortOrder = params['sortOrder'] as ClipboardQuery['sortOrder'];

    const criteria: ClipboardQuery = {};
    if (search != null) criteria.search = search;
    if (typeFilter != null) criteria.typeFilter = typeFilter;
    if (sortBy != null) criteria.sortBy = sortBy;
    if (sortOrder != null) criteria.sortOrder = sortOrder;

    const items = this.ctx.clipboardService.query(criteria);
    const limited = items.slice(0, MAX_ITEMS);

    return {
      count: items.length,
      returned: limited.length,
      items: limited.map(item => ({
        id: item.id,
        kind: item.kind,
        fhirType: item.fhirType,
        name: item.name,
        urlOrSystem: item.urlOrSystem,
        code: item.code,
        display: item.display,
        addedAt: item.addedAt,
        payload: item.payload
      }))
    };
  }
}
