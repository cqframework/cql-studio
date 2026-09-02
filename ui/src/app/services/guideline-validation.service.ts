// Author: Preston Lee

import { Injectable } from '@angular/core';
import { Library } from 'fhir/r4';

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
}

@Injectable({
  providedIn: 'root'
})
export class GuidelineValidationService {

  /**
   * Check if a Library is in the expected guideline format
   */
  validateGuidelineFormat(library: Library): ValidationResult {
    const issues: string[] = [];

    // Check for required fields
    if (!library.name) {
      issues.push('Library name is missing');
    }

    if (!library.version) {
      issues.push('Library version is missing');
    }

    // Check for CQL content
    const hasCqlContent = library.content?.some(
      c => c.contentType === 'text/cql' && c.data
    );
    if (!hasCqlContent) {
      issues.push('Library does not contain CQL content');
    }

    // Check for visual builder metadata extension
    const hasMetadataExtension = library.extension?.some(
      ext => ext.url === 'http://cqframework.org/fhir/StructureDefinition/guidelines-builder-metadata'
    );

    // If no metadata extension, it might be a regular CQL library
    if (!hasMetadataExtension) {
      issues.push('Library does not appear to be created with the Guidelines visual builder');
    }

    // Check library type
    const isLogicLibrary = library.type?.coding?.some(
      coding => coding.code === 'logic-library'
    );
    if (!isLogicLibrary) {
      issues.push('Library type is not "logic-library"');
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }

  /**
   * Check if library can be cleanly opened (no conversion needed)
   */
  canCleanlyOpen(library: Library): boolean {
    // Can cleanly open if it has metadata extension and CQL content
    const hasMetadataExtension = !!library.extension?.some(
      ext => ext.url === 'http://cqframework.org/fhir/StructureDefinition/guidelines-builder-metadata'
    );
    const hasCqlContent = !!library.content?.some(
      c => c.contentType === 'text/cql' && c.data
    );
    return hasMetadataExtension && hasCqlContent && !!library.name && !!library.version;
  }
}

