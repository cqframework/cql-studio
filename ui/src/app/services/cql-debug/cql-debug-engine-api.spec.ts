// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CQL_DEBUG_ENGINE_PACKAGE_VERSION,
  CQL_DEBUG_ENGINE_STATE_GETTER,
  CQL_DEBUG_STATE_HANDLER_FIELD,
  CqlDebugHandlerMethods,
  attachBreakpointHandler,
  createPauseActionSentinel,
  readBreakpointHandler,
} from './cql-debug-engine-api';
import {
  createCqlDebugBreakpointHandler,
  createDebugSharedBuffer,
} from './cql-debug-breakpoint-handler';
import {
  ModelManager,
  LibraryManager,
  CqlTranslator,
  createModelInfoProvider,
  createLibrarySourceProvider,
  stringAsSource,
} from '@cqframework/cql/cql-to-elm';
import { Environment, CqlEngine, EvaluationParams } from '@cqframework/cql/engine';
import { Pair } from '@cqframework/cql/kotlin-kotlin-stdlib';
import { resourcesFromBundle } from './cql-debug-fhir-bridge';
import { createBundleDataProvider } from './cql-debug-bundle-data-provider';
import { createPrefetchedTerminologyProvider } from './cql-debug-terminology-provider';
import { createDebugUcumService } from './cql-debug-ucum.lib';
import { applyCqlEngineRuntimePatches } from './cql-debug-engine-patches';
import type { Bundle } from 'fhir/r4';

const pkgPathCandidates = [
  join(process.cwd(), 'node_modules/@cqframework/cql/package.json'),
  join(process.cwd(), '../node_modules/@cqframework/cql/package.json'),
];
const pkgPath = pkgPathCandidates.find(p => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
});
const pkg = JSON.parse(readFileSync(pkgPath!, 'utf8')) as { version: string };

const cqlPublicCandidates = [
  join(process.cwd(), 'public/cql'),
  join(process.cwd(), 'ui/public/cql'),
];
const cqlPublic = cqlPublicCandidates.find(p => {
  try {
    readFileSync(join(p, 'system-modelinfo.xml'));
    return true;
  } catch {
    return false;
  }
})!;


describe('cql-debug-engine-api (5.3.0 contract)', () => {
  it('pins the installed @cqframework/cql version', () => {
    expect(pkg.version).toBe(CQL_DEBUG_ENGINE_PACKAGE_VERSION);
  });

  it('exposes mangled BreakpointHandler method names used by 5.3.0', () => {
    expect(CqlDebugHandlerMethods.onBeforeExpression).toBe('x9f');
    expect(CqlDebugHandlerMethods.waitForResume).toBe('b9g');
    expect(CQL_DEBUG_STATE_HANDLER_FIELD).toBe('k9j_1');
    expect(CQL_DEBUG_ENGINE_STATE_GETTER).toBe('ia0');
  });

  it('pause sentinel equals recognizes PAUSE enum string', () => {
    const sentinel = createPauseActionSentinel();
    expect(sentinel.equals('PAUSE')).toBe(true);
    expect(sentinel.equals({ toString: () => 'PAUSE' })).toBe(true);
    expect(sentinel.equals('CONTINUE')).toBe(false);
  });
});

