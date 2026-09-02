/**
 * @cqframework/elm-to-sql
 *
 * Standalone ESM library for transpiling CQL ELM (Expression Logical Model)
 * to SQL-on-FHIR queries and generating FHIR MeasureReport resources.
 *
 * Usage:
 *   import { ElmToSqlTranspiler, generateMeasureReport } from '@cqframework/elm-to-sql';
 *
 *   const transpiler = new ElmToSqlTranspiler({ measurementPeriodStart: '2024-01-01', measurementPeriodEnd: '2024-12-31' });
 *   const { sql, populations, warnings } = transpiler.transpile(elmLibraryJson);
 *
 *   // Execute sql via your own DB adapter, then:
 *   const report = generateMeasureReport(counts, { measureUrl: '...', periodStart: '2024-01-01', periodEnd: '2024-12-31' });
 */

// Core transpiler
export { ElmToSqlTranspiler } from './transpiler/elm-to-sql';
export type { TranspilerOptions, TranspileResult } from './transpiler/elm-to-sql';

// ELM types — re-exported for consumers building ELM inputs
export type {
  ElmLibraryWrapper,
  ElmLibrary,
  ElmVersionedIdentifier,
  ElmExpressionDef,
  ElmExpression,
  ElmRetrieve,
  ElmQuery,
  ElmBinaryOp,
  ElmUnaryOp,
  ElmFunctionRef,
  ElmExpressionRef,
  ElmLiteral,
  ElmProperty,
  ElmInterval,
  ElmParameterRef,
  ElmValueSetRef,
  ElmValueSetDef,
  ElmCodeSystemDef,
} from './types/elm';
export { stripFhirNamespace, toSqlIdentifier } from './types/elm';

// MeasureReport generator
export { generateMeasureReport, sqlRowToPopulationCounts } from './measure/measure-report';
export type { PopulationCounts, MeasureReportOptions } from './measure/measure-report';
export { MEASURE_POPULATION_NAMES, isStandardPopulationName } from '../measure-population.lib';
export {
  inferMeasureUrlFromLibrary,
  normalizeMeasureReportForServer,
  validateMeasureReportRequiredFields,
} from './measure/measure-report-normalize.lib';
export type { MeasureReportServerMode } from './measure/measure-report-normalize.lib';

// SQL-on-FHIR ViewDefinitions
export {
  STANDARD_VIEW_DEFINITIONS,
  viewDefinitionToSql,
  generateAllViewsSql,
} from './views/view-definitions';
export type {
  ViewDefinition,
  ViewDefinitionSelect,
  ViewDefinitionColumn,
  SqlViewDefinition,
} from './views/view-definitions';

// Value set utilities
export { extractValueSets, extractUsedValueSets } from './valueset/value-set-extractor';
export type { ValueSetReference } from './valueset/value-set-extractor';

export { loadValueSetExpansions } from './valueset/value-set-loader';
export type { ValueSetExpansionRow, ValueSetLoadResult } from './valueset/value-set-loader';

export {
  generateValueSetTableDdl,
  generateValueSetInsertSql,
  generateValueSetUpsertSql,
  generateValueSetSeedScript,
} from './valueset/value-set-sql';
