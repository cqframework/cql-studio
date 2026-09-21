// Author: Preston Lee

import {
  ModelManager,
  LibraryManager,
  CqlTranslator,
  createModelInfoProvider,
  createLibrarySourceProvider,
  stringAsSource,
} from '@cqframework/cql/cql-to-elm';
import { Environment, CqlEngine, EvaluationParams, String as CqlString } from '@cqframework/cql/engine';
import { Pair, KtMutableMap } from '@cqframework/cql/kotlin-kotlin-stdlib';
import { attachBreakpointHandler } from './cql-debug-engine-api';
import {
  createCqlDebugBreakpointHandler,
  notifyDebugResume,
  type CqlDebugBreakpointSpec,
  type CqlDebugStepMode,
} from './cql-debug-breakpoint-handler';
import { createBundleDataProvider } from './cql-debug-bundle-data-provider';
import { resourcesFromBundle } from './cql-debug-fhir-bridge';
import { createPrefetchedTerminologyProvider } from './cql-debug-terminology-provider';
import { createDebugUcumService } from './cql-debug-ucum.lib';
import { applyCqlEngineRuntimePatches } from './cql-debug-engine-patches';
import { lookupModelInfoXmlFromPayload } from './cql-debug-model-info.lib';
import {
  expressionResultToDto,
  serializeDebugVariables,
  serializeDebugVariablesByActivationFrame,
} from './cql-debug-value-dto';
import { extractCqlUsingDeclarations, rewriteFhirHelpersCql, rewriteModelInfoXmlIdentity, parseModelInfoXmlIdentity } from '../cql-model-info.lib';
import type {
  CqlDebugExpressionResultDto,
  CqlDebugStartPayload,
  CqlDebugWorkerOutboundMessage,
} from './cql-debug-protocol';

interface RunCqlDebugSessionHooks {
  postMessage: (message: CqlDebugWorkerOutboundMessage) => void;
  sab: SharedArrayBuffer;
  getBreakpoints: () => CqlDebugBreakpointSpec[];
  getStepMode: () => CqlDebugStepMode;
  setStepMode: (mode: CqlDebugStepMode) => void;
  shouldAbort: () => boolean;
}

