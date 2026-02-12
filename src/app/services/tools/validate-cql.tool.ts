// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class ValidateCqlTool extends BaseBrowserTool {
  static readonly id = 'validate_cql';
  readonly name = ValidateCqlTool.id;
  readonly description =
    'Validate CQL syntax and semantics. Returns errors, warnings, and info messages with line/column locations. Use this to check CQL code before or after making changes.';
  readonly parameters = {
    type: 'object',
    properties: {
      cql: { type: 'string', description: 'The CQL code to validate' }
    },
    required: ['cql']
  };

  execute(params: Record<string, unknown>): unknown {
    const cql = params['cql'] as string;
    if (cql == null) {
      throw new Error('cql parameter is required');
    }

    const result = this.ctx.cqlValidationService.validate(cql);

    const errors = result.errors.map(e => ({
      message: e.message,
      line: e.line,
      column: e.column,
      severity: e.severity
    }));

    const warnings = result.warnings.map(e => ({
      message: e.message,
      line: e.line,
      column: e.column,
      severity: e.severity
    }));

    const messages = result.messages.map(e => ({
      message: e.message,
      line: e.line,
      column: e.column,
      severity: e.severity
    }));

    return {
      hasErrors: result.hasErrors,
      errors,
      warnings,
      messages,
      summary: result.hasErrors
        ? `Validation failed: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`
        : `Validation passed (${result.warnings.length} warning(s), ${result.messages.length} info message(s))`
    };
  }
}
