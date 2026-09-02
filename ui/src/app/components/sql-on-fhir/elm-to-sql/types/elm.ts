/**
 * HL7 ELM (Expression Logical Model) JSON type definitions.
 *
 * These match the JSON output of the @cqframework/cql cql-to-elm translator
 * (translator.toJson() or the parsed XML form). The ELM spec is at:
 * https://cql.hl7.org/elm.html
 *
 * Top-level shape: { library: ElmLibrary }
 */

// ─── Library ────────────────────────────────────────────────────────────────

export interface ElmLibraryWrapper {
  library: ElmLibrary;
}

export interface ElmLibrary {
  identifier: ElmVersionedIdentifier;
  schemaIdentifier: ElmVersionedIdentifier;
  annotation?: ElmAnnotation[];
  usings?: { def?: ElmUsingDef[] };
  includes?: { def?: ElmIncludeDef[] };
  parameters?: { def?: ElmParameterDef[] };
  codeSystems?: { def?: ElmCodeSystemDef[] };
  valueSets?: { def?: ElmValueSetDef[] };
  codes?: { def?: ElmCodeDef[] };
  concepts?: { def?: ElmConceptDef[] };
  statements?: { def?: ElmExpressionDef[] };
}

export interface ElmVersionedIdentifier {
  id: string;
  system?: string;
  version?: string;
}

export interface ElmAnnotation {
  type: string;
  s?: { r?: string; t?: string };
}

// ─── Definitions ─────────────────────────────────────────────────────────────

export interface ElmUsingDef {
  localIdentifier: string;
  uri: string;
  version?: string;
}

export interface ElmIncludeDef {
  localIdentifier: string;
  path: string;
  version?: string;
}

export interface ElmParameterDef {
  name: string;
  accessLevel?: 'Public' | 'Private';
  default?: ElmExpression;
  parameterTypeSpecifier?: ElmTypeSpecifier;
}

export interface ElmCodeSystemDef {
  name: string;
  id: string;
  version?: string;
  accessLevel?: 'Public' | 'Private';
}

export interface ElmValueSetDef {
  name: string;
  id: string;
  version?: string;
  accessLevel?: 'Public' | 'Private';
}

export interface ElmCodeDef {
  name: string;
  id: string;
  codeSystem: { name: string };
  display?: string;
  accessLevel?: 'Public' | 'Private';
}

export interface ElmConceptDef {
  name: string;
  display?: string;
  code?: Array<{ name: string }>;
  accessLevel?: 'Public' | 'Private';
}

export interface ElmExpressionDef {
  name: string;
  context?: string;
  accessLevel?: 'Public' | 'Private';
  expression: ElmExpression;
  annotation?: ElmAnnotation[];
}

// ─── Type Specifiers ─────────────────────────────────────────────────────────

export type ElmTypeSpecifier =
  | ElmNamedTypeSpecifier
  | ElmListTypeSpecifier
  | ElmIntervalTypeSpecifier
  | ElmTupleTypeSpecifier
  | ElmChoiceTypeSpecifier;

export interface ElmNamedTypeSpecifier {
  type: 'NamedTypeSpecifier';
  name: string;
  modelName?: string;
}

export interface ElmListTypeSpecifier {
  type: 'ListTypeSpecifier';
  elementType: ElmTypeSpecifier;
}

export interface ElmIntervalTypeSpecifier {
  type: 'IntervalTypeSpecifier';
  pointType: ElmTypeSpecifier;
}

export interface ElmTupleTypeSpecifier {
  type: 'TupleTypeSpecifier';
  element: Array<{ name: string; type: ElmTypeSpecifier }>;
}

export interface ElmChoiceTypeSpecifier {
  type: 'ChoiceTypeSpecifier';
  choice: ElmTypeSpecifier[];
}

// ─── Expressions ─────────────────────────────────────────────────────────────

