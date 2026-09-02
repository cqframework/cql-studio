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
    expect(libraryService.findByNameAndVersion).toHaveBeenCalledWith('HelloCommon', '0.0.0', true);
  });

  it('returns false on cache hit for second prefetch', async () => {
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
});