describe('FHIR ClassInstance bridge', () => {
  it('evaluates Patient.birthDate.value and a retrieve against a Bundle snapshot', () => {
    const systemXml = readFileSync(join(cqlPublic, 'system-modelinfo.xml'), 'utf8');
    const fhirXml = readFileSync(join(cqlPublic, 'fhir-modelinfo-4.0.1.xml'), 'utf8');
    const helpers = readFileSync(join(cqlPublic, 'FHIRHelpers-4.0.1.cql'), 'utf8');
    const cql = `
library DebugSpike version '0.0.1'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1' called FHIRHelpers
context Patient
define BirthDateValue: Patient.birthDate.value
define ObsCount: Count([Observation])
define FinalObsCount: Count([Observation] O where O.status.value = 'final')
define ObsQuantity: singleton from ([Observation] O return O.value as Quantity)
`;

    const mm = new ModelManager(undefined, true);
    mm.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (id === 'System' && !system && !version) return stringAsSource(systemXml);
        if (id === 'FHIR' && version === '4.0.1') return stringAsSource(fhirXml);
        return null;
      }),
      true
    );
    const lm = new LibraryManager(mm, undefined, undefined, createDebugUcumService());
    lm.librarySourceLoader.registerProvider(
      createLibrarySourceProvider((id, _system, version) => {
        if (id === 'FHIRHelpers') return stringAsSource(helpers);
        if (id === 'DebugSpike') return stringAsSource(cql);
        return null;
      })
    );

    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
            birthDate: '1980-01-15',
          },
        },
        {
          resource: {
            resourceType: 'Observation',
            id: 'o1',
            status: 'final',
            code: { text: 'demo' },
            subject: { reference: 'Patient/p1' },
            valueQuantity: {
              value: 70,
              unit: 'kg',
              system: 'http://unitsofmeasure.org',
              code: 'kg',
            },
          },
        },
      ],
    };

    const resources = resourcesFromBundle(bundle);
    const env = new Environment(lm, undefined, createPrefetchedTerminologyProvider([]));
    env.registerDataProvider(
      'http://hl7.org/fhir',
      createBundleDataProvider({ resources, patientId: 'p1' })
    );
    const engine = new CqlEngine(env);
    const translator = CqlTranslator.fromText(cql, lm);
    expect([...(translator.errors?.asJsReadonlyArrayView() ?? [])]).toHaveLength(0);

    const libParams = new EvaluationParams.LibraryParams.Builder();
    libParams.expressionsByName(['BirthDateValue', 'ObsCount', 'FinalObsCount', 'ObsQuantity']);
    const builder = new EvaluationParams.Builder();
    builder.libraryByName('DebugSpike', libParams.build());
    builder.contextParameter = new Pair('Patient', 'p1');

    const results = engine.evaluate(builder.build()).onlyResultOrThrow;
    expect(String(results.getByName('BirthDateValue')?.value)).toContain('1980-01-15');
    expect(String(results.getByName('ObsCount')?.value)).toMatch(/1/);
    expect(String(results.getByName('FinalObsCount')?.value)).toMatch(/1/);
    expect(String(results.getByName('ObsQuantity')?.value)).toMatch(/70/);
  });
});

