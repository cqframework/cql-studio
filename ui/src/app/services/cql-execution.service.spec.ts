// Author: Preston Lee

import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { Parameters } from 'fhir/r4';
import { CqlExecutionService } from './cql-execution.service';
import { IdeExecutionSubject } from '../models/ide-context.model';
import { testEnvironment } from '../../testing/spec-helpers';

function postBody(httpPost: ReturnType<typeof vi.fn>, index = 0) {
  const call = httpPost.mock.calls[index] as [string, { parameter: { name: string; valueString?: string }[] }] | undefined;
  expect(call).toBeDefined();
  return call![1];
}

function createCqlExecutionService() {
  const httpPost = vi.fn(() => of({ resourceType: 'Parameters', parameter: [] } as Parameters));
  const service = Object.create(CqlExecutionService.prototype) as CqlExecutionService;
  Object.assign(service as object, {
    settingsService: {
      getEffectiveEvaluationServerUrl: () => 'http://localhost/fhir',
      getEndpointHttpContext: () => ({ address: 'http://localhost/fhir', headers: {} }),
      getActiveEnvironment: () => testEnvironment(),
    },
    http: { post: httpPost },
  });
  return { service, httpPost };
}

describe('CqlExecutionService', () => {
  it('posts Group subject reference to Library/$evaluate', () => {
    const { service, httpPost } = createCqlExecutionService();
    const subjects: IdeExecutionSubject[] = [{
      reference: 'Group/g1',
      id: 'g1',
      display: 'Cohort'
    }];

    service.executeLibrary('lib1', subjects, { libraryName: 'Lib' }).subscribe();

    expect(httpPost).toHaveBeenCalledTimes(1);
    const body = postBody(httpPost);
    const subjectParam = body.parameter.find((p: { name: string }) => p.name === 'subject');
    expect(subjectParam?.valueString).toBe('Group/g1');
  });

  it('omits subject when no subjects are provided', () => {
    const { service, httpPost } = createCqlExecutionService();
    service.executeLibrary('lib1').subscribe();
    const body = postBody(httpPost);
    expect(body.parameter.some((p: { name: string }) => p.name === 'subject')).toBe(false);
  });

  it('fans out one request per subject', () => {
    const { service, httpPost } = createCqlExecutionService();
    const subjects: IdeExecutionSubject[] = [
      { reference: 'Patient/p1', id: 'p1', display: 'Pat 1' },
      { reference: 'Patient/p2', id: 'p2', display: 'Pat 2' }
    ];

    service.executeLibrary('lib1', subjects).subscribe(results => {
      expect(results).toHaveLength(2);
    });

    expect(httpPost).toHaveBeenCalledTimes(2);
  });

  it('omits expression when the expressions array is empty', () => {
    const { service, httpPost } = createCqlExecutionService();
    service.executeLibrary('lib1', undefined, { expressions: [] }).subscribe();
    const body = postBody(httpPost);
    expect(body.parameter.some((p: { name: string }) => p.name === 'expression')).toBe(false);
  });

  it('repeats expression parameters for custom evaluation', () => {
    const { service, httpPost } = createCqlExecutionService();
    const subjects: IdeExecutionSubject[] = [
      { reference: 'Patient/p1', id: 'p1', display: 'Pat 1' },
      { reference: 'Patient/p2', id: 'p2', display: 'Pat 2' }
    ];

    service.executeLibrary('lib1', subjects, {
      expressions: ['Foo', 'Encounter Eligibility Results']
    }).subscribe();

    expect(httpPost).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 2; i++) {
      const body = postBody(httpPost, i);
      const expressionValues = body.parameter
        .filter((p: { name: string }) => p.name === 'expression')
        .map(p => p.valueString);
      expect(expressionValues).toEqual(['Foo', 'Encounter Eligibility Results']);
      expect(body.parameter.some((p: { name: string }) => p.name === 'subject')).toBe(true);
    }
  });

  it('sends expression parameters when evaluating without a subject', () => {
    const { service, httpPost } = createCqlExecutionService();
    service.executeLibrary('lib1', undefined, { expressions: ['Foo'] }).subscribe();
    const body = postBody(httpPost);
    const expressionValues = body.parameter
      .filter((p: { name: string }) => p.name === 'expression')
      .map(p => p.valueString);
    expect(expressionValues).toEqual(['Foo']);
    expect(body.parameter.some((p: { name: string }) => p.name === 'subject')).toBe(false);
  });
});
