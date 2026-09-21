// Author: Preston Lee

import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { CqlLibrarySourceService } from './cql-library-source.service';
import { ElmIncludeParser } from './elm-include.lib';
import { encodeUtf8Base64 } from './utf8-encoding.lib';
import { Library } from 'fhir/r4';
import { minimalLibraryFields } from '../../testing/spec-helpers';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const helloCommonElm = readFileSync(join(fixturesDir, 'hello-common.elm.xml'), 'utf8');
const helloWorldElm = readFileSync(join(fixturesDir, 'hello-world.elm.xml'), 'utf8');

const helloCommonCql = `library HelloCommon version '0.0.0'
include FHIRHelpers version '4.0.1'
define function MagicNumber(): 42`;

const helloLeafCql = `library HelloLeaf version '1.0.0'
define function LeafValue(): 7`;

/** Mid library ELM that includes HelloLeaf (grandchild of a root that includes Mid). */
const helloMidElm = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:a="urn:hl7-org:cql-annotations:r1" xmlns="urn:hl7-org:elm:r1" xmlns:t="urn:hl7-org:elm-types:r1" localId="0">
  <identifier id="HelloMid" version="1.0.0"/>
  <includes>
    <def localIdentifier="HelloLeaf" path="HelloLeaf" version="1.0.0"/>
  </includes>
</library>`;

const helloMidCql = `library HelloMid version '1.0.0'
include HelloLeaf version '1.0.0' called HelloLeaf
define function MidValue(): HelloLeaf.LeafValue()`;

const helloRootElm = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:a="urn:hl7-org:cql-annotations:r1" xmlns="urn:hl7-org:elm:r1" xmlns:t="urn:hl7-org:elm-types:r1" localId="0">
  <identifier id="HelloRoot" version="1.0.0"/>
  <includes>
    <def localIdentifier="HelloMid" path="HelloMid" version="1.0.0"/>
  </includes>
</library>`;

const helloLeafElm = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:a="urn:hl7-org:cql-annotations:r1" xmlns="urn:hl7-org:elm:r1" xmlns:t="urn:hl7-org:elm-types:r1" localId="0">
  <identifier id="HelloLeaf" version="1.0.0"/>