export type ElmExpression =
  | ElmLiteral
  | ElmNull
  | ElmProperty
  | ElmRetrieve
  | ElmQuery
  | ElmExpressionRef
  | ElmFunctionRef
  | ElmParameterRef
  | ElmValueSetRef
  | ElmCodeSystemRef
  | ElmBinaryOp
  | ElmUnaryOp
  | ElmNaryOp
  | ElmInterval
  | ElmList
  | ElmTuple
  | ElmIf
  | ElmCase
  | ElmAs
  | ElmIs
  | ElmQuantity
  | ElmConvert
  | ElmAggregate
  | ElmDate
  | ElmDateTime
  | ElmTime
  | ElmDurationBetween
  | ElmDateTimeComponentFrom
  | ElmStart
  | ElmEnd
  | ElmToday
  | ElmNow
  | ElmCollapse
  | ElmExpand
  | ElmUnion
  | ElmIntersect
  | ElmExcept
  | ElmDistinct
  | ElmFlatte
  | ElmFirst
  | ElmLast
  | ElmIndexOf
  | ElmSlice
  | ElmSplit
  | ElmConcatenate
  | ElmMessage;

// Literals & null
export interface ElmLiteral {
  type: 'Literal';
  valueType: string; // '{urn:hl7-org:elm-types:r1}Integer', etc.
  value: string;
  resultTypeName?: string;
}

export interface ElmNull {
  type: 'Null';
  resultTypeName?: string;
}

// Property access
export interface ElmProperty {
  type: 'Property';
  source?: ElmExpression;
  path: string;
  scope?: string;
  resultTypeName?: string;
}

// FHIR resource retrieval
export interface ElmRetrieve {
  type: 'Retrieve';
  dataType: string; // '{http://hl7.org/fhir}Patient'
  templateId?: string;
  codeProperty?: string;
  codes?: ElmExpression;
  dateProperty?: string;
  dateRange?: ElmExpression;
  resultTypeSpecifier?: ElmTypeSpecifier;
}

// Query (CQL from/where/return)
export interface ElmQuery {
  type: 'Query';
  source: ElmAliasedQuerySource[];
  let?: ElmLetClause[];
  relationship?: ElmRelationshipClause[];
  where?: ElmExpression;
  return?: ElmReturnClause;
  aggregate?: ElmAggregateClause;
  sort?: ElmSortClause;
}

export interface ElmAliasedQuerySource {
  alias: string;
  expression: ElmExpression;
  resultTypeSpecifier?: ElmTypeSpecifier;
}

export interface ElmLetClause {
  identifier: string;
  expression: ElmExpression;
}

export interface ElmRelationshipClause {
  type: 'With' | 'Without';
  alias: string;
  expression: ElmExpression;
  suchThat?: ElmExpression;
}

export interface ElmReturnClause {
  distinct?: boolean;
  expression: ElmExpression;
}

export interface ElmAggregateClause {
  identifier: string;
  expression: ElmExpression;
  starting?: ElmExpression;
  distinct?: boolean;
}

export interface ElmSortClause {
  by: ElmSortByItem[];
}

export interface ElmSortByItem {
  type: 'ByExpression' | 'ByColumn' | 'ByDirection';
  direction?: 'asc' | 'desc';
  path?: string;
  expression?: ElmExpression;
}

// References
export interface ElmExpressionRef {
  type: 'ExpressionRef';
  name: string;
  libraryName?: string;
  resultTypeName?: string;
}

export interface ElmFunctionRef {
  type: 'FunctionRef';
  name: string;
  libraryName?: string;
  operand?: ElmExpression[];
  resultTypeName?: string;
}

export interface ElmParameterRef {
  type: 'ParameterRef';
  name: string;
  resultTypeName?: string;
}

export interface ElmValueSetRef {
  type: 'ValueSetRef';
  name: string;
  libraryName?: string;
  preserve?: boolean;
}

export interface ElmCodeSystemRef {
  type: 'CodeSystemRef';
  name: string;
  libraryName?: string;
}

