// Author: Preston Lee

import { LanguageSupport } from '@codemirror/language';
import { syntaxHighlighting, HighlightStyle, defaultHighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { completeFromList, autocompletion } from '@codemirror/autocomplete';
import { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { indentOnInput } from '@codemirror/language';

// Fixed CQL version
export type CqlVersion = '1.5.3';

// Grammar definition interface
export interface CqlGrammarDefinition {
  version: CqlVersion;
  keywords: string[];
  functions: string[];
  dataTypes: string[];
  operators: string[];
  patterns: {
    string: RegExp;
    number: RegExp;
    datetime: RegExp;
    identifier: RegExp;
  };
}

// CQL grammar definition (fixed to version 1.5.3)
const CQL_GRAMMAR: CqlGrammarDefinition = {
  version: '1.5.3',
  keywords: [
    // CQL 1.5.3 keywords from official specification
    'library', 'using', 'include', 'define', 'function', 'parameter', 'context',
    'public', 'private', 'valueset', 'codesystem', 'code', 'concept', 'where',
    'return', 'if', 'then', 'else', 'end', 'and', 'or', 'not', 'xor', 'implies',
    'true', 'false', 'null', 'exists', 'in', 'contains', 'properly', 'starts',
    'ends', 'matches', 'like', 'from', 'as', 'let', 'with', 'such', 'that',
    'all', 'any', 'some', 'every', 'distinct', 'sort', 'by', 'asc', 'desc',
    'union', 'intersect', 'except', 'times', 'divide', 'mod', 'div', 'is',
    'cast', 'convert', 'to', 'of', 'between', 'during', 'meets', 'overlaps',
    'includes', 'included', 'within', 'same', 'after', 'before', 'on', 'more',
    'less', 'equal', 'greater', 'than', 'called', 'version', 'default', 'display',
    'collapse', 'expand', 'flatten', 'fluent', 'per', 'point', 'predecessor',
    'successor', 'singleton', 'start', 'starting', 'timezoneoffset', 'when',
    'width', 'without', 'year', 'years', 'month', 'months', 'week', 'weeks',
    'day', 'days', 'hour', 'hours', 'minute', 'minutes', 'second', 'seconds',
    'millisecond', 'milliseconds', 'maximum', 'minimum', 'difference', 'duration',
    'occurs', 'or after', 'or before', 'or less', 'or more'
  ],
  functions: [
    // CQL 1.5.3 functions from official specification
    'Abs', 'Add', 'After', 'AllTrue', 'AnyTrue', 'As', 'Avg', 'Before', 'CanConvert',
    'Ceiling', 'Coalesce', 'Code', 'CodeSystem', 'Concept', 'ConvertsToBoolean',
    'ConvertsToDate', 'ConvertsToDateTime', 'ConvertsToDecimal', 'ConvertsToInteger',
    'ConvertsToLong', 'ConvertsToQuantity', 'ConvertsToString', 'ConvertsToTime',
    'Count', 'Date', 'DateTime', 'Day', 'DaysBetween', 'Distinct', 'DurationBetween',
    'Ends', 'Exists', 'Exp', 'Expand', 'First', 'Floor', 'Flatten', 'GeometricMean',
    'HighBoundary', 'Hour', 'HoursBetween', 'Identifier', 'If', 'IndexOf', 'Instance',
    'Interval', 'Is', 'IsNull', 'IsTrue', 'Last', 'Length', 'List', 'Ln', 'Log',
    'LowBoundary', 'Lower', 'Matches', 'Max', 'Maximum', 'Mean', 'Median', 'Min',
    'Minimum', 'Minute', 'MinutesBetween', 'Mode', 'Modulo', 'Month', 'MonthsBetween',
    'Multiply', 'Negate', 'Not', 'Now', 'Null', 'PointFrom', 'PopulationStdDev',
    'PopulationVariance', 'Power', 'Predecessor', 'Product', 'Properly', 'Quantity',
    'Round', 'Second', 'SecondsBetween', 'Singletons', 'Size', 'Split', 'Sqrt',
    'Starts', 'StdDev', 'String', 'Substring', 'Subtract', 'Sum', 'Time',
    'TimeOfDay', 'Today', 'ToBoolean', 'ToConcept', 'ToDate', 'ToDateTime',
    'ToDecimal', 'ToInteger', 'ToLong', 'ToQuantity', 'ToString', 'ToTime',
    'Truncate', 'Union', 'Upper', 'Variance', 'Width', 'Year', 'YearsBetween'
  ],
  dataTypes: [
    'Boolean', 'Integer', 'Long', 'Decimal', 'String', 'DateTime', 'Date', 'Time',
    'Quantity', 'Ratio', 'Code', 'Concept', 'CodeableConcept', 'Coding', 'Identifier',
    'Reference', 'Period', 'Range', 'Interval', 'List', 'Tuple', 'Choice'
  ],
  operators: ['+', '-', '*', '/', '=', '<>', '!=', '<', '>', '<=', '>=', 'and', 'or', 'not', 'xor', 'implies'],
  patterns: {
    string: /"[^"\\]*(\\.[^"\\]*)*"/,
    number: /\d+\.?\d*L?/,
    datetime: /@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/,
    identifier: /[a-zA-Z_][a-zA-Z0-9_]*/
  }
};


// Grammar Manager Service
export class CqlGrammarManager {
  private readonly currentGrammar: CqlGrammarDefinition;

  constructor() {
    this.currentGrammar = CQL_GRAMMAR;
  }

  // Get current version (always 1.5.3)
  getCurrentVersion(): CqlVersion {
    return '1.5.3';
  }

  // Get current grammar
  getCurrentGrammar(): CqlGrammarDefinition {
    return this.currentGrammar;
  }

  // Create language support for current version
  createLanguageSupport(): LanguageSupport {
    const grammar = this.currentGrammar;
    
    // Create completions
    const completions = [
      ...grammar.keywords.map(keyword => ({
        label: keyword,
        type: 'keyword',
        info: `CQL ${grammar.version} keyword: ${keyword}`,
        detail: 'keyword',
        boost: 10
      })),
      ...grammar.functions.map(func => ({
        label: func,
        type: 'function',
        info: `CQL ${grammar.version} function: ${func}`,
        detail: 'function',
        boost: 9
      })),
      ...grammar.dataTypes.map(type => ({
        label: type,
        type: 'type',
        info: `CQL ${grammar.version} data type: ${type}`,
        detail: 'type',
        boost: 8
      }))
    ];

    // Create token table to map string tokens to Lezer tags
    const tokenTable = {
      'keyword': tags.keyword,
      'string': tags.string,
      'comment': tags.comment,
      'number': tags.number,
      'function': tags.function(tags.variableName),
      'typeName': tags.typeName,
      'operator': tags.operator,
      'bracket': tags.bracket,
      'punctuation': tags.punctuation,
      'variableName': tags.variableName
    };

    // Create language definition that returns string tokens
    const language = StreamLanguage.define({
      name: `cql-${grammar.version}`,
      token: (stream, state) => {
        // Skip whitespace
        if (stream.eatSpace()) return null;
        
        // Comments
        if (stream.match('//')) {
          stream.skipToEnd();
          return 'comment';
        }
        
        if (stream.match('/*')) {
          while (!stream.eol()) {
            if (stream.match('*/')) break;
            stream.next();
          }
          return 'comment';
        }
        
        // Strings
        if (stream.match('"')) {
          while (!stream.eol()) {
            if (stream.match('"')) break;
            if (stream.match('\\')) {
              stream.next();
            }
            stream.next();
          }
          return 'string';
        }
        
        // Numbers
        if (stream.match(grammar.patterns.number)) {
          return 'number';
        }
        
        // DateTime
        if (stream.match(grammar.patterns.datetime)) {
          return 'string';
        }
        
        // Keywords
        const keywordPattern = new RegExp(`\\b(${grammar.keywords.join('|')})\\b`);
        if (stream.match(keywordPattern)) {
          const keyword = stream.current();
          return 'keyword';
        }
        
        // Functions
        const functionPattern = new RegExp(`\\b(${grammar.functions.join('|')})\\b`);
        if (stream.match(functionPattern)) {
          return 'function';
        }
        
        // Data types
        const typePattern = new RegExp(`\\b(${grammar.dataTypes.join('|')})\\b`);
        if (stream.match(typePattern)) {
          return 'typeName';
        }
        
        // Operators
        if (stream.match(/[+\-*/=<>!&|]+/)) {
          return 'operator';
        }
        
        // Brackets
        if (stream.match(/[{}[\]()]/)) {
          return 'bracket';
        }
        
        // Punctuation
        if (stream.match(/[;,.:]/)) {
          return 'punctuation';
        }
        
        // Identifiers
        if (stream.match(grammar.patterns.identifier)) {
          return 'variableName';
        }
        
        // Default
        stream.next();
        return null;
      }
    });


    
    // Create custom highlighting style for CQL with lighter, more readable colors
    const cqlHighlightStyle = HighlightStyle.define([
      { tag: tags.keyword, color: '#7bb3f0', fontWeight: 'bold' }, // Lighter blue for keywords
      { tag: tags.function(tags.variableName), color: '#f0e68c' }, // Lighter yellow for functions
      { tag: tags.typeName, color: '#6dd5ed' }, // Lighter cyan for type names
      { tag: tags.operator, color: '#e0e0e0' }, // Light gray for operators
      { tag: tags.number, color: '#a8d8a8' }, // Lighter green for numbers
      { tag: tags.string, color: '#f4a261' }, // Lighter orange for strings
      { tag: tags.variableName, color: '#b3d9ff' }, // Lighter blue for variables
      { tag: tags.comment, color: '#8fbc8f', fontStyle: 'italic' }, // Lighter green for comments
      { tag: tags.bracket, color: '#e0e0e0' }, // Light gray for brackets
      { tag: tags.punctuation, color: '#e0e0e0' } // Light gray for punctuation
    ]);

    return new LanguageSupport(language, [
      indentOnInput(),
      syntaxHighlighting(cqlHighlightStyle),
      autocompletion({
        override: [
          completeFromList(completions.map(completion => ({
            label: completion.label,
            type: completion.type,
            info: completion.info,
            detail: completion.detail
          })))
        ]
      })
    ]);
  }

  // Create extensions for current version
  createExtensions(): Extension[] {
    return [this.createLanguageSupport()];
  }

  // Validate syntax for current version
  validateSyntax(code: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    let isValid = true;

    if (!code.trim()) {
      return { isValid: true, errors: [] };
    }

    // Basic structural validation
    const braceStack: string[] = [];
    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      if (char === '{' || char === '[' || char === '(') {
        braceStack.push(char);
      } else if (char === '}') {
        if (braceStack.length === 0 || braceStack.pop() !== '{') {
          errors.push(`Unmatched '}' at position ${i}`);
          isValid = false;
        }
      } else if (char === ']') {
        if (braceStack.length === 0 || braceStack.pop() !== '[') {
          errors.push(`Unmatched ']' at position ${i}`);
          isValid = false;
        }
      } else if (char === ')') {
        if (braceStack.length === 0 || braceStack.pop() !== '(') {
          errors.push(`Unmatched ')' at position ${i}`);
          isValid = false;
        }
      }
    }

    if (braceStack.length > 0) {
      isValid = false;
      errors.push(`Unmatched '${braceStack[0]}' at the end of the code`);
    }

    return { isValid, errors };
  }
}

// Export convenience functions
export function createCqlLanguageSupport(): LanguageSupport {
  const manager = new CqlGrammarManager();
  return manager.createLanguageSupport();
}

export function createCqlExtensions(): Extension[] {
  const manager = new CqlGrammarManager();
  return manager.createExtensions();
}

export function validateCqlSyntax(code: string): { isValid: boolean; errors: string[] } {
  const manager = new CqlGrammarManager();
  return manager.validateSyntax(code);
}
