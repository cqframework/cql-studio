// Author: Preston Lee

declare module '@cqframework/cql/cql-to-elm' {
  export class ModelManager {
    constructor(namespaceManager?: unknown, enableDefaultModelInfoLoading?: boolean, path?: unknown, globalCache?: unknown);
    modelInfoLoader: { registerModelInfoProvider(provider: unknown, priority?: boolean): void };
  }
  export class LibraryManager {
    constructor(modelManager: ModelManager, options?: unknown, cache?: unknown, ucumService?: unknown, elmReader?: unknown);
    librarySourceLoader: { registerProvider(provider: unknown): void };
  }
  export class CqlCompilerException {
    message?: string;
    locator?: unknown;
  }
  export class CqlTranslator {
    static fromText(cqlText: string, libraryManager: LibraryManager): CqlTranslator;
    errors?: { asJsReadonlyArrayView(): ReadonlyArray<CqlCompilerException | null | undefined> };
    warnings?: { asJsReadonlyArrayView(): ReadonlyArray<CqlCompilerException | null | undefined> };
    messages?: { asJsReadonlyArrayView(): ReadonlyArray<CqlCompilerException | null | undefined> };
  }
  export function createModelInfoProvider(provider: (id: string, system?: string | null, version?: string | null) => unknown): unknown;
  export function createLibrarySourceProvider(provider: (id: string, system?: string | null, version?: string | null) => unknown): unknown;
  export function createUcumService(convert: (...args: string[]) => unknown, validate: (unit: string) => string | null): unknown;
  export function stringAsSource(value: string): unknown;
}
