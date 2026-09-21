// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  CQL_DEBUG_ACTIVATION_FRAME_ELEMENT_FIELD,
  CQL_DEBUG_ACTIVATION_FRAME_VARIABLES_FIELD,
  CQL_DEBUG_STATE_STACK_FIELD,
  CQL_DEBUG_VARIABLE_NAME_FIELD,
  CQL_DEBUG_VARIABLE_VALUE_FIELD,
} from './cql-debug-engine-api';
import {
  serializeDebugVariables,
  serializeDebugVariablesByActivationFrame,
} from './cql-debug-value-dto';

function fakeDeque(items: unknown[]): Record<string, unknown> {
  return {
    t: () => {
      let i = 0;
      return {
        u: () => i < items.length,
        v: () => items[i++],
      };
    },
  };
}

describe('serializeDebugVariablesByActivationFrame', () => {
  it('returns per ExpressionDef frame without cross-frame name collapse', () => {
    const outerVar = {
      [CQL_DEBUG_VARIABLE_NAME_FIELD]: 'x',
      [CQL_DEBUG_VARIABLE_VALUE_FIELD]: { value: 1, typeAsString: 'Integer' },
    };
    const innerVar = {
      [CQL_DEBUG_VARIABLE_NAME_FIELD]: 'x',
      [CQL_DEBUG_VARIABLE_VALUE_FIELD]: { value: 2, typeAsString: 'Integer' },
    };
    const root = {
      [CQL_DEBUG_ACTIVATION_FRAME_ELEMENT_FIELD]: null,
      [CQL_DEBUG_ACTIVATION_FRAME_VARIABLES_FIELD]: fakeDeque([]),
    };
    const outer = {
      [CQL_DEBUG_ACTIVATION_FRAME_ELEMENT_FIELD]: { name: 'Outer' },
      [CQL_DEBUG_ACTIVATION_FRAME_VARIABLES_FIELD]: fakeDeque([outerVar]),
    };
    const inner = {
      [CQL_DEBUG_ACTIVATION_FRAME_ELEMENT_FIELD]: { name: 'Inner' },
      [CQL_DEBUG_ACTIVATION_FRAME_VARIABLES_FIELD]: fakeDeque([innerVar]),
    };
    // Stack iterator order: top (inner) first.
    const state = {
      [CQL_DEBUG_STATE_STACK_FIELD]: fakeDeque([inner, outer, root]),
    };

    const byFrame = serializeDebugVariablesByActivationFrame(state);
    expect(byFrame).toHaveLength(2);
    expect(byFrame[0]).toEqual([{ name: 'x', type: 'Integer', value: '2' }]);
    expect(byFrame[1]).toEqual([{ name: 'x', type: 'Integer', value: '1' }]);

    const flat = serializeDebugVariables(state);
    expect(flat).toEqual([{ name: 'x', type: 'Integer', value: '2' }]);
  });
});
