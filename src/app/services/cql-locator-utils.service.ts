// Author: Preston Lee

import { Injectable } from '@angular/core';
import { CqlCompilerException } from '@cqframework/cql/cql-to-elm';

export interface LocatorInfo {
  line: number | null;
  column: number | null;
}

/**
 * Utility service for extracting line/column information from CQL compiler locators
 * Handles TrackBack objects with obfuscated Kotlin property names
 */
@Injectable({
  providedIn: 'root'
})
export class CqlLocatorUtilsService {
  /**
   * Extract line and column numbers from a CqlCompilerException locator
   * TrackBack objects use obfuscated Kotlin property names (e.g., x8z_1, y8z_1)
   */
  extractLocatorInfo(exception: CqlCompilerException): LocatorInfo {
    const locator = exception.locator;
    
    if (!locator) {
      return { line: null, column: null };
    }
    
    const locatorAny = locator as any;
    const locatorKeys = Object.keys(locator);
    const numericProps: Array<{key: string, value: number}> = [];
    
    // Collect all numeric properties from the TrackBack object
    for (const key of locatorKeys) {
      const value = locatorAny[key];
      if (typeof value === 'number' && value >= 0) {
        numericProps.push({key, value});
      }
    }
    
    // Sort by value to identify line vs column
    numericProps.sort((a, b) => a.value - b.value);
    
    let lineNumber: number | null = null;
    let columnNumber: number | null = null;
    
    // Strategy: The larger value is typically the line number, smaller is column
    // Based on observed structure: x8z_1 = startLine (larger), y8z_1 = startChar (smaller, often 0)
    // TrackBack may have: startLine, startChar, endLine, endChar
    if (numericProps.length >= 2) {
      // Find the largest value > 0 as line number (startLine or endLine)
      const lineCandidates = numericProps.filter(p => p.value > 0 && p.value <= 10000);
      if (lineCandidates.length > 0) {
        // Use the maximum value as line number
        lineNumber = Math.max(...lineCandidates.map(p => p.value));
      }
      
      // Find the smallest value >= 0 as column (startChar, often 0)
      const charCandidates = numericProps.filter(p => p.value >= 0 && p.value < 10000);
      if (charCandidates.length > 0) {
        // Use the minimum value as column number
        columnNumber = Math.min(...charCandidates.map(p => p.value));
      }
    } else if (numericProps.length === 1) {
      // Only one numeric property - assume it's the line number
      lineNumber = numericProps[0].value;
    }
    
    // Handle 0-based vs 1-based line numbers
    // CQL compiler appears to use 1-based line numbers (matches CodeMirror)
    if (lineNumber != null) {
      if (lineNumber === 0) {
        lineNumber = 1; // Convert 0-based to 1-based
      } else if (lineNumber < 0) {
        lineNumber = null; // Invalid line number
      }
    }
    
    // Column numbers appear to be 0-based (matches CodeMirror's 0-based positions)
    // Keep as-is, but ensure it's not negative
    if (columnNumber != null && columnNumber < 0) {
      columnNumber = null;
    }
    
    return {
      line: lineNumber,
      column: columnNumber
    };
  }
  
  /**
   * Format a locator info into a human-readable string
   */
  formatLocator(locatorInfo: LocatorInfo): string {
    if (locatorInfo.line != null) {
      const column = locatorInfo.column != null ? locatorInfo.column : '?';
      return `(line ${locatorInfo.line}, column ${column})`;
    }
    return '';
  }
}