// Binary operators
export type ElmBinaryOpType =
  | 'And' | 'Or' | 'Xor' | 'Implies'
  | 'Equal' | 'NotEqual' | 'Equivalent' | 'Not'
  | 'Less' | 'Greater' | 'LessOrEqual' | 'GreaterOrEqual'
  | 'Add' | 'Subtract' | 'Multiply' | 'Divide' | 'Modulo' | 'TruncatedDivide'
  | 'In' | 'Contains' | 'ProperIn' | 'ProperContains'
  | 'IncludedIn' | 'Includes' | 'ProperIncludedIn' | 'ProperIncludes'
  | 'During' | 'Before' | 'After' | 'SameAs' | 'SameOrBefore' | 'SameOrAfter'
  | 'Overlaps' | 'OverlapsBefore' | 'OverlapsAfter'
  | 'Starts' | 'Ends' | 'Meets' | 'MeetsBefore' | 'MeetsAfter'
  | 'Substring' | 'StartsWith' | 'EndsWith' | 'Matches'
  | 'Power' | 'Log'
  | 'Coalesce';

export interface ElmBinaryOp {
  type: ElmBinaryOpType;
  operand: ElmExpression[];
  resultTypeName?: string;
  precision?: string;
}

// Unary operators
export type ElmUnaryOpType =
  | 'Not' | 'Exists' | 'IsNull' | 'IsTrue' | 'IsFalse'
  | 'Negate' | 'Predecessor' | 'Successor'
  | 'Abs' | 'Ceiling' | 'Floor' | 'Truncate' | 'Round'
  | 'Ln' | 'Exp'
  | 'Length' | 'Upper' | 'Lower' | 'PositionOf'
  | 'AllTrue' | 'AnyTrue'
  | 'Count' | 'Sum' | 'Min' | 'Max' | 'Avg' | 'Median' | 'Mode' | 'StdDev' | 'Variance'
  | 'PopulationStdDev' | 'PopulationVariance' | 'GeometricMean'
  | 'Width' | 'Size'
  | 'IsList' | 'IsInterval'
  | 'SingletonFrom'
  | 'ToBoolean' | 'ToDate' | 'ToDateTime' | 'ToDecimal' | 'ToInteger' | 'ToLong' | 'ToString' | 'ToTime' | 'ToQuantity' | 'ToConcept' | 'ToRatio' | 'ToList';

export interface ElmUnaryOp {
  type: ElmUnaryOpType;
  operand: ElmExpression;
  resultTypeName?: string;
  precision?: string;
}

// N-ary operators
export interface ElmNaryOp {
  type: 'Coalesce' | 'Concatenate' | 'Combine' | 'Greatest' | 'Least';
  operand: ElmExpression[];
  resultTypeName?: string;
}

// Quantity literal — e.g. `9 '%'` or `10 years` in CQL source.
export interface ElmQuantity {
  type: 'Quantity';
  value: number;
  unit?: string;
}

// Interval
export interface ElmInterval {
  type: 'Interval';
  low?: ElmExpression;
  high?: ElmExpression;
  lowClosed?: boolean;
  highClosed?: boolean;
  lowClosedExpression?: ElmExpression;
  highClosedExpression?: ElmExpression;
}

// List
export interface ElmList {
  type: 'List';
  element?: ElmExpression[];
  resultTypeSpecifier?: ElmTypeSpecifier;
}

// Tuple
export interface ElmTuple {
  type: 'Tuple';
  element: Array<{ name: string; value: ElmExpression }>;
}

// If-then-else
export interface ElmIf {
  type: 'If';
  condition: ElmExpression;
  then: ElmExpression;
  else: ElmExpression;
}

// Case
export interface ElmCase {
  type: 'Case';
  comparand?: ElmExpression;
  caseItem: Array<{ when: ElmExpression; then: ElmExpression }>;
  else: ElmExpression;
}

// Type casting
export interface ElmAs {
  type: 'As';
  operand: ElmExpression;
  asType?: string;
  asTypeSpecifier?: ElmTypeSpecifier;
  strict?: boolean;
}

