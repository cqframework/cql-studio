// Author: Preston Lee

import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { Bundle, Group } from 'fhir/r4';
import { GroupService } from './group.service';
import { testEnvironment } from '../../testing/spec-helpers';

function createGroupService() {
  const httpGet = vi.fn(() => of({ resourceType: 'Bundle', type: 'searchset', entry: [] } as Bundle));
  const service = Object.create(GroupService.prototype) as GroupService;
  service.selectedGroups = [];
  Object.assign(service as object, {
    settingsService: {
      getEndpointHttpContext: () => ({ address: 'http://localhost/data', headers: {} }),
      getActiveEnvironment: () => testEnvironment({ dataEndpoint: { address: 'http://localhost/data' } }),
      getEffectiveDataEndpointAddress: () => 'http://localhost/data'
    },
    http: { get: httpGet },
  });
  return { service, httpGet };
}

describe('GroupService', () => {
  it('searches actual person groups using supported HAPI parameters', () => {
    const { service, httpGet } = createGroupService();
    service.search('cohort').subscribe();
    expect(httpGet).toHaveBeenCalledWith(
      'http://localhost/data/Group?actual=true&type=person&_count=100',
      expect.any(Object)
    );
  });

  it('filters returned groups client-side by name, id, or identifier', () => {
    const { service, httpGet } = createGroupService();
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [
        { resource: { resourceType: 'Group', type: 'person', actual: true, id: 'g1', name: 'Female Example Patients' } as Group },
        { resource: { resourceType: 'Group', type: 'person', actual: true, id: 'g2', name: 'Other Cohort' } as Group }
      ]
    };
    httpGet.mockReturnValue(of(bundle));

    let result: Bundle | undefined;
    service.search('female').subscribe(b => { result = b; });

    expect(result?.entry).toHaveLength(1);
    expect((result?.entry?.[0]?.resource as Group).id).toBe('g1');
  });

  it('adds, tracks, and removes actual groups', () => {
    const { service } = createGroupService();
    const group: Group = { resourceType: 'Group', type: 'person', actual: true, id: 'g1', name: 'Cohort A' };
    service.addGroup(group);
    expect(service.hasGroup('g1')).toBe(true);
    expect(service.selectedGroups).toHaveLength(1);
    service.removeGroup('g1');
    expect(service.hasGroup('g1')).toBe(false);
  });

  it('rejects non-actual groups', () => {
    const { service } = createGroupService();
    const group: Group = { resourceType: 'Group', type: 'person', actual: false, id: 'def1', name: 'Definitional' };
    service.addGroup(group);
    expect(service.selectedGroups).toHaveLength(0);
  });

  it('resolves display name from name, identifier, or id', () => {
    const { service } = createGroupService();
    expect(service.getDisplayName({ resourceType: 'Group', type: 'person', actual: true, name: 'My Group' })).toBe('My Group');
    expect(service.getDisplayName({
      resourceType: 'Group',
      type: 'person',
      actual: true,
      identifier: [{ value: 'id-value' }]
    })).toBe('id-value');
    expect(service.getDisplayName({ resourceType: 'Group', type: 'person', actual: true, id: 'g99' })).toBe('g99');
  });
});