</library>`;

function libraryWithContent(id: string, name: string, version: string, cql: string, elm: string): Library {
  return {
    resourceType: 'Library',
    ...minimalLibraryFields,
    id,
    name,
    version,
    content: [
      { contentType: 'text/cql', data: encodeUtf8Base64(cql) },
      { contentType: 'application/elm+xml', data: encodeUtf8Base64(elm) }
    ]
  };
}

describe('CqlLibrarySourceService', () => {
  let service: CqlLibrarySourceService;
  let libraryService: {
    findByNameAndVersion: ReturnType<typeof vi.fn>;
    getCqlContent: ReturnType<typeof vi.fn>;
    getElmXml: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    libraryService = {
      findByNameAndVersion: vi.fn(),
      getCqlContent: vi.fn(),
      getElmXml: vi.fn(),
      get: vi.fn()
    };
    const instance = Object.create(CqlLibrarySourceService.prototype) as CqlLibrarySourceService;
    Object.assign(instance as object, {
      libraryService,
      elmIncludeParser: new ElmIncludeParser(),
      cqlCache: new Map(),
      elmCache: new Map(),
    });
    service = instance;
  });

  it('prefetches HelloCommon from HelloWorld stored ELM', async () => {
    const helloCommon = libraryWithContent('HelloCommon', 'HelloCommon', '0.0.0', helloCommonCql, helloCommonElm);

    libraryService.findByNameAndVersion.mockImplementation((name: string, version?: string) => {
      if (name === 'HelloCommon' && version === '0.0.0') {
        return of(helloCommon);
      }
      return of(null);
    });
    libraryService.getCqlContent.mockImplementation((lib: Library) =>
      of({ cqlContent: helloCommonCql, fromUrl: false })
    );
    libraryService.getElmXml.mockImplementation((lib: Library) =>
      of(lib.id === 'HelloCommon' ? helloCommonElm : '')
    );

    const fetched = await service.prefetchIncludesFromElmXml(helloWorldElm);
    expect(fetched).toBe(true);
    expect(service.getCachedCql('HelloCommon', null, '0.0.0')).toBe(helloCommonCql);
    expect(libraryService.findByNameAndVersion).toHaveBeenCalledWith(
      'HelloCommon',
      '0.0.0',
      true,
      'logic-library'
    );
  });

  it('returns false on cache hit for second prefetch when tree is already complete', async () => {
    const helloCommon = libraryWithContent('HelloCommon', 'HelloCommon', '0.0.0', helloCommonCql, helloCommonElm);
    libraryService.findByNameAndVersion.mockReturnValue(of(helloCommon));
    libraryService.getCqlContent.mockReturnValue(of({ cqlContent: helloCommonCql, fromUrl: false }));
    libraryService.getElmXml.mockReturnValue(of(helloCommonElm));

    await service.prefetchIncludesFromElmXml(helloWorldElm);
    libraryService.findByNameAndVersion.mockClear();

    const fetched = await service.prefetchIncludesFromElmXml(helloWorldElm);
    expect(fetched).toBe(false);
    expect(libraryService.findByNameAndVersion).not.toHaveBeenCalled();
  });

  it('invalidate clears specific library cache entry', async () => {
    const helloCommon = libraryWithContent('HelloCommon', 'HelloCommon', '0.0.0', helloCommonCql, helloCommonElm);
    libraryService.findByNameAndVersion.mockReturnValue(of(helloCommon));
    libraryService.getCqlContent.mockReturnValue(of({ cqlContent: helloCommonCql, fromUrl: false }));
    libraryService.getElmXml.mockReturnValue(of(helloCommonElm));

    await service.prefetchIncludesFromElmXml(helloWorldElm);
    service.invalidate('HelloCommon', '0.0.0');
    expect(service.getCachedCql('HelloCommon', null, '0.0.0')).toBeNull();
  });

  it('prefetches grandchild libraries through mid include ELM', async () => {
    const mid = libraryWithContent('HelloMid', 'HelloMid', '1.0.0', helloMidCql, helloMidElm);
    const leaf = libraryWithContent('HelloLeaf', 'HelloLeaf', '1.0.0', helloLeafCql, helloLeafElm);

    libraryService.findByNameAndVersion.mockImplementation((name: string, version?: string) => {
      if (name === 'HelloMid' && version === '1.0.0') {
        return of(mid);
      }
      if (name === 'HelloLeaf' && version === '1.0.0') {
        return of(leaf);
      }
      return of(null);
    });
    libraryService.getCqlContent.mockImplementation((lib: Library) => {
      if (lib.id === 'HelloMid') {
        return of({ cqlContent: helloMidCql, fromUrl: false });
      }
      if (lib.id === 'HelloLeaf') {
        return of({ cqlContent: helloLeafCql, fromUrl: false });
      }
      return of({ cqlContent: '', fromUrl: false });
    });
    libraryService.getElmXml.mockImplementation((lib: Library) => {
      if (lib.id === 'HelloMid') {
        return of(helloMidElm);
      }
      if (lib.id === 'HelloLeaf') {
        return of(helloLeafElm);
      }
      return of('');
    });

    const fetched = await service.prefetchIncludesFromElmXml(helloRootElm);
    expect(fetched).toBe(true);
    expect(service.getCachedCql('HelloMid', null, '1.0.0')).toBe(helloMidCql);
    expect(service.getCachedCql('HelloLeaf', null, '1.0.0')).toBe(helloLeafCql);
  });

  it('walks grandchildren on CQL cache hit when ELM was not yet cached', async () => {
    const mid = libraryWithContent('HelloMid', 'HelloMid', '1.0.0', helloMidCql, helloMidElm);
    const leaf = libraryWithContent('HelloLeaf', 'HelloLeaf', '1.0.0', helloLeafCql, helloLeafElm);

    // Mid CQL already cached (e.g. from editor), but ELM/grandchildren not yet walked.
    service.setCachedCql('HelloMid', null, '1.0.0', helloMidCql);

    libraryService.findByNameAndVersion.mockImplementation((name: string, version?: string) => {
      if (name === 'HelloMid' && version === '1.0.0') {
        return of(mid);
      }
      if (name === 'HelloLeaf' && version === '1.0.0') {
        return of(leaf);
      }
      return of(null);
    });
    libraryService.getCqlContent.mockImplementation((lib: Library) => {
      if (lib.id === 'HelloLeaf') {
        return of({ cqlContent: helloLeafCql, fromUrl: false });
      }
      return of({ cqlContent: helloMidCql, fromUrl: false });
    });
    libraryService.getElmXml.mockImplementation((lib: Library) => {
      if (lib.id === 'HelloMid') {
        return of(helloMidElm);
      }
      if (lib.id === 'HelloLeaf') {
        return of(helloLeafElm);
      }
      return of('');
    });

    const fetched = await service.prefetchIncludesFromElmXml(helloRootElm);
    expect(fetched).toBe(true);
    expect(service.getCachedCql('HelloLeaf', null, '1.0.0')).toBe(helloLeafCql);
  });

  it('collectTransitiveCachedSources prefers root CQL over ELM when both are present', () => {
    service.setCachedCql('HelloMid', null, '1.0.0', helloMidCql);
    service.setCachedCql('HelloLeaf', null, '1.0.0', helloLeafCql);

    const rootCql = `library HelloRoot version '1.0.0'
