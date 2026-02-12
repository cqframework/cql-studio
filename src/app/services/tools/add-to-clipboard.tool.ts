// Author: Preston Lee

import { Coding, Resource } from 'fhir/r4';
import { BaseBrowserTool } from './base-browser-tool';

function isResource(obj: unknown): obj is Resource {
  return typeof obj === 'object' && obj != null && 'resourceType' in obj && typeof (obj as Resource).resourceType === 'string';
}

function isCoding(obj: unknown): obj is Coding {
  return typeof obj === 'object' && obj != null && 'system' in obj && 'code' in obj;
}

export class AddToClipboardTool extends BaseBrowserTool {
  static readonly id = 'add_to_clipboard';
  static override statusMessage = 'Adding to clipboard...';
  readonly name = AddToClipboardTool.id;
  readonly description = 'Add a FHIR resource (e.g. ValueSet, CodeSystem) or Coding to the clipboard. Pass the full JSON payload.';
  readonly parameters = {
    type: 'object',
    properties: {
      payload: {
        type: 'object',
        description: 'FHIR Resource (must have resourceType) or Coding (must have system and code) as JSON object'
      }
    },
    required: ['payload']
  };

  execute(params: Record<string, unknown>): unknown {
    const payload = params['payload'];
    if (payload == null || typeof payload !== 'object') {
      throw new Error('payload is required and must be a JSON object (FHIR Resource or Coding)');
    }

    if (isResource(payload)) {
      this.ctx.clipboardService.addResource(payload);
      return {
        message: 'Resource added to clipboard',
        kind: 'resource',
        resourceType: payload.resourceType
      };
    }
    if (isCoding(payload)) {
      this.ctx.clipboardService.addCoding(payload);
      return {
        message: 'Coding added to clipboard',
        kind: 'coding',
        system: payload.system,
        code: payload.code
      };
    }

    throw new Error(
      'payload must be a FHIR Resource (with resourceType) or a Coding (with system and code)'
    );
  }
}
