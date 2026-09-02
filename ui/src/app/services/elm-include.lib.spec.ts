// Author: Preston Lee

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';
import { ElmIncludeParser } from './elm-include.lib';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const helloCommonElm = readFileSync(join(fixturesDir, 'hello-common.elm.xml'), 'utf8');
const helloWorldElm = readFileSync(join(fixturesDir, 'hello-world.elm.xml'), 'utf8');

describe('ElmIncludeParser', () => {
  let parser: ElmIncludeParser;

  beforeEach(() => {
    parser = new ElmIncludeParser();
  });

  it('cacheKey normalizes null system and version', () => {
    expect(parser.cacheKey('HelloCommon', null, '0.0.0')).toBe('|HelloCommon|0.0.0');
  });

  it('parses HelloCommon ELM includes (FHIRHelpers only)', () => {
    const refs = parser.extractIncludes(helloCommonElm);
    expect(refs).toEqual([
      {
        path: 'FHIRHelpers',
        version: '4.0.1',
        localIdentifier: 'FHIRHelpers',
        system: null
      }
    ]);
  });

  it('extractFhirIncludes skips bundled FHIRHelpers', () => {
    expect(parser.extractFhirIncludes(helloCommonElm)).toEqual([]);
  });

  it('parses HelloWorld stored ELM via CqlToElmError fallback for HelloCommon', () => {
    const refs = parser.extractIncludes(helloWorldElm);
    expect(refs.some(r => r.path === 'HelloCommon' && r.version === '0.0.0')).toBe(true);
    expect(refs.some(r => r.path === 'FHIRHelpers')).toBe(true);
  });

  it('extractFhirIncludes returns HelloCommon from HelloWorld fixture', () => {
    const refs = parser.extractFhirIncludes(helloWorldElm);
    expect(refs).toEqual([
      {
        path: 'HelloCommon',
        version: '0.0.0',
        localIdentifier: null,
        system: null
      }
    ]);
  });

  it('parses successful include with called alias from synthetic ELM', () => {
    const elm = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:hl7-org:elm:r1">
  <includes>
    <def localIdentifier="Common" path="HelloCommon" version="0.0.0"/>
  </includes>
</library>`;
    const refs = parser.extractIncludes(elm);
    expect(refs).toEqual([
      {
        path: 'HelloCommon',
        version: '0.0.0',
        localIdentifier: 'Common',
        system: null
      }
    ]);
  });

  it('does not treat commented include text in annotation bodies as includes', () => {
    const elm = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xmlns:a="urn:hl7-org:cql-annotations:r1"
         xmlns="urn:hl7-org:elm:r1">
  <annotation xsi:type="a:Annotation">
    <a:s>// include FakeLib version '9.9.9' called Fake</a:s>
  </annotation>
  <includes>
    <def localIdentifier="FHIRHelpers" path="FHIRHelpers" version="4.0.1"/>
  </includes>
</library>`;
    const refs = parser.extractFhirIncludes(elm);
    expect(refs).toEqual([]);
  });

  it('deduplicates identical include refs', () => {
    const elm = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xmlns:a="urn:hl7-org:cql-annotations:r1"
         xmlns="urn:hl7-org:elm:r1">
  <annotation xsi:type="a:CqlToElmError" errorType="include"
    targetIncludeLibraryId="HelloCommon" targetIncludeLibraryVersionId="0.0.0"/>
  <includes>
    <def localIdentifier="Common" path="HelloCommon" version="0.0.0"/>
  </includes>
</library>`;
    const refs = parser.extractIncludes(elm);
    expect(refs.filter(r => r.path === 'HelloCommon')).toHaveLength(1);
  });

  it('returns empty array for invalid XML', () => {
    expect(parser.extractIncludes('not xml')).toEqual([]);
  });
});