export async function runCqlDebugSession(
  payload: CqlDebugStartPayload,
  hooks: RunCqlDebugSessionHooks
): Promise<void> {
  const started = performance.now();
  try {
    applyCqlEngineRuntimePatches();
    hooks.postMessage({
      type: 'progress',
      phase: 'translating',
      elapsedMs: Math.round(performance.now() - started),
    });

    const modelManager = new ModelManager(undefined, true);
    const rootFhirVersion =
      extractCqlUsingDeclarations(payload.cql).find(d => d.name === 'FHIR')?.version?.trim() ?? null;
    modelManager.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (system) {
          return null;
        }
        let xml = lookupModelInfoXmlFromPayload(payload, id, version);
        if (!xml) {
          return null;
        }
        const requested = version?.trim();
        if (requested) {
          const xmlId = parseModelInfoXmlIdentity(xml);
          if (!xmlId || xmlId.version !== requested || xmlId.name !== id) {
            xml = rewriteModelInfoXmlIdentity(xml, id, requested);
          }
        }
        return stringAsSource(xml);
      }),
      true
    );

    const includeMap = new Map<string, string>();
    includeMap.set('FHIRHelpers|4.0.1', payload.fhirHelpersCql);
    includeMap.set('FHIRHelpers|', payload.fhirHelpersCql);
    includeMap.set(`${payload.libraryName}|${payload.libraryVersion ?? '0.0.1'}`, payload.cql);
    includeMap.set(payload.libraryName, payload.cql);
    for (const include of payload.includeSources) {
      const cql =
        include.id === 'FHIRHelpers'
          ? rewriteFhirHelpersCql(
              include.cql,
              include.version?.trim() || '4.0.1',
              rootFhirVersion || include.version?.trim() || '4.0.1'
            )
          : include.cql;
      includeMap.set(`${include.id}|${include.version ?? ''}`, cql);
      includeMap.set(include.id, cql);
    }

    const libraryManager = new LibraryManager(
      modelManager,
      undefined,
      undefined,
      createDebugUcumService()
    );
    libraryManager.librarySourceLoader.registerProvider(
      createLibrarySourceProvider((id, _system, version) => {
        const exact = includeMap.get(`${id}|${version ?? ''}`);
        if (exact) {
          return stringAsSource(
            id === 'FHIRHelpers'
              ? rewriteFhirHelpersCql(
                  exact,
                  version?.trim() || '4.0.1',
                  rootFhirVersion || version?.trim() || '4.0.1'
                )
              : exact
          );
        }
        if (id === 'FHIRHelpers' && payload.fhirHelpersCql) {
          return stringAsSource(
            rewriteFhirHelpersCql(
              payload.fhirHelpersCql,
              version?.trim() || '4.0.1',
              rootFhirVersion || version?.trim() || '4.0.1'
            )
          );
        }
        const bare = includeMap.get(id);
        return bare ? stringAsSource(bare) : null;
      })
    );

    const translator = CqlTranslator.fromText(payload.cql, libraryManager);
    const translateErrors = [...(translator.errors?.asJsReadonlyArrayView() ?? [])];
    if (translateErrors.length > 0) {
      const message = translateErrors
        .map(error => (error instanceof Error ? error.message : String(error)))
        .join(', ');
      hooks.postMessage({
        type: 'error',
        message: `Library ${payload.libraryName} loaded, but had errors: ${message}`,
      });
      return;
    }

    const resources = resourcesFromBundle(payload.bundle);
    const dataProvider = createBundleDataProvider({
      resources,
      patientId: payload.subjectId,
      valueSetExpansions: payload.valueSetExpansions,
    });
    const terminologyProvider = createPrefetchedTerminologyProvider(payload.valueSetExpansions);

    const environment = new Environment(libraryManager, undefined, terminologyProvider as never);
    environment.registerDataProvider('http://hl7.org/fhir', dataProvider as never);

    const engine = new CqlEngine(environment);
    const handler = createCqlDebugBreakpointHandler({
      sab: hooks.sab,
      getBreakpoints: hooks.getBreakpoints,
      getStepMode: hooks.getStepMode,
      setStepMode: hooks.setStepMode,
      shouldAbort: hooks.shouldAbort,
      serializeVariables: serializeDebugVariables,
      serializeFrameVariables: serializeDebugVariablesByActivationFrame,
      onPause: frame => {
        hooks.postMessage({ type: 'paused', frame });
      },
      onProgress: info => {
        const detail = info.defineName
          ? `${info.defineName} · ${info.expressionCount.toLocaleString()} nodes`
          : `${info.expressionCount.toLocaleString()} nodes`;
        hooks.postMessage({
          type: 'progress',
          phase: 'evaluating',
          elapsedMs: Math.round(performance.now() - started),
          detail,
        });
      },
    });
    attachBreakpointHandler(engine, handler);

    hooks.postMessage({
      type: 'progress',
      phase: 'evaluating',
      elapsedMs: Math.round(performance.now() - started),
      detail: 'Starting evaluation',
    });

    const libraryParamsBuilder = new EvaluationParams.LibraryParams.Builder();
    if (payload.expressionNames.length > 0) {
      libraryParamsBuilder.expressionsByName(payload.expressionNames);
    }
    const paramsBuilder = new EvaluationParams.Builder();
    paramsBuilder.libraryByName(payload.libraryName, libraryParamsBuilder.build());
    if (payload.subjectId) {
      paramsBuilder.contextParameter = new Pair('Patient', payload.subjectId);
    }
    // Unset String parameters are null; Length(null) throws in @cqframework/cql@5.3.0
    // (and HAPI). Default to '' so `if raw is null or Length(raw)=0` short-circuits safely
    // for patterns like SDI2019.ToZip5(OverrideZipCode).
    const stringParams = collectUnsetStringParameterDefaults(payload.cql, payload.includeSources);
    if (stringParams.size > 0) {
      paramsBuilder.parameters = KtMutableMap.fromJsMap(stringParams);
    }

    const evaluationResults = engine.evaluate(paramsBuilder.build());
    const only = evaluationResults.onlyResultOrThrow;
    const results: CqlDebugExpressionResultDto[] = [];
    const names =
      payload.expressionNames.length > 0
        ? payload.expressionNames
        : collectExpressionNames(only);
    for (const name of names) {
      const expressionResult = only.getByName(name);
      results.push(expressionResultToDto(name, expressionResult?.value));
    }
    hooks.postMessage({
      type: 'completed',
      results,
      executionTimeMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    if (hooks.shouldAbort() || hooks.getStepMode() === 'stop') {
      hooks.postMessage({
        type: 'completed',
        results: [],
        executionTimeMs: Math.round(performance.now() - started),
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    hooks.postMessage({ type: 'error', message });
  } finally {
    notifyDebugResume(hooks.sab, 'continue');
  }
}

function collectExpressionNames(only: {
  expressionResults: unknown;
}): string[] {
  const results = only.expressionResults as {
    asJsMapView?: (() => Map<string, unknown>) | Map<string, unknown>;
  };
  try {
    const view =
      typeof results.asJsMapView === 'function' ? results.asJsMapView() : results.asJsMapView;
    if (view && typeof view.keys === 'function') {
      return [...view.keys()];
    }
  } catch {
    /* fall through */
  }
  return [];
}

/** Map every `parameter Name String` in main + includes to empty System.String. */
function collectUnsetStringParameterDefaults(
  mainCql: string,
  includeSources: Array<{ cql: string }> | undefined
): Map<string, InstanceType<typeof CqlString>> {
  const out = new Map<string, InstanceType<typeof CqlString>>();
  const texts = [mainCql, ...(includeSources ?? []).map(s => s.cql)];
  for (const cql of texts) {
    for (const match of cql.matchAll(/parameter\s+(\w+)\s+String\b/g)) {
      out.set(match[1], new CqlString(''));
    }
  }
  return out;
}
