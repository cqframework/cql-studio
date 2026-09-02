# elm-to-sql

In-app library for transpiling CQL ELM (Expression Logical Model) to SQL-on-FHIR queries and generating FHIR MeasureReports. Pure TypeScript, zero runtime dependencies, no Node.js APIs.

Lives inside CQL Studio at [src/app/components/sql-on-fhir/elm-to-sql/](.) so it can be imported directly by the `SqlOnFhirComponent` and its pipeline steps. Self-encapsulated — no app code depends on this directory leaking outward beyond the public surface in [index.ts](./index.ts).

Implements part of the [CQL Studio SQL-on-FHIR epic](https://github.com/cqframework/cql-studio/issues/15) (closes [#16](https://github.com/cqframework/cql-studio/issues/16)).

## Overview

```
CQL source
    │
    ▼ (@cqframework/cql — in-browser translator)
ELM JSON
    │
    ▼ (this library)
SQL query  ──▶  run via app-side adapter (e.g. CQL Studio Server)  ──▶  population counts
                                                                              │
                                                                              ▼
                                                                      FHIR MeasureReport
```

## Usage

Import from anywhere inside the app:

```typescript
import {
  ElmToSqlTranspiler,
  generateMeasureReport,
  sqlRowToPopulationCounts,
  STANDARD_VIEW_DEFINITIONS,
  viewDefinitionToSql,
  generateAllViewsSql,
} from './elm-to-sql';
```

### Transpile ELM → SQL

```typescript
const transpiler = new ElmToSqlTranspiler({
  measurementPeriodStart: '2024-01-01T00:00:00Z',
  measurementPeriodEnd:   '2024-12-31T23:59:59Z',
});

const { sql, populations, warnings } = transpiler.transpile(elmJson);
// elmJson is the output of @cqframework/cql's CqlTranslator.toJson()
// or any ELM library wrapper { library: {...} }
```

The result is a SQL `WITH` block defining one CTE per population define, followed by a `SELECT … COUNT(*) …` aggregator suitable for a single round-trip to the database.

### Convert SQL results → MeasureReport

```typescript
// row is whatever the app's SQL adapter returns from running `sql` above
const counts = sqlRowToPopulationCounts(row);

const report = generateMeasureReport(counts, {
  measureUrl: 'http://ecqi.healthit.gov/ecqms/Measure/BreastCancerScreening',
  periodStart: '2024-01-01',
  periodEnd: '2024-12-31',
});
// POST report to the configured FHIR server via the app's FHIR client
```

### Generate SQL-on-FHIR view DDL

```typescript
// Get all standard FHIR resource ViewDefinition resources (JSON)
STANDARD_VIEW_DEFINITIONS;

// CREATE OR REPLACE VIEW SQL for one resource
const { sql } = viewDefinitionToSql(STANDARD_VIEW_DEFINITIONS[0]);

// All views in a single deployable script
const script = generateAllViewsSql();
```

## Supported ELM node types

| Type | SQL output |
|------|------------|
| `Retrieve` | `SELECT * FROM {resource}_view [WHERE code IN ...]` |
| `Query` | `SELECT ... FROM ... WHERE ...` with WITH/WITHOUT semi-joins |
| `ExpressionRef` | Reference to a CTE |
| `FunctionRef` | `AgeInYearsAt` → `DATE_PART('year', AGE(...))`, `ToDate`, `ToDateTime`, etc. |
| `ParameterRef` | `Measurement Period` → `tsrange(...)` |
| `ValueSetRef` | `code IN (SELECT code FROM value_set_expansion WHERE value_set_id = ...)` |
| `And`/`Or` | `AND`/`OR` |
| `Equal`/`NotEqual`/`Less`/`Greater`/etc. | Standard SQL operators |
| `In`/`During`/`IncludedIn` | `@>` interval containment or `IN` set |
| `Exists` | `EXISTS (SELECT 1 ...)` |
| `Not` | `NOT (...)` |
| `Count`/`Sum`/`Min`/`Max`/`Avg` | `(SELECT COUNT(*)/SUM(...) FROM ...)` |
| `Union`/`Intersect`/`Except` | `UNION ALL`/`INTERSECT`/`EXCEPT` |
| `If`/`Case` | `CASE WHEN ... THEN ... END` |
| `Interval` | `tsrange(low, high, '[)')` |
| `Literal` | SQL literals with type-appropriate quoting |
| `DurationBetween` | `DATE_PART(precision, AGE(...))` |

## SQL assumptions

- Target dialect: **PostgreSQL 14+** (primary). DuckDB is largely compatible.
- Views must exist as flat SQL-on-FHIR tables (see [`STANDARD_VIEW_DEFINITIONS`](./views/view-definitions.ts)).
- Value sets are resolved via a `value_set_expansion(value_set_id, code)` table.
- Interval comparisons use PostgreSQL `tsrange` / `@>` operator.

## API surface

See [index.ts](./index.ts) for the full re-export list. Key entry points:

### `ElmToSqlTranspiler`

```typescript
new ElmToSqlTranspiler(options?: TranspilerOptions)
transpile(elm: ElmLibraryWrapper | ElmLibrary): TranspileResult
```

**TranspilerOptions**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `measurementPeriodStart` | string | Current year Jan 1 | ISO 8601 |
| `measurementPeriodEnd` | string | Current year Dec 31 | ISO 8601 |
| `includeComments` | boolean | `true` | Emit SQL comments |
| `populationDefines` | string[] | auto-detect | Override population define names |

### `generateMeasureReport(counts, options)`

Converts population counts to a FHIR R4 MeasureReport. Does not make FHIR API calls — the app's FHIR client is responsible for persisting.

### `sqlRowToPopulationCounts(row)`

Converts a flat SQL result row (`{ Initial_Population_count: 150, ... }`) to a `PopulationCounts` map.

### `STANDARD_VIEW_DEFINITIONS`

Array of FHIR `ViewDefinition` resources for Patient, Observation, Condition, Procedure, Encounter, MedicationRequest, DiagnosticReport, Coverage, AllergyIntolerance, Immunization, ServiceRequest, and `value_set_expansion`.

### `generateAllViewsSql()`

Returns a PostgreSQL-compatible `CREATE OR REPLACE VIEW` script for all standard views. For HAPI FHIR JPA deployments, prefer the maintained scripts under [scripts/hapi-fhir-sql-on-fhir/](../../../../../scripts/hapi-fhir-sql-on-fhir/) which target HAPI's normalized schema.

## Testing

```bash
npm test
```

Runs via the app's Vitest config — see [vitest.config.ts](../../../../../vitest.config.ts). Tests live next to the source in [elm-to-sql.spec.ts](./elm-to-sql.spec.ts) and load JSON fixtures via ES module imports (no Node `fs`).

## License

Apache 2.0 — inherits from the parent CQL Studio [LICENSE](../../../../../LICENSE).
