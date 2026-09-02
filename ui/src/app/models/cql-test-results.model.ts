// Author: Preston Lee

export interface CqlEngine {
  apiUrl: string;
  description: string;
  cqlVersion: string;
  cqlTranslator: string;
  cqlTranslatorVersion: string;
  cqlEngine: string;
  cqlEngineVersion: string;
}

export interface TestResultsSummary {
  passCount: number;
  skipCount: number;
  failCount: number;
  errorCount: number;
}

export interface TestError {
  message: string;
  name?: string;
  stack?: string;
}

export interface Capability {
  code: string;
  value?: boolean | string | number | object | any[];
  system?: string;
  display?: string;
  version?: string;
}

export interface TestResult {
  testStatus: 'pass' | 'fail' | 'skip' | 'error';
  responseStatus?: number;
  actual?: string;
  expected?: string;
  error?: TestError;
  testsName: string;
  groupName: string;
  testName: string;
  invalid?: 'true' | 'false' | 'semantic';
  capabilities?: Capability[];
  expression: string;
}

export interface CqlTestResults {
  cqlengine: CqlEngine;
  testResultsSummary: TestResultsSummary;
  testsRunDateTime: string;
  testsRunDescription?: string;
  results: TestResult[];
}
