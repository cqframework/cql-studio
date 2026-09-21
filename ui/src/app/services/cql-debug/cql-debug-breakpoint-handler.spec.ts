// Author: Preston Lee

import { describe, expect, it, afterEach } from 'vitest';
import {
  collectDeclarationLines,
  collectExecutableBreakpointLines,
  breakpointRejectionReason,
} from './cql-debug-breakpoint-lines.lib';
import { buildDefinitionIndex } from '../elm-locator.lib';
import { ElmIncludeParser } from '../elm-include.lib';
import {
  CqlDebugSabMode,
  breakpointMatchesElm,
  createCqlDebugBreakpointHandler,
  createDebugSharedBuffer,
  modeFromSab,
  notifyDebugResume,
  type CqlDebugPauseFrame,
  type CqlDebugStepMode,
} from './cql-debug-breakpoint-handler';
import { CqlDebugHandlerMethods } from './cql-debug-engine-api';

describe('cql-debug-breakpoint-lines', () => {
  const elmXml = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns="urn:hl7-org:elm:r1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:t="urn:hl7-org:elm-types:r1">
  <identifier id="BpLines" version="0.0.1"/>
  <schemaIdentifier id="urn:hl7-org:elm" version="r1"/>
  <usings>
    <def localIdentifier="System" uri="urn:hl7-org:elm-types:r1" locator="1:1-1:20"/>
  </usings>
  <valueSets>
    <def name="DemoVS" id="http://example.org/vs" locator="3:1-3:40"/>
  </valueSets>
  <statements>
    <def name="Answer" locator="5:1-5:20" xsi:type="ExpressionDef" accessLevel="Public">
      <expression localId="1" locator="5:15-5:20" xsi:type="Literal" valueType="t:Integer" value="2"/>
    </def>
    <def name="Sum" locator="7:1-8:10" xsi:type="ExpressionDef" accessLevel="Public">
      <expression localId="2" locator="8:3-8:10" xsi:type="Add">
        <operand localId="3" locator="8:3-8:3" xsi:type="Literal" valueType="t:Integer" value="1"/>
        <operand localId="4" locator="8:7-8:7" xsi:type="Literal" valueType="t:Integer" value="1"/>
      </expression>
    </def>
  </statements>
</library>`;

  it('collects ExpressionDef / nested expression start lines only', () => {
    const lines = collectExecutableBreakpointLines(elmXml);
    expect(lines.has(5)).toBe(true);
    expect(lines.has(7)).toBe(true);
    expect(lines.has(8)).toBe(true);
    expect(lines.has(1)).toBe(false);
    expect(lines.has(3)).toBe(false);
    expect(lines.get(5)?.localId).toBeNull();
    expect(lines.get(8)?.localId).toBe('2');
  });

  it('marks declaration lines from the definition index', () => {
    const index = buildDefinitionIndex(elmXml, new ElmIncludeParser());
    expect(index).toBeTruthy();
    const decls = collectDeclarationLines(index, elmXml);
    expect(decls.has(3)).toBe(true);
    expect(decls.has(5)).toBe(false);
  });

  it('builds rejection reasons', () => {
    expect(breakpointRejectionReason(1, null, null)).toContain('Validate the library');
    const lines = collectExecutableBreakpointLines(elmXml);
    const index = buildDefinitionIndex(elmXml, new ElmIncludeParser());
    const decls = collectDeclarationLines(index, elmXml);
    expect(breakpointRejectionReason(3, lines, decls)).toContain('declaration');
    expect(breakpointRejectionReason(99, lines, decls)).toContain('No executable expression');
    expect(breakpointRejectionReason(5, lines, decls)).toBe('');
    expect(breakpointRejectionReason(42, new Map(), null)).toContain('No executable expressions');
  });
});

describe('CqlDebugSabMode stepOut', () => {
  it('encodes and decodes stepOut without colliding with stop', () => {
    expect(CqlDebugSabMode.stepOut).toBe(3);
    expect(CqlDebugSabMode.stop).toBe(4);
    const sab = createDebugSharedBuffer();
    notifyDebugResume(sab, 'stepOut');
    expect(modeFromSab(new Int32Array(sab))).toBe('stepOut');
    notifyDebugResume(sab, 'stop');
    expect(modeFromSab(new Int32Array(sab))).toBe('stop');
  });
});

describe('createCqlDebugBreakpointHandler call stack', () => {
  const originalWait = Atomics.wait;

  afterEach(() => {
    Atomics.wait = originalWait;
  });

  function stubAtomicsWaitAsContinue(sab: SharedArrayBuffer, mode: CqlDebugStepMode = 'continue'): void {
    Atomics.wait = ((typedArray: Int32Array, index: number) => {
      notifyDebugResume(sab, mode);
      return 'ok';
    }) as typeof Atomics.wait;
  }

  it('pushes and pops ExpressionDef frames and exposes reversed stack on pause', () => {
    const sab = createDebugSharedBuffer();
    stubAtomicsWaitAsContinue(sab, 'continue');
    let stepMode: CqlDebugStepMode = 'stepInto';
    let paused: CqlDebugPauseFrame | null = null;
    const handler = createCqlDebugBreakpointHandler({
      sab,
      getBreakpoints: () => [],
      getStepMode: () => stepMode,
      setStepMode: mode => {
        stepMode = mode;
      },
      shouldAbort: () => false,
      serializeVariables: () => [],
      onPause: frame => {
        paused = frame;
      },
    }) as Record<string, (...args: unknown[]) => unknown>;

    const outer = { name: 'Outer', locator: '10:1-12:1', localId: 'outer' };
    const inner = { name: 'Inner', locator: '20:1-22:1', localId: 'inner' };
    const callSite = { locator: '11:5-11:10' };
    const leaf = { locator: '21:3-21:8', localId: 'leaf' };

    handler[CqlDebugHandlerMethods.onExpressionDefEntered](outer, null, {});
    handler[CqlDebugHandlerMethods.onExpressionDefEntered](inner, callSite, {});
    handler[CqlDebugHandlerMethods.onBeforeExpression](leaf, {});

    expect(paused).toBeTruthy();
    expect(paused!.stackDepth).toBe(2);
    expect(paused!.stack.length).toBe(2);
    expect(paused!.stack[0].defineName).toBe('Inner');
    expect(paused!.stack[0].line).toBe(11);
    expect(paused!.stack[1].defineName).toBe('Outer');
    expect(paused!.defineName).toBe('Inner');

    handler[CqlDebugHandlerMethods.onExpressionDefEvaluated](inner, {}, 1);
    handler[CqlDebugHandlerMethods.onExpressionDefEvaluated](outer, {}, 1);

    stepMode = 'stepInto';
    handler[CqlDebugHandlerMethods.onBeforeExpression](leaf, {});
    expect(paused!.stackDepth).toBe(0);
    expect(paused!.stack.length).toBe(0);
  });

  it('records lastValue from onAfterExpression', () => {
    const sab = createDebugSharedBuffer();
    stubAtomicsWaitAsContinue(sab, 'continue');
    let stepMode: CqlDebugStepMode = 'stepInto';
    let paused: CqlDebugPauseFrame | null = null;
    const handler = createCqlDebugBreakpointHandler({
      sab,
      getBreakpoints: () => [],
      getStepMode: () => stepMode,
      setStepMode: mode => {
        stepMode = mode;
      },
      shouldAbort: () => false,
      serializeVariables: () => [],
      onPause: frame => {
        paused = frame;
      },
    }) as Record<string, (...args: unknown[]) => unknown>;

    handler[CqlDebugHandlerMethods.onExpressionDefEntered](
      { name: 'Answer', locator: '5:1-5:20' },
      null,
      {}
    );
    handler[CqlDebugHandlerMethods.onAfterExpression](
      { locator: '5:15-5:20' },
      {},
      { value: 2, typeAsString: 'Integer' }
    );
    handler[CqlDebugHandlerMethods.onBeforeExpression]({ locator: '5:15-5:20' }, {});

    expect(paused?.lastValue).toEqual({
      defineName: 'Answer',
      line: 5,
      type: 'Integer',
      value: '2',
    });
  });

  it('stepOut at depth 0 clears to continue', () => {
    const sab = createDebugSharedBuffer();
    stubAtomicsWaitAsContinue(sab, 'stepOut');
    let stepMode: CqlDebugStepMode = 'stepInto';
    const handler = createCqlDebugBreakpointHandler({
      sab,
      getBreakpoints: () => [],
      getStepMode: () => stepMode,
      setStepMode: mode => {
        stepMode = mode;
      },
      shouldAbort: () => false,
      serializeVariables: () => [],
      onPause: () => undefined,
    }) as Record<string, (...args: unknown[]) => unknown>;

    handler[CqlDebugHandlerMethods.onBeforeExpression]({ locator: '1:1-1:1' }, {});
    expect(stepMode).toBe('continue');
  });

  it('does not serialize variables on the continue hot path', () => {
    const sab = createDebugSharedBuffer();
    let serializeCalls = 0;
    let stepMode: CqlDebugStepMode = 'continue';
    const handler = createCqlDebugBreakpointHandler({
      sab,
      getBreakpoints: () => [],
      getStepMode: () => stepMode,
      setStepMode: mode => {
        stepMode = mode;
      },
      shouldAbort: () => false,
      serializeVariables: () => {
        serializeCalls += 1;
        return [];
      },
      onPause: () => undefined,
    }) as Record<string, (...args: unknown[]) => unknown>;

    for (let i = 0; i < 50; i++) {
      handler[CqlDebugHandlerMethods.onBeforeExpression](
        { locator: `${i}:1-${i}:5`, localId: String(i) },
        { big: 'state' }
      );
    }
    expect(serializeCalls).toBe(0);
  });

  it('matches breakpoints by locator, not line alone across libraries', () => {
    expect(
      breakpointMatchesElm(
        { id: 'bp-1', line: 42, enabled: true, locator: '42:1-42:20', localId: '10' },
        { locator: '42:1-42:20', localId: '10' },
        42
      )
    ).toBe(true);
    // Same line in an included library — different locator — must not match.
    expect(
      breakpointMatchesElm(
        { id: 'bp-1', line: 42, enabled: true, locator: '42:1-42:20', localId: '10' },
        { locator: '42:3-42:18', localId: '99' },
        42
      )
    ).toBe(false);
  });
});
