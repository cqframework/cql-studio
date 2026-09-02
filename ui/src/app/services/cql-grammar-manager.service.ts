// Author: Preston Lee

import { LanguageSupport } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { completeFromList, autocompletion, CompletionSource } from '@codemirror/autocomplete';
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
    string: /^'(?:[^\\']|\\.)*?(?:'|$)/,
    number: /^\d+\.?\d*L?/,
    datetime: /^@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/,
    identifier: /^[a-zA-Z_][a-zA-Z0-9_]*/
  }
};

function alternationPattern(words: string[]): RegExp {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^(?:${escaped.join('|')})\\b`);
}

const COMPILED_PATTERNS = {
  keyword: alternationPattern(CQL_GRAMMAR.keywords),
  function: alternationPattern(CQL_GRAMMAR.functions),
  typeName: alternationPattern(CQL_GRAMMAR.dataTypes),
  operator: /^[+\-*/=<>!&|]+/,
  bracket: /^[{}[\]()]/,
  punctuation: /^[;,.:]/,
  blockCommentEnd: /^\*\//,
};

const TOKEN_TABLE = {
  keyword: tags.keyword,
  string: tags.string,
  comment: tags.comment,
  number: tags.number,
  function: tags.function(tags.variableName),
  typeName: tags.typeName,
  operator: tags.operator,
  bracket: tags.bracket,
  punctuation: tags.punctuation,
  variableName: tags.variableName,
};

// Grammar Manager Service
export class CqlGrammarManager {
  private readonly currentGrammar: CqlGrammarDefinition;

  constructor() {
    this.currentGrammar = CQL_GRAMMAR;
  }

  getCurrentVersion(): CqlVersion {
    return '1.5.3';
  }

  getCurrentGrammar(): CqlGrammarDefinition {
    return this.currentGrammar;
  }

  createLanguageSupport(extraCompletionSources: CompletionSource[] = []): LanguageSupport {
    const grammar = this.currentGrammar;

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

    const language = StreamLanguage.define({
      name: `cql-${grammar.version}`,
      tokenTable: TOKEN_TABLE,
      languageData: {
        commentTokens: {
          line: '//',
          block: { open: '/*', close: '*/' }
        }
      },
      token: (stream) => {
        if (stream.eatSpace()) {
          return null;
        }

        if (stream.match('//')) {
          stream.skipToEnd();
          return 'comment';
        }

        if (stream.match('/*')) {
          while (!stream.eol()) {
            if (stream.match(COMPILED_PATTERNS.blockCommentEnd)) {
              break;
            }
            stream.next();
          }
          return 'comment';
        }

        if (stream.match(grammar.patterns.string)) {
          return 'string';
        }

        if (stream.match(grammar.patterns.number)) {
          return 'number';
        }

        if (stream.match(grammar.patterns.datetime)) {
          return 'string';
        }

        if (stream.match(COMPILED_PATTERNS.keyword)) {
          return 'keyword';
        }

        if (stream.match(COMPILED_PATTERNS.function)) {
          return 'function';
        }

        if (stream.match(COMPILED_PATTERNS.typeName)) {
          return 'typeName';
        }

        if (stream.match(COMPILED_PATTERNS.operator)) {
          return 'operator';
        }

        if (stream.match(COMPILED_PATTERNS.bracket)) {
          return 'bracket';
        }

        if (stream.match(COMPILED_PATTERNS.punctuation)) {
          return 'punctuation';
        }

        if (stream.match(grammar.patterns.identifier)) {
          return 'variableName';
        }

        stream.next();
        return null;
      }
    });

    return new LanguageSupport(language, [
      indentOnInput(),
      autocompletion({
        override: [
          completeFromList(completions.map(completion => ({
            label: completion.label,
            type: completion.type,
            info: completion.info,
            detail: completion.detail
          }))),
          ...extraCompletionSources
        ]
      })
    ]);
  }

  createExtensions(extraCompletionSources: CompletionSource[] = []): Extension[] {
    return [this.createLanguageSupport(extraCompletionSources)];
  }
}
