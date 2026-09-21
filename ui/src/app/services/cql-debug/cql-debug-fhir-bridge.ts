// Author: Preston Lee

import {
  ClassInstance,
  String as CqlString,
  Integer,
  Boolean as CqlBoolean,
  Decimal,
  List as EngList,
} from '@cqframework/cql/engine';
import * as CqlEngineModule from '@cqframework/cql/engine';
import { KtMutableMap, KtList } from '@cqframework/cql/kotlin-kotlin-stdlib';
import { QName, BigDecimal } from '@cqframework/cql/shared';
import { FHIR_MODEL_URI } from './cql-debug-engine-api';
import type { Bundle, FhirResource } from 'fhir/r4';

type FhirJson = Record<string, unknown>;

type ElementsMap = ReturnType<typeof KtMutableMap.fromJsMap>;

/**
 * Property paths must expose engine runtime List (with .value), not bare Kotlin lists.
 * Otherwise QueryEvaluator treats the ArrayList as a singleton source → ClassCastException
 * in FHIRHelpers.ToCode / ToConcept (e.g. CodeableConcept.coding).
 */
function toEngineList(items: unknown[]): InstanceType<typeof EngList> {
  // Runtime accepts a Kotlin iterable; package typings declare a zero-arg ctor.
  return new (EngList as unknown as new (elements: unknown) => InstanceType<typeof EngList>)(
    KtList.fromJsArray(items)
  );
}
/**
 * Runtime engine value constructors share names with ELM AST types in the
 * package typings; cast through unknown when calling runtime-only APIs.
 *
 * Note: System.DateTime has `fromDateElements(offsetHours, Int32Array)`, not `fromDateString`.
 * System.Time uses `fromDateString` for `HH:mm:ss` values.
 */
type CqlBigDecimal = ReturnType<typeof BigDecimal.fromString>;

const RuntimeEngine = CqlEngineModule as unknown as {
  Date: { fromDateString(dateString: string): unknown };
  DateTime: {
    fromDateElements(offsetHours: CqlBigDecimal, dateElements: Int32Array): unknown;
  };
  Time?: { fromDateString?: (timeString: string) => unknown };
  Code: new () => {
    code: string | null;
    system: string | null;
    display: string | null;
  };
};

/**
 * ISO-8601 dateTime / instant → System.DateTime via fromDateElements.
 * (Runtime DateTime has no fromDateString; falling back to String broke temporal math.)
 */
function parseFhirDateTime(value: string): unknown | null {
  const match = value.match(
    /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?)?)?$/
  );
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = match[2] != null ? Number(match[2]) : 1;
  const day = match[3] != null ? Number(match[3]) : 1;
  const hour = match[4] != null ? Number(match[4]) : 0;
  const minute = match[5] != null ? Number(match[5]) : 0;
  const second = match[6] != null ? Number(match[6]) : 0;
  const fraction = match[7] ?? '';
  const millisecond = fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0;
  const tz = match[8];

  let offsetHours = 0;
  if (tz && tz !== 'Z') {
    const sign = tz.charAt(0) === '-' ? -1 : 1;
    const digits = tz.slice(1).replace(':', '');
    const hours = Number(digits.slice(0, 2));
    const minutes = digits.length >= 4 ? Number(digits.slice(2, 4)) : 0;
    offsetHours = sign * (hours + minutes / 60);
  }

  try {
    return RuntimeEngine.DateTime.fromDateElements(
      BigDecimal.fromString(String(offsetHours)),
      new Int32Array([year, month, day, hour, minute, second, millisecond])
    );
  } catch {
    return null;
  }
}

/** FHIR choice[x] roots — JSON uses valueQuantity / effectiveDateTime / …; CQL uses value / effective. */
const FHIR_CHOICE_ROOTS = [
  'value',
  'effective',
  'onset',
  'abatement',
  'occurrence',
  'performed',
  'recorded',
  'born',
  'age',
  'deceased',
  'multipleBirth',
  'timing',
  'asNeeded',
  'medication',
  'rate',
  'item',
  'module',
  'example',
  'diagnosis',
  'procedure',
  'location',
  'addItem',
  'versionAlgorithm',
] as const;