include HelloMid version '1.0.0' called HelloMid`;

    // Empty/ unrelated ELM must not be preferred over root CQL.
    const sources = service.collectTransitiveCachedSources('<library/>', rootCql);
    expect(sources.map(s => s.id)).toEqual(['HelloMid', 'HelloLeaf']);
  });

  it('collectTransitiveCachedSources includes grandchild CQL for the debug worker', () => {
    service.setCachedCql('HelloMid', null, '1.0.0', helloMidCql);
    service.setCachedElm('HelloMid', null, '1.0.0', helloMidElm);
    service.setCachedCql('HelloLeaf', null, '1.0.0', helloLeafCql);
    service.setCachedElm('HelloLeaf', null, '1.0.0', helloLeafElm);

    const sources = service.collectTransitiveCachedSources(helloRootElm);
    expect(sources.map(s => s.id)).toEqual(['HelloMid', 'HelloLeaf']);
    expect(sources.find(s => s.id === 'HelloLeaf')?.cql).toBe(helloLeafCql);
  });

  it('collectTransitiveCachedSources walks CQL includes when mid library has no ELM', () => {
    // Mirrors LipidManagement package Libraries that ship text/cql only.
    service.setCachedCql('HelloMid', null, '1.0.0', helloMidCql);
    service.setCachedCql('HelloLeaf', null, '1.0.0', helloLeafCql);

    const sources = service.collectTransitiveCachedSources(helloRootElm);
    expect(sources.map(s => s.id)).toEqual(['HelloMid', 'HelloLeaf']);
  });

  it('prefetches grandchildren from CQL when Library has no stored ELM', async () => {
    const mid: Library = {
      resourceType: 'Library',
      ...minimalLibraryFields,
      id: 'HelloMid',
      name: 'HelloMid',
      version: '1.0.0',
      content: [{ contentType: 'text/cql', data: encodeUtf8Base64(helloMidCql) }],
    };
    const leaf: Library = {
      resourceType: 'Library',
      ...minimalLibraryFields,
      id: 'HelloLeaf',
      name: 'HelloLeaf',
      version: '1.0.0',
      content: [{ contentType: 'text/cql', data: encodeUtf8Base64(helloLeafCql) }],
    };

    libraryService.findByNameAndVersion.mockImplementation((name: string, version?: string) => {
      if (name === 'HelloMid' && version === '1.0.0') {
        return of(mid);
      }
      if (name === 'HelloLeaf' && version === '1.0.0') {
        return of(leaf);
      }
      return of(null);
    });
    libraryService.getCqlContent.mockImplementation((lib: Library) => {
      if (lib.id === 'HelloMid') {
        return of({ cqlContent: helloMidCql, fromUrl: false });
      }
      if (lib.id === 'HelloLeaf') {
        return of({ cqlContent: helloLeafCql, fromUrl: false });
      }
      return of({ cqlContent: '', fromUrl: false });
    });
    libraryService.getElmXml.mockReturnValue(of(''));

    const fetched = await service.prefetchIncludesFromElmXml(helloRootElm);
    expect(fetched).toBe(true);
    expect(service.getCachedCql('HelloMid', null, '1.0.0')).toBe(helloMidCql);
    expect(service.getCachedCql('HelloLeaf', null, '1.0.0')).toBe(helloLeafCql);
  });
});
