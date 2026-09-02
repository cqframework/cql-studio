// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ElmIncludeParser } from './elm-include.lib';
import { buildDefinitionIndex } from './elm-locator.lib';
import {
  buildTerminologySymbolIndex,
  buildTerminologySymbolIndexFromElm,
  findTerminologySymbolAt,
  provisionalFhirIdFromUrl
} from './cql-terminology-symbols.lib';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const terminologyElm = readFileSync(join(fixturesDir, 'terminology-sample.elm.xml'), 'utf8');

describe('cql-terminology-symbols.lib', () => {
  const source = `
library Test version '1.0.0'
codesystem "LOINC": 'http://loinc.org'
valueset "Mammography": 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.108.12.1018'
define "In VS": [Observation: "Mammography"]
code "HbA1c": '4548-4' from "LOINC" display 'Hemoglobin A1c'
`.trim();

  it('parses valueset and codesystem declarations from source (no fragile use scan)', () => {
    const index = buildTerminologySymbolIndex(source);
    expect(index.declarations).toHaveLength(2);
    expect(index.byName.get('LOINC')?.url).toBe('http://loinc.org');
    expect(index.byName.get('Mammography')?.kind).toBe('ValueSet');
    expect(index.nameUses).toHaveLength(0);
  });

  it('ignores valueset/codesystem keyword prefixes without a following space', () => {
    const index = buildTerminologySymbolIndex('valuesets "X": \'http://example.org\'\n');
    expect(index.declarations).toHaveLength(0);
  });

  it('keeps ELM decls when source locator line cannot refine tokens', () => {
    const elmIndex = buildDefinitionIndex(terminologyElm, new ElmIncludeParser())!;
    const index = buildTerminologySymbolIndexFromElm(elmIndex, 'library Only\n');
    expect(index.byName.get('Mammography')?.url).toBe('http://example.org/ValueSet/mammography');
    expect(index.nameUses.some(u => u.name === 'Mammography')).toBe(true);
  });

  it('indexes name uses from ELM ValueSetRef/CodeSystemRef', () => {
    const alignedSource = `
library TerminologySample version '1.0.0'

codesystem "LOINC": 'http://loinc.org'
valueset "Mammography": 'http://example.org/ValueSet/mammography'
valueset "Unused VS": 'http://example.org/ValueSet/unused'

define "In VS": "Mammography"
define "From LOINC": "LOINC"
`.trim();
    const elmIndex = buildDefinitionIndex(terminologyElm, new ElmIncludeParser())!;
    const index = buildTerminologySymbolIndexFromElm(elmIndex, alignedSource);
    expect(index.byName.get('Mammography')?.url).toBe('http://example.org/ValueSet/mammography');
    expect(index.nameUses.some(u => u.name === 'Mammography')).toBe(true);
    expect(index.nameUses.some(u => u.name === 'LOINC')).toBe(true);
    expect(index.nameUses.some(u => u.name === 'Unused VS')).toBe(false);
  });

  it('finds symbol at declaration name and url', () => {
    const index = buildTerminologySymbolIndex(source);
    const nameHit = findTerminologySymbolAt(index, 2, 12);
    expect(nameHit?.declaration.name).toBe('LOINC');
    expect(nameHit?.hit).toBe('name');

    const urlHit = findTerminologySymbolAt(index, 2, 25);
    expect(urlHit?.hit).toBe('url');
  });

  it('provisionalFhirIdFromUrl uses last path segment', () => {
    expect(provisionalFhirIdFromUrl('http://example.org/ValueSet/abc-123')).toBe('abc-123');
  });
});
