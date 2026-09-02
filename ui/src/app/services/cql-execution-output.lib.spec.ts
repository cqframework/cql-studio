// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  buildSeparateExecutionOutputSections,
  normalizeExecutionResults,
  shouldRenderExecutionResultsSeparately
} from './cql-execution-output.lib';
import { IdeExecutionSubject } from '../models/ide-context.model';

describe('cql-execution-output.lib', () => {
  it('flattens nested execution result arrays', () => {
    const results = normalizeExecutionResults([
      [{ subjectId: 'p1', libraryName: 'Lib', executionTime: 1 }],
      [{ subjectId: 'p2', libraryName: 'Lib', executionTime: 2 }]
    ]);

    expect(results).toHaveLength(2);
    expect(results.map(r => r.subjectId)).toEqual(['p1', 'p2']);
  });

  it('uses subjects to decide separate rendering when metadata is missing', () => {
    const results = normalizeExecutionResults([
      { libraryName: 'Lib', executionTime: 10, result: { a: 1 } },
      { libraryName: 'Lib', executionTime: 20, result: { a: 2 } }
    ]);
    const subjects: IdeExecutionSubject[] = [
      { reference: 'Patient/p1', id: 'p1', display: 'Pat 1' },
      { reference: 'Patient/p2', id: 'p2', display: 'Pat 2' }
    ];

    expect(shouldRenderExecutionResultsSeparately(results, subjects)).toBe(true);
  });

  it('builds one output section per result with subject labels from context', () => {
    const results = normalizeExecutionResults([
      { libraryName: 'Lib', executionTime: 10, result: { a: 1 } },
      { libraryName: 'Lib', executionTime: 20, result: { a: 2 } }
    ]);
    const subjects: IdeExecutionSubject[] = [
      { reference: 'Patient/p1', id: 'p1', display: 'Alice Example' },
      { reference: 'Group/g2', id: 'g2', display: 'Cohort B' }
    ];
    const subjectDisplayById = new Map([
      ['p1', 'Alice Example'],
      ['g2', 'Cohort B']
    ]);

    const sections = buildSeparateExecutionOutputSections(
      results,
      'Library: Lib',
      subjects,
      subjectDisplayById,
      index => `section-${index}`
    );

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Library: Lib - Alice Example');
    expect(sections[1].title).toBe('Library: Lib - Cohort B');
    expect(JSON.parse(sections[0].content).subjectReference).toBe('Patient/p1');
    expect(JSON.parse(sections[1].content).subjectReference).toBe('Group/g2');
  });
});
