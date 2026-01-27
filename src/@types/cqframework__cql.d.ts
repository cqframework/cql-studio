// Type declarations for @cqframework/cql package
// The package has generated types but TypeScript needs a module declaration

declare module '@cqframework/cql/cql-to-elm' {
  export class ModelManager {
    constructor(namespaceManager?: any, enableDefaultModelInfoLoading?: boolean, path?: any, globalCache?: any);
    modelInfoLoader: any;
  }
  
  export class LibraryManager {
    constructor(modelManager: ModelManager, cqlCompilerOptions?: any, libraryCache?: any, lazyUcumService?: any, elmLibraryReaderProvider?: any);
    librarySourceLoader: any;
  }
  
  export class CqlTranslator {
    static fromText(cqlText: string, libraryManager: LibraryManager): CqlTranslator;
    toXml(): string;
    errors?: any;
    warnings?: any;
    messages?: any;
  }
  
  export class CqlCompilerException {
    message?: string;
    locator?: {
      startLine?: number;
      startChar?: number;
    };
  }
  
  export function createModelInfoProvider(getModelInfoXml: (id: string, system: string | null | undefined, version: string | null | undefined) => any): any;
  export function createLibrarySourceProvider(getLibraryCql: (id: string, system: string | null | undefined, version: string | null | undefined) => any): any;
  export function createUcumService(convertUnit: (value: string, fromUnit: string, toUnit: string) => string, validateUnit: (unit: string) => string | null): any;
  export function stringAsSource(str: string): any;
}