/** Complex element name → FHIR modelinfo type (when JSON lacks resourceType). */
const ELEMENT_TYPE_BY_NAME: Record<string, string> = {
  meta: 'Meta',
  text: 'Narrative',
  identifier: 'Identifier',
  coding: 'Coding',
  code: 'CodeableConcept',
  subject: 'Reference',
  patient: 'Reference',
  encounter: 'Reference',
  focus: 'Reference',
  basedOn: 'Reference',
  partOf: 'Reference',
  performer: 'Reference',
  hasMember: 'Reference',
  derivedFrom: 'Reference',
  specimen: 'Reference',
  device: 'Reference',
  location: 'Reference',
  managingOrganization: 'Reference',
  generalPractitioner: 'Reference',
  name: 'HumanName',
  telecom: 'ContactPoint',
  address: 'Address',
  photo: 'Attachment',
  contact: 'Patient.Contact',
  communication: 'Patient.Communication',
  link: 'Patient.Link',
  extension: 'Extension',
  modifierExtension: 'Extension',
  period: 'Period',
  timing: 'Timing',
  quantity: 'Quantity',
  valueQuantity: 'Quantity',
  ratio: 'Ratio',
  range: 'Range',
  sampledData: 'SampledData',
  annotation: 'Annotation',
  note: 'Annotation',
  component: 'Observation.Component',
  referenceRange: 'Observation.ReferenceRange',
  interpretation: 'CodeableConcept',
  bodySite: 'CodeableConcept',
  method: 'CodeableConcept',
  category: 'CodeableConcept',
  type: 'CodeableConcept',
  maritalStatus: 'CodeableConcept',
  clinicalStatus: 'CodeableConcept',
  verificationStatus: 'CodeableConcept',
  severity: 'CodeableConcept',
  contained: 'Resource',
};

/**
 * Element names that are FHIR.date in modelinfo (not dateTime).
 * Do not use a blanket `*Date` → date heuristic: Condition.recordedDate,
 * AdverseEvent.recordedDate, etc. are FHIR.dateTime (date-only precision allowed).
 */
const FHIR_DATE_ELEMENT_NAMES = new Set([
  'birthDate',
  'valueDate',
  'approvalDate',
  'lastReviewDate',
  'lockedDate',
]);

/** Scalar element name → FHIR primitive type when JSON type alone is ambiguous. */
const PRIMITIVE_TYPE_BY_NAME: Record<string, string> = {
  id: 'id',
  url: 'uri',
  uri: 'uri',
  fullUrl: 'uri',
  canonical: 'canonical',
  system: 'uri',
  version: 'string',
  reference: 'string',
  display: 'string',
  div: 'string',
  unit: 'string',
  path: 'string',
  description: 'string',
  birthDate: 'date',
  valueDate: 'date',
  approvalDate: 'date',
  lastReviewDate: 'date',
  lockedDate: 'date',
  deceasedDateTime: 'dateTime',
  effectiveDateTime: 'dateTime',
  recordedDate: 'dateTime',
  authoredOn: 'dateTime',
  lastOccurrence: 'dateTime',
  issued: 'instant',
  lastUpdated: 'instant',
  instant: 'instant',
  start: 'dateTime',
  end: 'dateTime',
  gender: 'code',
  status: 'code',
  language: 'code',
  intent: 'code',
  priority: 'code',
  severity: 'code',
  use: 'code',
  kind: 'code',
  mode: 'code',
  comparator: 'code',
  currency: 'code',
  code: 'code',
  value: 'decimal',
  factor: 'decimal',
  score: 'decimal',
  amount: 'decimal',
  multipleBirthInteger: 'integer',
  count: 'integer',
  rank: 'integer',
};

const INTEGER_FHIR_TYPES = new Set([
  'integer',
  'positiveInt',
  'unsignedInt',
]);

const DECIMAL_FHIR_TYPES = new Set(['decimal']);

function choiceRootForJsonKey(key: string): string | null {
  for (const root of FHIR_CHOICE_ROOTS) {
    if (key.length > root.length && key.startsWith(root)) {
      const rest = key.slice(root.length);
      if (rest.charAt(0) >= 'A' && rest.charAt(0) <= 'Z') {
        return root;
      }
    }
  }
  return null;
}

