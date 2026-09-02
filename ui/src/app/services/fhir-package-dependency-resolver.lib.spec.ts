// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  compareResolvedVersions,
  pickResolvedVersion,
  topologicalImportOrder
} from './fhir-package-dependency-resolver.lib';

describe('pickResolvedVersion', () => {
  it('resolves caret ranges', () => {
    const v = pickResolvedVersion(['4.0.0', '4.0.1', '4.1.0'], '^4.0.0');
    expect(v).toBe('4.1.0');
  });

  it('returns exact manifest key when not semver-satisfiable', () => {
    const v = pickResolvedVersion(['4.0.1', 'custom-tag'], 'custom-tag');
    expect(v).toBe('custom-tag');
  });

  it('returns null when nothing matches', () => {
    const v = pickResolvedVersion(['1.0.0'], '^99.0.0');
    expect(v).toBeNull();
  });
});

describe('compareResolvedVersions', () => {
  it('orders semver strings', () => {
    expect(compareResolvedVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareResolvedVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
  });
});

describe('topologicalImportOrder', () => {
  it('orders dependencies before dependents', () => {
    const names = ['root', 'depA', 'depB'];
    const directDeps = (n: string) => {
      if (n === 'root') {
        return ['depA', 'depB'];
      }
      if (n === 'depB') {
        return ['depA'];
      }
      return [];
    };
    const { order, cycleWarnings } = topologicalImportOrder(names, directDeps);
    expect(cycleWarnings.length).toBe(0);
    expect(order.indexOf('depA')).toBeLessThan(order.indexOf('depB'));
    expect(order.indexOf('depB')).toBeLessThan(order.indexOf('root'));
  });

  it('appends remainder when a cycle exists', () => {
    const names = ['a', 'b'];
    const directDeps = (n: string) => (n === 'a' ? ['b'] : ['a']);
    const { order, cycleWarnings } = topologicalImportOrder(names, directDeps);
    expect(cycleWarnings.length).toBe(1);
    expect(order.length).toBe(2);
  });
});
