// Author: Preston Lee

import { Injectable } from '@angular/core';
import { LibraryResource } from '../components/cql-ide/shared/ide-types';
import { LibraryTranslationContext } from './cql-library-source.service';

/**
 * Builds translation context from IDE library resources for include resolution.
 */
@Injectable({
  providedIn: 'root'
})
export class LibraryTranslationContextBuilder {
  fromLibraryResource(library: LibraryResource | null | undefined): LibraryTranslationContext | undefined {
    if (!library) {
      return undefined;
    }
    return {
      fhirLibraryId: library.library?.id ?? library.id,
      isDirty: library.isDirty
    };
  }
}