function choiceTypeFromJsonKey(key: string, root: string): string {
  const suffix = key.slice(root.length);
  if (!suffix) {
    return 'string';
  }
  // JSON choice suffixes capitalize the type (valueQuantity, effectiveDateTime).
  // FHIR modelinfo uses PascalCase for complex types and camelCase for primitives.
  const primitiveSuffixes = new Set([
    'Boolean',
    'Canonical',
    'Code',
    'Date',
    'DateTime',
    'Decimal',
    'Id',
    'Instant',
    'Integer',
    'Markdown',
    'Oid',
    'PositiveInt',
    'String',
    'Time',
    'UnsignedInt',
    'Uri',
    'Url',
    'Uuid',
    'Base64Binary',
  ]);
  if (primitiveSuffixes.has(suffix)) {
    return suffix.charAt(0).toLowerCase() + suffix.slice(1);
  }
  return suffix;
}

function fhirQName(typeName: string): QName {
  return new QName(FHIR_MODEL_URI, typeName, '');
}

function elementsOf(entries: Record<string, unknown>): ElementsMap {
  return KtMutableMap.fromJsMap(
    new Map(Object.entries(entries).filter(([, value]) => value !== undefined && value !== null))
  );
}

function asCqlString(value: unknown): InstanceType<typeof CqlString> {
  return new CqlString(String(value));
}

/**
 * Convert a JSON scalar into the System.* value that belongs inside a FHIR primitive wrapper.
 * The FHIR type drives Integer vs Decimal — Quantity.value must be Decimal even when JSON is 28.
 */
function convertSystemPrimitive(value: unknown, fhirType: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (fhirType === 'boolean' || typeof value === 'boolean') {
    return new CqlBoolean(Boolean(value));
  }

  if (typeof value === 'number') {
    if (INTEGER_FHIR_TYPES.has(fhirType) && Number.isInteger(value)) {
      return new Integer(value);
    }
    // FHIR.decimal (and ambiguous numerics) must be Decimal — ToQuantity ClassCasts on Integer.
    return new Decimal(BigDecimal.fromString(String(value)));
  }

  if (typeof value === 'string') {
    if (DECIMAL_FHIR_TYPES.has(fhirType) || INTEGER_FHIR_TYPES.has(fhirType)) {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        if (INTEGER_FHIR_TYPES.has(fhirType) && Number.isInteger(numeric)) {
          return new Integer(numeric);
        }
        return new Decimal(BigDecimal.fromString(String(numeric)));
      }
    }

    if (fhirType === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      try {
        return RuntimeEngine.Date.fromDateString(value);
      } catch {
        return asCqlString(value);
      }
    }

    if (
      fhirType === 'dateTime' ||
      fhirType === 'instant' ||
      /^\d{4}-\d{2}-\d{2}T/.test(value)
    ) {
      const parsed = parseFhirDateTime(value);
      if (parsed != null) {
        return parsed;
      }
      return asCqlString(value);
    }

    if (fhirType === 'time' && RuntimeEngine.Time?.fromDateString) {
      try {
        return RuntimeEngine.Time.fromDateString(value);
      } catch {
        return asCqlString(value);
      }
    }

    return asCqlString(value);
  }

  return asCqlString(value);
}

/**
 * FHIR modelinfo primitives are ClassInstances with a `value` element (e.g. Observation.status.value).
 * JSON stores them as bare scalars — wrap so PropertyEvaluator can resolve `.value`.
 */
function wrapFhirPrimitive(fhirType: string, raw: unknown): ClassInstance {
  return new ClassInstance(
    fhirQName(fhirType),
    elementsOf({ value: convertSystemPrimitive(raw, fhirType) }) as never
  );
}

