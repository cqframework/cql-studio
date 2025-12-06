// Author: Preston Lee

import { Injectable } from '@angular/core';
import { BaseElement, GuidelinesArtifact, CqlFunction } from './guidelines-state.service';

@Injectable({
  providedIn: 'root'
})
export class CqlGenerationService {

  /**
   * Generate CQL text from visual builder artifact model
   */
  generateCql(artifact: GuidelinesArtifact): string {
    const metadata = artifact.metadata || {
      name: 'NewGuideline',
      version: '1.0.0'
    };

    let cql = `library ${metadata.name} version '${metadata.version || '1.0.0'}'\n\n`;
    cql += `using FHIR version '4.0.1'\n\n`;
    cql += `context Patient\n\n`;

    // Add parameters
    if (artifact.parameters && artifact.parameters.length > 0) {
      artifact.parameters.forEach(param => {
        cql += this.generateParameter(param);
      });
      cql += '\n';
    }

    // Add functions
    if (artifact.functions && artifact.functions.length > 0) {
      artifact.functions.forEach(func => {
        cql += this.generateFunction(func);
      });
      cql += '\n';
    }

    // Add base elements as defines
    if (artifact.baseElements && artifact.baseElements.length > 0) {
      artifact.baseElements.forEach((element, index) => {
        cql += this.generateDefine(element, index);
      });
    } else {
      // Default empty define
      cql += `define "Example":\n  true\n\n`;
    }

    return cql;
  }

  /**
   * Generate parameter declaration
   */
  private generateParameter(param: any): string {
    const name = param.name || 'UnnamedParameter';
    const type = param.type || 'String';
    let paramLine = `parameter "${name}" ${type}`;
    
    if (param.defaultValue !== undefined && param.defaultValue !== null) {
      paramLine += ` default ${this.formatValue(param.defaultValue, type)}`;
    }
    
    return paramLine + '\n';
  }

  /**
   * Generate function definition
   */
  private generateFunction(func: CqlFunction): string {
    const name = func.name || 'UnnamedFunction';
    const returnType = func.returnType || 'Boolean';
    
    // Build parameter list
    const params = func.parameters.map(p => {
      const paramName = p.name || 'param';
      const paramType = p.type || 'Boolean';
      return `${paramName} ${paramType}`;
    }).join(', ');
    
    let functionDef = `define function "${name}"(${params}): ${returnType}\n`;
    
    // Generate function body
    if (func.body) {
      const bodyExpression = this.generateExpression(func.body);
      functionDef += `  return ${bodyExpression}\n\n`;
    } else {
      // Default body if none provided
      functionDef += `  return null\n\n`;
    }
    
    return functionDef;
  }

  /**
   * Generate define statement from base element
   */
  private generateDefine(element: BaseElement, index: number): string {
    const name = element.name || `Element${index + 1}`;
    let define = `define "${name}":\n`;
    
    // Generate expression based on element type
    const expression = this.generateExpression(element);
    define += `  ${expression}\n\n`;
    
    return define;
  }

  /**
   * Generate CQL expression from base element
   */
  private generateExpression(element: BaseElement): string {
    // Handle conjunction groups (AND/OR)
    if (element.conjunction && element.childInstances && element.childInstances.length > 0) {
      const conjunction = element.name === 'And' ? 'and' : 'or';
      const expressions = element.childInstances.map(child => 
        this.generateExpression(child)
      );
      return `(${expressions.join(` ${conjunction} `)})`;
    }

    // Handle base element types
    switch (element.type) {
      case 'baseElement':
        return this.generateBaseElementExpression(element);
      case 'parameter':
        return element.name || 'null';
      case 'externalCqlElement':
        return this.generateExternalCqlExpression(element);
      default:
        // Try to extract from fields
        return this.generateFromFields(element);
    }
  }

  /**
   * Generate expression from base element fields
   */
  private generateBaseElementExpression(element: BaseElement): string {
    // Extract reference field if present
    const referenceField = element.fields?.find((f: any) => f.type === 'reference');
    if (referenceField && referenceField.value) {
      // This is a reference to another element
      return `"${referenceField.value}"`;
    }

    // Extract element name field
    const nameField = element.fields?.find((f: any) => f.id === 'element_name');
    const elementName = nameField?.value || element.name || 'Unknown';

    // Generate basic expression based on element name
    // This is a simplified version - full implementation would handle all element types
    return `exists([${elementName}])`;
  }

  /**
   * Generate external CQL expression
   */
  private generateExternalCqlExpression(element: BaseElement): string {
    const externalCqlField = element.fields?.find((f: any) => f.id === 'externalCqlReference');
    if (externalCqlField && externalCqlField.value) {
      const library = externalCqlField.value.library || '';
      const element = externalCqlField.value.element || '';
      return `${library}.${element}`;
    }
    return 'null';
  }

  /**
   * Generate expression from fields (fallback)
   */
  private generateFromFields(element: BaseElement): string {
    // Try to find value fields
    const valueField = element.fields?.find((f: any) => 
      f.type === 'number' || f.type === 'string' || f.type === 'boolean'
    );
    
    if (valueField && valueField.value !== undefined) {
      return this.formatValue(valueField.value, valueField.type || 'string');
    }

    // Default to true for boolean expressions
    return 'true';
  }

  /**
   * Format value for CQL
   */
  private formatValue(value: any, type: string): string {
    if (value === null || value === undefined) {
      return 'null';
    }

    switch (type.toLowerCase()) {
      case 'string':
        return `'${String(value).replace(/'/g, "''")}'`;
      case 'boolean':
        return String(value);
      case 'integer':
      case 'decimal':
        return String(value);
      case 'date':
      case 'datetime':
        return `@${value}`;
      default:
        return `'${String(value)}'`;
    }
  }
}