describe('BMI-like FHIRHelpers paths', () => {
  it('evaluates ToQuantity and status membership without ClassCastException', () => {
    const systemXml = readFileSync(join(cqlPublic, 'system-modelinfo.xml'), 'utf8');
    const fhirXml = readFileSync(join(cqlPublic, 'fhir-modelinfo-4.0.1.xml'), 'utf8');
    const helpers = readFileSync(join(cqlPublic, 'FHIRHelpers-4.0.1.cql'), 'utf8');
    const cql = `
library BmiCast version '0.0.1'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1' called FHIRHelpers
valueset "BMI": 'http://loinc.org/vs/bmi'
context Patient
define "BMI Observations":
  [Observation: "BMI"] O
    where O.status in { 'final', 'amended', 'corrected' }
define "BMI Values":
  "BMI Observations" O
    return FHIRHelpers.ToQuantity(O.value as Quantity)
define "Most Recent BMI":
  First("BMI Values" Q sort by value descending)
`;

    const mm = new ModelManager(undefined, true);
    mm.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (id === 'System' && !system && !version) return stringAsSource(systemXml);
        if (id === 'FHIR' && version === '4.0.1') return stringAsSource(fhirXml);
        return null;
      }),
      true
    );
    const lm = new LibraryManager(mm, undefined, undefined, createDebugUcumService());
    lm.librarySourceLoader.registerProvider(
      createLibrarySourceProvider((id) => {
        if (id === 'FHIRHelpers') return stringAsSource(helpers);
        if (id === 'BmiCast') return stringAsSource(cql);
        return null;
      })
    );

    const translator = CqlTranslator.fromText(cql, lm);
    const errors = [...(translator.errors?.asJsReadonlyArrayView() ?? [])];
    expect(errors).toHaveLength(0);

    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p1', birthDate: '1980-01-15' } },
        {
          resource: {
            resourceType: 'Observation',
            id: 'o1',
            status: 'final',
            code: {
              coding: [{ system: 'http://loinc.org', code: '39156-5' }],
            },
            subject: { reference: 'Patient/p1' },
            valueQuantity: {
              value: 28,
              unit: 'kg/m2',
              system: 'http://unitsofmeasure.org',
              code: 'kg/m2',
            },
          },
        },
      ],
    };

    const resources = resourcesFromBundle(bundle);
    const expansions = [
      { url: 'http://loinc.org/vs/bmi', codes: [{ code: '39156-5', system: 'http://loinc.org' }] },
    ];
    const env = new Environment(lm, undefined, createPrefetchedTerminologyProvider(expansions));
    env.registerDataProvider(
      'http://hl7.org/fhir',
      createBundleDataProvider({ resources, patientId: 'p1', valueSetExpansions: expansions })
    );
    const engine = new CqlEngine(env);
    const libParams = new EvaluationParams.LibraryParams.Builder();
    libParams.expressionsByName(['BMI Observations', 'BMI Values', 'Most Recent BMI']);
    const builder = new EvaluationParams.Builder();
    builder.libraryByName('BmiCast', libParams.build());
    builder.contextParameter = new Pair('Patient', 'p1');

    const results = engine.evaluate(builder.build()).onlyResultOrThrow;
    expect(String(results.getByName('BMI Observations')?.value)).toMatch(/Observation/);
    expect(String(results.getByName('BMI Values')?.value)).toMatch(/28/);
    expect(String(results.getByName('Most Recent BMI')?.value)).toMatch(/28/);
  });

  it('start of effective on dateTime is null (As Period); First/Last follow retrieve order', () => {
    // Spec: translator emits Start(ToInterval(As(effective, Period))). CQL `as` returns
    // null when the runtime type is dateTime, so sort keys are null and First/Last use
    // list order. HAPI $evaluate does the same — do not promote dateTime→Period.
    const systemXml = readFileSync(join(cqlPublic, 'system-modelinfo.xml'), 'utf8');
    const fhirXml = readFileSync(join(cqlPublic, 'fhir-modelinfo-4.0.1.xml'), 'utf8');
    const helpers = readFileSync(join(cqlPublic, 'FHIRHelpers-4.0.1.cql'), 'utf8');
    const cql = `
library EffSort version '0.0.1'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'
valueset "BodyHeight": 'https://example.org/vs/height'
context Patient
define Heights:
  [Observation: "BodyHeight"] H
    where H.status in { 'final', 'amended', 'corrected' }
      and H.effective is not null
      and H.value is FHIR.Quantity
define SortStarts:
  Heights H return start of H.effective
define UnsortedFirst:
  FHIRHelpers.ToQuantity((First(Heights)).value as Quantity).value
define LastHeight:
  FHIRHelpers.ToQuantity((Last(Heights H sort by start of effective)).value as Quantity).value
define FirstHeight:
  FHIRHelpers.ToQuantity((First(Heights H sort by start of effective)).value as Quantity).value
define LastDesc:
  FHIRHelpers.ToQuantity((Last(Heights H sort by start of effective desc)).value as Quantity).value
define FirstDesc:
  FHIRHelpers.ToQuantity((First(Heights H sort by start of effective desc)).value as Quantity).value
`;

    const mm = new ModelManager(undefined, true);
    mm.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (id === 'System' && !system && !version) return stringAsSource(systemXml);
        if (id === 'FHIR' && version === '4.0.1') return stringAsSource(fhirXml);
        return null;
      }),
      true
    );
    const lm = new LibraryManager(mm, undefined, undefined, createDebugUcumService());
    lm.librarySourceLoader.registerProvider(
      createLibrarySourceProvider(id => {
        if (id === 'FHIRHelpers') return stringAsSource(helpers);
        if (id === 'EffSort') return stringAsSource(cql);
        return null;
      })
    );
    expect([...(CqlTranslator.fromText(cql, lm).errors?.asJsReadonlyArrayView() ?? [])]).toHaveLength(0);

    const heightCoding = { system: 'http://loinc.org', code: '8302-2' };
    const mkObs = (id: string, when: string, cm: number) => ({
      resource: {
        resourceType: 'Observation' as const,
        id,
        status: 'final' as const,
        code: { coding: [heightCoding] },
        subject: { reference: 'Patient/p1' },
        effectiveDateTime: when,
        valueQuantity: {
          value: cm,
          unit: 'cm',
          system: 'http://unitsofmeasure.org',
          code: 'cm',
        },
      },
    });

    // Newest → mid → oldest in the Bundle; preserveRetrieveOrder keeps that order.
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p1' } },
        mkObs('new', '2020-06-01T12:00:00Z', 155.7),
        mkObs('mid', '2008-05-11T13:09:57-07:00', 142.8),
        mkObs('old', '1996-04-21T13:09:57-07:00', 49),
      ],
    };

    const expansions = [
      {
        url: 'https://example.org/vs/height',
        codes: [{ code: '8302-2', system: 'http://loinc.org' }],
      },
    ];
    const resources = resourcesFromBundle(bundle);
    const env = new Environment(lm, undefined, createPrefetchedTerminologyProvider(expansions));
    env.registerDataProvider(
      'http://hl7.org/fhir',
      createBundleDataProvider({
        resources,
        patientId: 'p1',
        valueSetExpansions: expansions,
        preserveRetrieveOrder: true,
      })
    );
    const engine = new CqlEngine(env);
    const names = [
      'SortStarts',
      'UnsortedFirst',
      'FirstHeight',
      'LastHeight',
      'FirstDesc',
      'LastDesc',
    ];
    const libParams = new EvaluationParams.LibraryParams.Builder();
    libParams.expressionsByName(names);
    const builder = new EvaluationParams.Builder();
    builder.libraryByName('EffSort', libParams.build());
    builder.contextParameter = new Pair('Patient', 'p1');
    const results = engine.evaluate(builder.build()).onlyResultOrThrow;

    expect(String(results.getByName('UnsortedFirst')?.value)).toMatch(/155\.7/);

    // As(dateTime, Period) is null → start of effective is null for every row.
    const starts = String(results.getByName('SortStarts')?.value);
    expect(starts).toMatch(/null/);
    expect(starts).not.toMatch(/@1996-04-21/);

    // Null sort keys → First/Last ignore direction and follow retrieve order.
    expect(String(results.getByName('FirstHeight')?.value)).toMatch(/155\.7/);
    expect(String(results.getByName('LastHeight')?.value)).toMatch(/49/);
    expect(String(results.getByName('FirstDesc')?.value)).toMatch(/155\.7/);
    expect(String(results.getByName('LastDesc')?.value)).toMatch(/49/);
  });
});