// Type guard — emitted by the CQL translator around choice-typed properties.
export interface ElmIs {
  type: 'Is';
  operand: ElmExpression;
  isType?: string;
  isTypeSpecifier?: ElmTypeSpecifier;
}

export interface ElmConvert {
  type: 'Convert';
  operand: ElmExpression;
  toType?: string;
  toTypeSpecifier?: ElmTypeSpecifier;
}

// Aggregates (used standalone, not as unary ops)
export interface ElmAggregate {
  type: 'Count' | 'Sum' | 'Min' | 'Max' | 'Avg' | 'Median' | 'Mode';
  source: ElmExpression;
  path?: string;
  resultTypeName?: string;
}

// Date/time constructors
export interface ElmDate {
  type: 'Date';
  year: ElmExpression;
  month?: ElmExpression;
  day?: ElmExpression;
}

export interface ElmDateTime {
  type: 'DateTime';
  year: ElmExpression;
  month?: ElmExpression;
  day?: ElmExpression;
  hour?: ElmExpression;
  minute?: ElmExpression;
  second?: ElmExpression;
  millisecond?: ElmExpression;
  timezoneOffset?: ElmExpression;
}

export interface ElmTime {
  type: 'Time';
  hour: ElmExpression;
  minute?: ElmExpression;
  second?: ElmExpression;
  millisecond?: ElmExpression;
}

export interface ElmDurationBetween {
  type: 'DurationBetween';
  precision: string;
  operand: [ElmExpression, ElmExpression];
}

export interface ElmDateTimeComponentFrom {
  type: 'DateTimeComponentFrom';
  precision: string;
  operand: ElmExpression;
}

export interface ElmStart {
  type: 'Start';
  operand: ElmExpression;
}

export interface ElmEnd {
  type: 'End';
  operand: ElmExpression;
}

export interface ElmToday {
  type: 'Today';
}

export interface ElmNow {
  type: 'Now';
}

// Set/list operations
export interface ElmCollapse {
  type: 'Collapse';
  operand: ElmExpression[];
}

export interface ElmExpand {
  type: 'Expand';
  operand: ElmExpression[];
}

export interface ElmUnion {
  type: 'Union';
  operand: ElmExpression[];
}

export interface ElmIntersect {
  type: 'Intersect';
  operand: ElmExpression[];
}

export interface ElmExcept {
  type: 'Except';
  operand: ElmExpression[];
}

export interface ElmDistinct {
  type: 'Distinct';
  operand: ElmExpression;
}

export interface ElmFlatte {
  type: 'Flatten';
  operand: ElmExpression;
}

export interface ElmFirst {
  type: 'First';
  source: ElmExpression;
  orderBy?: string;
}

export interface ElmLast {
  type: 'Last';
  source: ElmExpression;
  orderBy?: string;
}

export interface ElmIndexOf {
  type: 'IndexOf';
  source: ElmExpression;
  element: ElmExpression;
}

export interface ElmSlice {
  type: 'Slice';
  source: ElmExpression;
  startIndex: ElmExpression;
  endIndex: ElmExpression;
}

export interface ElmSplit {
  type: 'Split';
  stringToSplit: ElmExpression;
  separator: ElmExpression;
}

export interface ElmConcatenate {
  type: 'Concatenate';
  operand: ElmExpression[];
}

export interface ElmMessage {
  type: 'Message';
  source: ElmExpression;
  condition: ElmExpression;
  code: ElmExpression;
  severity: ElmExpression;
  message: ElmExpression;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip the FHIR model namespace, e.g. '{http://hl7.org/fhir}Patient' → 'Patient' */
export function stripFhirNamespace(dataType: string): string {
  return dataType.replace(/^\{[^}]+\}/, '');
}

/** Normalize a CQL/ELM name to a SQL-safe identifier */
export function toSqlIdentifier(name: string): string {
  return name
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1');
}