function guessFhirPrimitiveType(key: string, raw: unknown): string {
  if (typeof raw === 'boolean') {
    return 'boolean';
  }

  const named = PRIMITIVE_TYPE_BY_NAME[key];
  if (named) {
    // Quantity.value / factor must stay decimal even when JSON is an integer.
    if (named === 'decimal' || named === 'integer') {
      return named;
    }
    if (typeof raw === 'string' || typeof raw === 'number') {
      return named;
    }
  }

  if (typeof raw === 'number') {
    if (key === 'value' || key === 'factor' || key === 'score' || key === 'amount' || !Number.isInteger(raw)) {
      return 'decimal';
    }
    return 'integer';
  }

  if (typeof raw !== 'string') {
    return 'string';
  }

  if (FHIR_DATE_ELEMENT_NAMES.has(key)) {
    return 'date';
  }
  // *Date / *DateTime / common temporal names → dateTime (FHIR.dateTime allows date-only).
  // Blanket `*Date`→date was wrong for recordedDate and broke LipidManagement
  // FhirDateTimeToDisplay(C.recordedDate) at runtime (engine dispatch on FHIR.date).
  if (
    key.endsWith('DateTime') ||
    (key.endsWith('Date') && !FHIR_DATE_ELEMENT_NAMES.has(key)) ||
    key === 'issued' ||
    key === 'lastUpdated' ||
    key === 'instant' ||
    key === 'start' ||
    key === 'end' ||
    key === 'authoredOn' ||
    key === 'lastOccurrence' ||
    /^\d{4}-\d{2}-\d{2}T/.test(raw)
  ) {
    return key === 'issued' || key === 'lastUpdated' || key === 'instant' ? 'instant' : 'dateTime';
  }
  if (key === 'id' || key.endsWith('Id')) {
    return 'id';
  }
  if (key === 'url' || key === 'uri' || key === 'fullUrl' || key === 'canonical' || key === 'system') {
    return key === 'canonical' ? 'canonical' : 'uri';
  }
  if (
    key === 'reference' ||
    key === 'display' ||
    key === 'text' ||
    key === 'div' ||
    key === 'version' ||
    key === 'unit'
  ) {
    return 'string';
  }
  if (key === 'code' || key.endsWith('Status') || key.endsWith('Code')) {
    return 'code';
  }
  return 'string';
}

/** Original FHIR JSON for ClassInstances created from Bundle prefetch (retrieve results). */
const fhirJsonByInstance = new WeakMap<object, FhirJson>();

/**
 * Converts a FHIR R4 JSON object into a nested ClassInstance tree for the KMP engine.
 * Supports common primitives, choice[x] aliases, and nested backbone elements.
 */
function fhirJsonToClassInstance(resource: FhirJson): ClassInstance {
  const resourceType =
    typeof resource['resourceType'] === 'string' ? (resource['resourceType'] as string) : 'Resource';
  const instance = convertObject(resource, resourceType);
  fhirJsonByInstance.set(instance, resource);
  return instance;
}

/** Best-effort lookup of prefetch JSON for a ClassInstance (or List of them). */
export function extractFhirJsonPayload(value: unknown): FhirJson | FhirJson[] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const single = fhirJsonByInstance.get(value);
  if (single) {
    return single;
  }

  const items = engineListItems(value);
  if (!items) {
    return null;
  }
  const resources: FhirJson[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const json = fhirJsonByInstance.get(item);
    if (json) {
      resources.push(json);
    }
  }
  return resources.length > 0 ? resources : null;
}