describe('UCUM service for quantity units (BMI-style)', () => {
  it('translates and evaluates quantity arithmetic / convert (not stub Unsupported)', async () => {
    const systemXml = readFileSync(join(cqlPublic, 'system-modelinfo.xml'), 'utf8');
    const cql = `
library BmiUnits version '0.0.1'
define OverweightThreshold: 25.0 'kg/m2'
define Height: 1.8 'm'
define Weight: 80.0 'kg'
define BMI: Weight / (Height * Height)
define BMIAsKgM2: convert BMI to 'kg/m2'
define Overweight: BMI > OverweightThreshold
define GramsInKg: convert 1000.0 'g' to 'kg'
`;

    const mm = new ModelManager(undefined, true);
    mm.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (id === 'System' && !system && !version) return stringAsSource(systemXml);
        return null;
      }),
      true
    );
    const lm = new LibraryManager(mm, undefined, undefined, createDebugUcumService());
    lm.librarySourceLoader.registerProvider(
      createLibrarySourceProvider((id) => (id === 'BmiUnits' ? stringAsSource(cql) : null))
    );

    const translator = CqlTranslator.fromText(cql, lm);
    const errors = [...(translator.errors?.asJsReadonlyArrayView() ?? [])];
    expect(errors.map(e => String(e))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/UCUM|Unsupported/i)])
    );
    expect(errors.length).toBe(0);

    const engine = new CqlEngine(new Environment(lm));
    const libParams = new EvaluationParams.LibraryParams.Builder();
    libParams.expressionsByName([
      'OverweightThreshold',
      'Height',
      'Weight',
      'BMI',
      'BMIAsKgM2',
      'Overweight',
      'GramsInKg',
    ]);
    const builder = new EvaluationParams.Builder();
    builder.libraryByName('BmiUnits', libParams.build());
    const results = engine.evaluate(builder.build()).onlyResultOrThrow;
    expect(String(results.getByName('OverweightThreshold')?.value)).toMatch(/25/);
    expect(String(results.getByName('Height')?.value)).toMatch(/1\.8/);
    expect(String(results.getByName('Weight')?.value)).toMatch(/80/);
    expect(String(results.getByName('BMIAsKgM2')?.value)).toMatch(/24\.69/);
    expect(String(results.getByName('Overweight')?.value)).toMatch(/false/i);
    expect(String(results.getByName('GramsInKg')?.value)).toMatch(/1/);
  });
});

