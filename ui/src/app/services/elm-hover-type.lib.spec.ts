// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { extractElmHoverTypeInfos, formatHoverTypeInfo } from './elm-hover-type.lib';

describe('elm-hover-type.lib', () => {
  it('extracts expression and function hover info from ELM XML', () => {
    const elm = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns="urn:hl7-org:elm:r1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <statements>
    <def name="Answer" locator="5:1-5:20" xsi:type="ExpressionDef" resultTypeName="t:Integer"/>
    <def name="MagicNumber" locator="6:1-7:3" xsi:type="FunctionDef" resultTypeName="t:Integer">
      <operand name="x" resultTypeName="t:Integer"/>
    </def>
  </statements>
</library>`;

    const infos = extractElmHoverTypeInfos(elm);
    const answer = infos.get('Answer')?.[0];
    expect(answer?.kind).toBe('expression');
    expect(answer?.resultType).toBe('t:Integer');
    expect(formatHoverTypeInfo(answer!)).toContain('define Answer: t:Integer');

    const fn = infos.get('MagicNumber')?.[0];
    expect(fn?.kind).toBe('function');
    expect(fn?.operands[0]?.name).toBe('x');
    expect(formatHoverTypeInfo(fn!)).toContain('function MagicNumber(x: t:Integer): t:Integer');
  });
});
