// Author: Preston Lee

import { Injectable } from '@angular/core';
import { BaseElement, GuidelinesArtifact, Parameter, ConjunctionGroup, CqlFunction } from './guidelines-state.service';

@Injectable({
  providedIn: 'root'
})
export class CqlParsingService {

  /**
   * Parse CQL text into visual builder artifact model
   * This is a simplified parser - full implementation would handle all CQL constructs
   */
  parseCql(cql: string): GuidelinesArtifact | null {
    try {
      const lines = cql.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      // Extract library metadata
      const libraryMatch = cql.match(/library\s+(\w+)\s+version\s+['"]([^'"]+)['"]/i);
      const libraryName = libraryMatch ? libraryMatch[1] : 'ParsedGuideline';
      const libraryVersion = libraryMatch ? libraryMatch[2] : '1.0.0';

      // Extract using statement
      const usingMatch = cql.match(/using\s+FHIR\s+version\s+['"]([^'"]+)['"]/i);
      const fhirVersion = usingMatch ? usingMatch[1] : '4.0.1';

      // Parse parameters
      const parameters = this.parseParameters(cql);

      // Parse functions
      const functions = this.parseFunctions(cql);

      // Parse define statements (base elements)
      const baseElements = this.parseDefines(cql);

      // Extract description if present
      const descriptionMatch = cql.match(/\/\*\*([^*]+)\*\//s);
      const description = descriptionMatch ? descriptionMatch[1].trim() : '';

      // Create empty conjunction groups for inclusions/exclusions
      const emptyConjunctionGroup: ConjunctionGroup = {
        uniqueId: `group-${Date.now()}`,
        type: 'conjunction',
        name: 'And',
        fields: [],
        modifiers: [],
        returnType: 'boolean',
        conjunction: true,
        childInstances: [],
        path: ''
      };

      const artifact: GuidelinesArtifact = {
        expTreeInclude: { ...emptyConjunctionGroup, uniqueId: `include-${Date.now()}` },
        expTreeExclude: { ...emptyConjunctionGroup, uniqueId: `exclude-${Date.now()}` },
        baseElements,
        parameters,
        functions: functions,
        recommendations: [],
        subpopulations: [],
        externalCql: [],
        metadata: {
          name: libraryName,
          title: libraryName,
          version: libraryVersion,
          description: description || `Guideline: ${libraryName}`,
          url: '',
          fhirVersion: fhirVersion
        }
      };

      return artifact;
    } catch (error) {
      console.error('Error parsing CQL:', error);
      return null;
    }
  }

  /**
   * Parse functions from CQL
   */
  private parseFunctions(cql: string): CqlFunction[] {
    const functions: CqlFunction[] = [];
    // Match function definitions: define function "Name"(params): ReturnType
    const functionRegex = /define\s+function\s+"([^"]+)"\s*\(([^)]*)\)\s*:\s*(\w+)/gi;
    let match;
    
    while ((match = functionRegex.exec(cql)) !== null) {
      const name = match[1];
      const paramsStr = match[2].trim();
      const returnType = match[3];
      
      // Parse parameters
      const parameters: Array<{ name: string; type: string }> = [];
      if (paramsStr) {
        const paramParts = paramsStr.split(',').map(p => p.trim());
        paramParts.forEach(param => {
          const parts = param.split(/\s+/);
          if (parts.length >= 2) {
            parameters.push({
              name: parts[0],
              type: parts.slice(1).join(' ')
            });
          }
        });
      }
      
      // Try to extract function body (simplified - would need full parser for complex bodies)
      const functionId = `func-${Date.now()}-${functions.length}`;
      const emptyBody: ConjunctionGroup = {
        uniqueId: `body-${functionId}`,
        type: 'conjunction',
        name: 'And',
        fields: [],
        modifiers: [],
        returnType: returnType,
        conjunction: true,
        childInstances: [],
        path: ''
      };
      
      functions.push({
        id: functionId,
        name: name,
        returnType: returnType,
        parameters: parameters,
        body: emptyBody,
        description: ''
      });
    }
    
    return functions;
  }

  /**
   * Parse parameter declarations from CQL
   */
  private parseParameters(cql: string): Parameter[] {
    const parameters: Parameter[] = [];
    const parameterRegex = /parameter\s+["']([^"']+)["']\s+(\w+)(?:\s+default\s+(.+))?/gi;
    let match;

    while ((match = parameterRegex.exec(cql)) !== null) {
      const name = match[1];
      const type = match[2];
      const defaultValue = match[3] ? match[3].trim() : undefined;

      parameters.push({
        name,
        type,
        defaultValue: defaultValue ? this.parseValue(defaultValue, type) : undefined
      });
    }

    return parameters;
  }

  /**
   * Parse define statements from CQL
   */
  private parseDefines(cql: string): BaseElement[] {
    const baseElements: BaseElement[] = [];
    const defineRegex = /define\s+["']([^"']+)["']\s*:\s*([^\n]+(?:\n(?!define)[^\n]*)*)/gi;
    let match;

    while ((match = defineRegex.exec(cql)) !== null) {
      const name = match[1];
      const expression = match[2].trim();

      const element: BaseElement = {
        uniqueId: `element-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        type: 'baseElement',
        name: name,
        fields: [
          { id: 'element_name', type: 'string', value: name }
        ],
        modifiers: [],
        returnType: 'boolean'
      };

      // Try to extract more information from expression
      // This is simplified - full implementation would parse the full CQL expression tree
      if (expression.includes('and') || expression.includes('or')) {
        element.conjunction = true;
        element.name = expression.includes('and') ? 'And' : 'Or';
      }

      baseElements.push(element);
    }

    return baseElements;
  }

  /**
   * Parse a value string into appropriate type
   */
  private parseValue(value: string, type: string): any {
    value = value.trim();

    // Remove quotes if present
    if ((value.startsWith("'") && value.endsWith("'")) || 
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }

    switch (type.toLowerCase()) {
      case 'integer':
        return parseInt(value, 10);
      case 'decimal':
        return parseFloat(value);
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'date':
      case 'datetime':
        // Remove @ prefix if present
        if (value.startsWith('@')) {
          value = value.slice(1);
        }
        return value;
      default:
        return value;
    }
  }
}

