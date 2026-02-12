// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class FormatCqlTool extends BaseBrowserTool {
  static readonly id = 'format_cql';
  readonly name = FormatCqlTool.id;
  readonly description =
    'Format CQL code (indentation, operator spacing, etc.) and return the formatted result. Use this to normalize CQL style in string format without modifying the editor.';
  readonly parameters = {
    type: 'object',
    properties: {
      cql: { type: 'string', description: 'The CQL code to format' },
      indentSize: { type: 'number', description: 'Indent size in spaces (optional, defaults to 2)' }
    },
    required: ['cql']
  };

  execute(params: Record<string, unknown>): unknown {
    const cql = params['cql'] as string;
    if (cql == null) {
      throw new Error('cql parameter is required');
    }

    const indentSize = params['indentSize'] as number | undefined;
    const result = this.ctx.cqlFormatterService.format(cql, {
      indentSize: indentSize ?? 2
    });

    return {
      success: result.success,
      formatted: result.formatted,
      errors: result.errors
    };
  }
}