describe('cql-debug-engine-patches (BigDecimal divide / scale)', () => {
  it('keeps Sigmoid and eGFR division precision (1.2/0.9 ≠ 1.3)', () => {
    applyCqlEngineRuntimePatches();
    const systemXml = readFileSync(join(cqlPublic, 'system-modelinfo.xml'), 'utf8');
    const mm = new ModelManager(undefined, true);
    mm.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (id === 'System' && !system && !version) return stringAsSource(systemXml);
        return null;
      }),
      true
    );
    const cql = `
library DecimalPatchSpike version '0.0.1'
define Ratio: 1.2 / 0.9
define Sigmoid: Exp(-2.0) / (1.0 + Exp(-2.0))
define EgfrMale: 142.0 * Power(1.0, -0.302) * Power(1.2 / 0.9, -1.2) * Power(0.9938, 67)
`;
    const lm = new LibraryManager(mm, undefined, undefined, createDebugUcumService());
    lm.librarySourceLoader.registerProvider(
      createLibrarySourceProvider(id => (id === 'DecimalPatchSpike' ? stringAsSource(cql) : null))
    );
    CqlTranslator.fromText(cql, lm);
    const engine = new CqlEngine(new Environment(lm));
    const names = ['Ratio', 'Sigmoid', 'EgfrMale'];
    const libParams = new EvaluationParams.LibraryParams.Builder();
    libParams.expressionsByName(names);
    const builder = new EvaluationParams.Builder();
    builder.libraryByName('DecimalPatchSpike', libParams.build());
    const results = engine.evaluate(builder.build()).onlyResultOrThrow;
    expect(Number(String(results.getByName('Ratio')?.value))).toBeCloseTo(1.33333333, 5);
    expect(Number(String(results.getByName('Sigmoid')?.value))).toBeCloseTo(0.11920292, 5);
    expect(Number(String(results.getByName('EgfrMale')?.value))).toBeCloseTo(66.28180824, 5);
  });
});

