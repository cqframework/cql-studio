// Author: Preston Lee

import { CQLTestConfiguration, CqlTestTargetRef } from '../../services/runner.service';

export function parsePrefillOnlyListItems(items: unknown[]): CqlTestTargetRef[] {
  const seen = new Set<string>();
  const out: CqlTestTargetRef[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const o = item as Record<string, unknown>;
    const testsName = o['testsName'];
    const groupName = o['groupName'];
    const testName = o['testName'];
    if (
      typeof testsName !== 'string' ||
      typeof groupName !== 'string' ||
      typeof testName !== 'string'
    ) {
      continue;
    }
    const dedupeKey = `${testsName}\0${groupName}\0${testName}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    out.push({
      testsName,
      groupName,
      testName
    });
  }
  return out;
}

/** Ensures optional Tests.OnlyList and required SkipList are arrays after loading JSON. */
export function normalizeLoadedConfiguration(data: CQLTestConfiguration): CQLTestConfiguration {
  if (!data.Tests) {
    return data;
  }
  return {
    ...data,
    Tests: {
      ...data.Tests,
      SkipList: Array.isArray(data.Tests.SkipList) ? data.Tests.SkipList : [],
      OnlyList: Array.isArray(data.Tests.OnlyList) ? data.Tests.OnlyList : []
    }
  };
}

export function isValidConfiguration(data: any): boolean {
  try {
    return (
      data &&
      typeof data === 'object' &&
      data.FhirServer &&
      typeof data.FhirServer.BaseUrl === 'string' &&
      typeof data.FhirServer.CqlOperation === 'string' &&
      data.Build &&
      typeof data.Build.CqlFileVersion === 'string' &&
      typeof data.Build.CqlOutputPath === 'string' &&
      data.Debug &&
      typeof data.Debug.QuickTest === 'boolean' &&
      data.Tests &&
      typeof data.Tests.ResultsPath === 'string' &&
      Array.isArray(data.Tests.SkipList) &&
      (!('OnlyList' in data.Tests) || Array.isArray(data.Tests.OnlyList))
    );
  } catch {
    return false;
  }
}
