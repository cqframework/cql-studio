// Author: Preston Lee

/**
 * Version-pinned bindings for unexported @cqframework/cql@5.3.0 engine debug APIs.
 * Contract-tested in cql-debug-engine-api.spec.ts — bump pin after verifying new mangled names.
 */
export const CQL_DEBUG_ENGINE_PACKAGE_VERSION = '5.3.0';

/** State field holding BreakpointHandler (engine.mjs 5.3.0). */
export const CQL_DEBUG_STATE_HANDLER_FIELD = 'k9j_1';

/** CqlEngine internal getter returning State (engine.mjs 5.3.0). */
export const CQL_DEBUG_ENGINE_STATE_GETTER = 'ia0';

/** State.stack (ArrayDeque&lt;ActivationFrame&gt;) — engine.mjs 5.3.0. */
export const CQL_DEBUG_STATE_STACK_FIELD = 'h9j_1';

/** ActivationFrame.element — engine.mjs 5.3.0. */
export const CQL_DEBUG_ACTIVATION_FRAME_ELEMENT_FIELD = 'i9q_1';

/** ActivationFrame.variables (Deque&lt;Variable&gt;) — engine.mjs 5.3.0. */
export const CQL_DEBUG_ACTIVATION_FRAME_VARIABLES_FIELD = 'm9q_1';

/** Variable.name — engine.mjs 5.3.0. */
export const CQL_DEBUG_VARIABLE_NAME_FIELD = 'y9i_1';

/** Variable.value — engine.mjs 5.3.0. */
export const CQL_DEBUG_VARIABLE_VALUE_FIELD = 'z9i_1';

/** BreakpointHandler mangled methods (engine.mjs 5.3.0). */
export const CqlDebugHandlerMethods = {
  onBeforeExpression: 'x9f',
  onAfterExpression: 'y9f',
  onExpressionDefEntered: 'a9g',
  onExpressionDefEvaluated: 'z9f',
  waitForResume: 'b9g',
} as const;

/** TerminologyProvider mangled methods (engine.mjs 5.3.0). */
export const CqlDebugTerminologyMethods = {
  expand: 'x9p',
  inValueSet: 'h9s',
  lookup: 'e9s',
} as const;

/** ValueSetInfo.id field (engine.mjs 5.3.0) — no public getter is exported. */
export const CQL_DEBUG_VALUESET_INFO_ID_FIELD = 'baf_1';

export const FHIR_MODEL_URI = 'http://hl7.org/fhir';

/**
 * Engine calls `action.equals(PAUSE_instance)`. Enum.equals is identity, so we cannot
 * construct a real PAUSE; return an object whose equals() recognizes the real enum.
 */
export function createPauseActionSentinel(): { equals(other: unknown): boolean } {
  return {
    equals(other: unknown): boolean {
      return other != null && String(other) === 'PAUSE';
    },
  };
}

type CqlDebugEngineState = Record<string, unknown> & {
  [CQL_DEBUG_STATE_HANDLER_FIELD]?: unknown;
};

type CqlDebugEngine = {
  evaluate: (params: never) => unknown;
  environment: unknown;
  [CQL_DEBUG_ENGINE_STATE_GETTER]?: () => CqlDebugEngineState;
};

export function attachBreakpointHandler(engine: object, handler: object): void {
  const typed = engine as CqlDebugEngine;
  const getter = typed[CQL_DEBUG_ENGINE_STATE_GETTER];
  if (typeof getter !== 'function') {
    throw new Error(
      `CqlEngine.${CQL_DEBUG_ENGINE_STATE_GETTER} missing — @cqframework/cql debug shim incompatible with this package version`
    );
  }
  const state = getter.call(typed);
  if (!state || typeof state !== 'object') {
    throw new Error('CqlEngine state unavailable for BreakpointHandler attach');
  }
  state[CQL_DEBUG_STATE_HANDLER_FIELD] = handler;
}

export function readBreakpointHandler(engine: object): unknown {
  const typed = engine as CqlDebugEngine;
  const getter = typed[CQL_DEBUG_ENGINE_STATE_GETTER];
  if (typeof getter !== 'function') {
    return undefined;
  }
  const state = getter.call(typed);
  return state?.[CQL_DEBUG_STATE_HANDLER_FIELD];
}
