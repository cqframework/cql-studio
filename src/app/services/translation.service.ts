// Author: Preston Lee

import { Injectable } from '@angular/core';
// @ts-expect-error No type definitions available for @lhncbc/ucum-lhc
import * as ucum from '@lhncbc/ucum-lhc';
import { 
  ModelManager, 
  LibraryManager, 
  CqlTranslator, 
  CqlCompilerException,
  createModelInfoProvider,
  createLibrarySourceProvider,
  createUcumService,
  stringAsSource
} from '@cqframework/cql/cql-to-elm';

export interface TranslationResult {
  elmXml: string | null;
  errors: string[];
  warnings: string[];
  messages: string[];
  hasErrors: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  private modelManager: ModelManager;
  private libraryManager: LibraryManager;
  
  // Hardcoded FHIR version - not configurable
  private readonly FHIR_VERSION = '4.0.1';

  constructor() {
    // Create ModelManager with default model info loading enabled
    this.modelManager = new ModelManager(undefined, true);
    
    // Create UCUM service for unit validation (same pattern as cql-to-elm-ui)
    const ucumUtils = ucum.UcumLhcUtils.getInstance();
    const validateUnit = (unit: string): string | null => {
      const result = ucumUtils.validateUnitString(unit);
      if (result.status === 'valid') {
        return null;
      } else {
        return result.msg[0];
      }
    };
    const ucumService = createUcumService(
      () => {
        throw new Error('Unsupported operation');
      },
      validateUnit
    );
    
    // Register model info provider for System and FHIR models
    const modelInfoProvider = createModelInfoProvider(
      (id: string, system: string | null | undefined, version: string | null | undefined) => {
        // System model
        if (id === 'System' && !system && !version) {
          try {
            const xml = this.fetchModelInfoSync('/cql/system-modelinfo.xml');
            return stringAsSource(xml);
          } catch (e) {
            console.warn('Failed to load System model info:', e);
            return null;
          }
        }
        
        // FHIR model - only support 4.0.1
        if (id === 'FHIR' && !system && version === this.FHIR_VERSION) {
          try {
            const xml = this.fetchModelInfoSync(`/cql/fhir-modelinfo-${this.FHIR_VERSION}.xml`);
            return stringAsSource(xml);
          } catch (e) {
            console.warn(`Failed to load FHIR ${this.FHIR_VERSION} model info:`, e);
            return null;
          }
        }
        
        // Reject other FHIR versions
        if (id === 'FHIR' && version !== this.FHIR_VERSION) {
          console.warn(`FHIR version ${version} is not supported. Only ${this.FHIR_VERSION} is supported.`);
          return null;
        }
        
        return null;
      }
    );
    
    this.modelManager.modelInfoLoader.registerModelInfoProvider(modelInfoProvider, true);
    
    // Create LibraryManager with the ModelManager and UCUM service
    this.libraryManager = new LibraryManager(this.modelManager, undefined, undefined, ucumService);
    
    // Register library source provider for common libraries like FHIRHelpers
    const librarySourceProvider = createLibrarySourceProvider(
      (id: string, system: string | null | undefined, version: string | null | undefined) => {
        // FHIRHelpers library - only support 4.0.1
        if (id === 'FHIRHelpers' && !system && version === this.FHIR_VERSION) {
          try {
            const cql = this.fetchModelInfoSync(`/cql/FHIRHelpers-${this.FHIR_VERSION}.cql`);
            return stringAsSource(cql);
          } catch (e) {
            console.warn(`Failed to load FHIRHelpers ${this.FHIR_VERSION}:`, e);
            return null;
          }
        }
        
        // Reject other FHIRHelpers versions
        if (id === 'FHIRHelpers' && version !== this.FHIR_VERSION) {
          console.warn(`FHIRHelpers version ${version} is not supported. Only ${this.FHIR_VERSION} is supported.`);
          return null;
        }
        
        return null;
      }
    );
    
    this.libraryManager.librarySourceLoader.registerProvider(librarySourceProvider);
  }

  /**
   * Synchronously fetch model info XML from local app resources
   * Files are served from the public/cql directory at runtime
   */
  private fetchModelInfoSync(path: string): string {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', path, false); // false = synchronous
    xhr.send(null);
    
    if (xhr.status === 200) {
      return xhr.responseText;
    } else {
      throw new Error(`Failed to fetch ${path}: ${xhr.status} ${xhr.statusText}`);
    }
  }

  /**
   * Translate CQL to ELM using the @cqframework/cql library
   * @param cql The CQL code to translate
   * @returns TranslationResult containing ELM XML and any errors/warnings/messages
   */
  translateCqlToElm(cql: string): TranslationResult {
    try {
      const translator = CqlTranslator.fromText(cql, this.libraryManager);
      
      // Extract errors, warnings, and messages
      const errors = translator.errors?.asJsReadonlyArrayView() || [];
      const warnings = translator.warnings?.asJsReadonlyArrayView() || [];
      const messages = translator.messages?.asJsReadonlyArrayView() || [];
      
      // Format exception messages
      const errorMessages = errors
        .filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null)
        .map((e: CqlCompilerException) => this.formatException(e));
      const warningMessages = warnings
        .filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null)
        .map((e: CqlCompilerException) => this.formatException(e));
      const infoMessages = messages
        .filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null)
        .map((e: CqlCompilerException) => this.formatException(e));
      
      // Get ELM XML (even if there are errors, we may still have partial results)
      let elmXml: string | null = null;
      try {
        elmXml = translator.toXml();
        // XML formatting is handled in the ELM tab component using Prism
      } catch (e) {
        // If toXml fails, elmXml remains null
        console.warn('Failed to generate ELM XML:', e);
      }
      
      return {
        elmXml,
        errors: errorMessages,
        warnings: warningMessages,
        messages: infoMessages,
        hasErrors: errorMessages.length > 0
      };
    } catch (error) {
      // Handle unexpected errors during translation
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        elmXml: null,
        errors: [`Translation failed: ${errorMessage}`],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }
  }

  /**
   * Format a CqlCompilerException into a readable error message
   */
  private formatException(exception: CqlCompilerException): string {
    const message = exception.message || 'Unknown error';
    const locator = exception.locator;
    
    if (locator) {
      const line = locator.startLine != null ? locator.startLine : '?';
      const char = locator.startChar != null ? locator.startChar : '?';
      return `${message} (line ${line}, column ${char})`;
    }
    
    return message;
  }
}