function engineListItems(value: unknown): unknown[] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as {
    typeAsString?: string;
    value?: {
      asJsArrayView?: () => unknown[];
      toArray?: () => unknown[];
      y_1?: unknown[];
      t?: () => { u: () => boolean; v: () => unknown };
    };
  };
  if (record.typeAsString !== 'List' || record.value == null || typeof record.value !== 'object') {
    return null;
  }
  const inner = record.value;
  const view = inner.asJsArrayView?.();
  if (Array.isArray(view)) {
    return view;
  }
  const array = inner.toArray?.();
  if (Array.isArray(array)) {
    return array;
  }
  if (Array.isArray(inner.y_1)) {
    return inner.y_1;
  }
  if (typeof inner.t === 'function') {
    try {
      const out: unknown[] = [];
      const iterator = inner.t();
      while (iterator.u()) {
        out.push(iterator.v());
      }
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

function convertObject(obj: FhirJson, typeName: string): ClassInstance {
  const elements: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(obj)) {
    // Skip FHIR JSON underscore companions (_birthDate, etc.) — extension/id on primitives
    // are not modeled in v1; including them as elements confuses property resolution.
    if (key.startsWith('_') || raw === undefined || raw === null) {
      continue;
    }
    if (key === 'resourceType') {
      // Not a FHIR primitive element with .value — keep as System.String for identity.
      elements[key] = asCqlString(raw);
      continue;
    }

    let converted: unknown;
    if (Array.isArray(raw)) {
      converted = toEngineList(raw.map(item => convertValue(item, guessElementType(key, item), key)));
    } else if (typeof raw === 'object') {
      converted = convertObject(raw as FhirJson, guessElementType(key, raw));
    } else {
      converted = wrapFhirPrimitive(guessFhirPrimitiveType(key, raw), raw);
    }

    elements[key] = converted;
    // Alias choice[x] JSON names onto the CQL choice element (valueQuantity → value).
    // Keep the runtime type of the choice arm (dateTime stays dateTime). Do not promote
    // dateTime/instant to Period: CQL `as Period` must return null when the value is a
    // dateTime (HL7 CQL As operator; Using CQL with FHIR choice patterns). The translator
    // lowers `start of effective` to Start(ToInterval(As(effective, Period))), so dateTime
    // effective yields a null sort key — matching HAPI $evaluate / engine-fhir.
    const choiceRoot = choiceRootForJsonKey(key);
    if (choiceRoot && elements[choiceRoot] === undefined) {
      elements[choiceRoot] = converted;
    }
  }
  return new ClassInstance(fhirQName(typeName), elementsOf(elements) as never);
}

function convertValue(raw: unknown, typeName: string, elementKey?: string): unknown {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (Array.isArray(raw)) {
    return toEngineList(raw.map(item => convertValue(item, typeName, elementKey)));
  }
  if (typeof raw === 'object') {
    return convertObject(raw as FhirJson, typeName);
  }
  const key = elementKey ?? typeName;
  // When the declared type is already a FHIR primitive (choice suffix / modelinfo), prefer it.
  const primitive =
    /^[a-z]/.test(typeName) && typeName !== 'resourceType'
      ? typeName
      : guessFhirPrimitiveType(key, raw);
  return wrapFhirPrimitive(primitive, raw);
}

function guessElementType(key: string, value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rt = (value as FhirJson)['resourceType'];
    if (typeof rt === 'string') {
      return rt;
    }
  }
  const choiceRoot = choiceRootForJsonKey(key);
  if (choiceRoot) {
    return choiceTypeFromJsonKey(key, choiceRoot);
  }
  const mapped = ELEMENT_TYPE_BY_NAME[key];
  if (mapped) {
    return mapped;
  }
  // Backbone / nested: Observation.Component style when parent context is unknown — PascalCase key.
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function resourcesFromBundle(bundle: Bundle | null | undefined): ClassInstance[] {
  if (!bundle?.entry?.length) {
    return [];
  }
  const out: ClassInstance[] = [];
  for (const entry of bundle.entry) {
    const resource = entry.resource as FhirResource | undefined;
    if (!resource?.resourceType) {
      continue;
    }
    out.push(fhirJsonToClassInstance(resource as unknown as FhirJson));
  }
  return out;
}

export function readClassInstanceId(instance: ClassInstance): string | null {
  try {
    const elements = instance.elements as { z2?: (key: string) => unknown };
    const id = elements.z2?.('id');
    if (id == null) {
      return null;
    }
    if (typeof id === 'string') {
      return id;
    }
    if (typeof id === 'object') {
      const record = id as {
        value?: unknown;
        elements?: { z2?: (k: string) => unknown };
      };
      if (typeof record.value === 'string') {
        return record.value;
      }
      const inner = record.elements?.z2?.('value');
      if (typeof inner === 'string') {
        return inner;
      }
      if (inner && typeof inner === 'object' && typeof (inner as { value?: unknown }).value === 'string') {
        return (inner as { value: string }).value;
      }
    }
    return String(id);
  } catch {
    return null;
  }
}

export function createCode(code: string, system?: string, display?: string): InstanceType<typeof RuntimeEngine.Code> {
  const c = new RuntimeEngine.Code();
  c.code = code;
  if (system) {
    c.system = system;
  }
  if (display) {
    c.display = display;
  }
  return c;
}