describe('BreakpointHandler attach', () => {
  it('attaches a handler to CqlEngine state and can pause via Atomics when SAB is available', async () => {
    if (typeof SharedArrayBuffer === 'undefined') {
      return;
    }
    const systemXml = readFileSync(join(cqlPublic, 'system-modelinfo.xml'), 'utf8');
    const mm = new ModelManager(undefined, true);
    mm.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (id === 'System' && !system && !version) return stringAsSource(systemXml);
        return null;
      }),
      true
    );
    const cql = `
library PauseSpike version '0.0.1'
define Answer: 1 + 1
`;
    const lm = new LibraryManager(mm);
    lm.librarySourceLoader.registerProvider(
      createLibrarySourceProvider((id) => (id === 'PauseSpike' ? stringAsSource(cql) : null))
    );
    CqlTranslator.fromText(cql, lm);
    const env = new Environment(lm);
    const engine = new CqlEngine(env);
    const sab = createDebugSharedBuffer();
    let paused = 0;
    let stepMode: 'continue' | 'stepInto' | 'stepOver' | 'stepOut' | 'stop' = 'stepInto';
    const handler = createCqlDebugBreakpointHandler({
      sab,
      getBreakpoints: () => [],
      getStepMode: () => stepMode,
      setStepMode: mode => {
        stepMode = mode;
      },
      shouldAbort: () => false,
      serializeVariables: () => [],
      onPause: () => {
        paused += 1;
      },
    });
    attachBreakpointHandler(engine as never, handler);
    expect(readBreakpointHandler(engine as never)).toBe(handler);

    expect(typeof (handler as Record<string, unknown>)[CqlDebugHandlerMethods.waitForResume]).toBe(
      'function'
    );
    expect(typeof (handler as Record<string, unknown>)[CqlDebugHandlerMethods.onBeforeExpression]).toBe(
      'function'
    );

    // Atomics.wait blocks the calling thread; notify from a worker_thread so the event loop is not required.
    const { Worker } = await import('node:worker_threads');
    const notifier = new Worker(
      `
      const { workerData, parentPort } = require('node:worker_threads');
      const view = new Int32Array(workerData.sab);
      setTimeout(() => {
        Atomics.store(view, 1, 0); // continue mode
        Atomics.store(view, 0, 1);
        Atomics.notify(view, 0, 1);
        parentPort.postMessage('notified');
      }, 20);
      `,
      { eval: true, workerData: { sab } }
    );
    const notified = new Promise<void>((resolve, reject) => {
      notifier.once('message', () => resolve());
      notifier.once('error', reject);
    });

    const libParams = new EvaluationParams.LibraryParams.Builder();
    libParams.expressionsByName(['Answer']);
    const builder = new EvaluationParams.Builder();
    builder.libraryByName('PauseSpike', libParams.build());

    const results = engine.evaluate(builder.build()).onlyResultOrThrow;
    expect(paused).toBeGreaterThan(0);
    expect(String(results.getByName('Answer')?.value)).toMatch(/2/);
    await notified;
    await notifier.terminate();
  });

  it('FhirDateTimeToDisplay(Condition.recordedDate) resolves (recordedDate is dateTime, not date)', () => {
    // Regression: guessFhirPrimitiveType used to map *Date → FHIR.date, so runtime
    // dispatch failed with: Could not resolve call to operator 'FhirDateTimeToDisplay(.date)'.
    const systemXml = readFileSync(join(cqlPublic, 'system-modelinfo.xml'), 'utf8');
    const fhirXml = readFileSync(join(cqlPublic, 'fhir-modelinfo-4.0.1.xml'), 'utf8');
    const helpers = readFileSync(join(cqlPublic, 'FHIRHelpers-4.0.1.cql'), 'utf8');
    const cql = `
library RecDateDisp version '0.0.1'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'
context Patient
define function FhirDateTimeToDisplay(value FHIR.dateTime):
  if value is null then null
  else ToString(date from FHIRHelpers.ToDateTime(value))
define function ConditionDateDisplay(C Condition):
  if C is null then null
  else FhirDateTimeToDisplay(C.recordedDate)
define Displayed:
  ConditionDateDisplay(First([Condition]))
`;

    const mm = new ModelManager(undefined, true);
    mm.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (id === 'System' && !system && !version) return stringAsSource(systemXml);
        if (id === 'FHIR' && version === '4.0.1') return stringAsSource(fhirXml);
        return null;
      }),
      true
    );
    const lm = new LibraryManager(mm, undefined, undefined, createDebugUcumService());
    lm.librarySourceLoader.registerProvider(
      createLibrarySourceProvider(id => {
        if (id === 'FHIRHelpers') return stringAsSource(helpers);
        if (id === 'RecDateDisp') return stringAsSource(cql);
        return null;
      })
    );
    expect([...(CqlTranslator.fromText(cql, lm).errors?.asJsReadonlyArrayView() ?? [])]).toHaveLength(0);

    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p1', birthDate: '1980-01-15' } },
        {
          resource: {
            resourceType: 'Condition',
            id: 'c1',
            subject: { reference: 'Patient/p1' },
            // Date-only string is valid FHIR.dateTime precision; must still wrap as dateTime.
            recordedDate: '2024-06-01',
          },
        },
      ],
    };

    applyCqlEngineRuntimePatches();
    const environment = new Environment(lm, undefined, createPrefetchedTerminologyProvider([]) as never);
    environment.registerDataProvider(
      'http://hl7.org/fhir',
      createBundleDataProvider({
        resources: resourcesFromBundle(bundle),
        patientId: 'p1',
        valueSetExpansions: [],
      }) as never
    );
    const engine = new CqlEngine(environment);
    const libParams = new EvaluationParams.LibraryParams.Builder();
    libParams.expressionsByName(['Displayed']);
    const builder = new EvaluationParams.Builder();
    builder.libraryByName('RecDateDisp', libParams.build());
    builder.contextParameter = new Pair('Patient', 'p1');

    const results = engine.evaluate(builder.build()).onlyResultOrThrow;
    expect(String(results.getByName('Displayed')?.value)).toMatch(/2024-06-01/);
  });
});

describe('TerminologyProvider mangled names (5.3.0)', () => {
  it('pins expand / in / lookup method names', async () => {
    const { CqlDebugTerminologyMethods, CQL_DEBUG_VALUESET_INFO_ID_FIELD } = await import(
      './cql-debug-engine-api'
    );
    expect(CqlDebugTerminologyMethods.expand).toBe('x9p');
    expect(CqlDebugTerminologyMethods.inValueSet).toBe('h9s');
    expect(CqlDebugTerminologyMethods.lookup).toBe('e9s');
    expect(CQL_DEBUG_VALUESET_INFO_ID_FIELD).toBe('baf_1');
  });
});
