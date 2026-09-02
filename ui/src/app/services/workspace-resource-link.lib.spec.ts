// Author: Preston Lee

import { Resource } from 'fhir/r4';
import {
  WORKSPACE_RESOURCE_ALREADY_EXISTS,
  displayNameFromFhirResource,
  isWorkspaceResourceAlreadyExistsError,
  summarizeWorkspaceResourceLinks,
  workspaceLinkInputFromFhirResource,
} from './workspace-resource-link.lib';

describe('workspace-resource-link.lib', () => {
  it('detects already-exists errors by message', () => {
    expect(isWorkspaceResourceAlreadyExistsError(new Error(WORKSPACE_RESOURCE_ALREADY_EXISTS))).toBe(
      true
    );
    expect(isWorkspaceResourceAlreadyExistsError(new Error('Forbidden'))).toBe(false);
  });

  it('builds link input only when type and id exist', () => {
    expect(
      workspaceLinkInputFromFhirResource({
        resourceType: 'Library',
        id: 'lipid',
        url: 'http://example.org/Library/lipid',
        title: 'Lipid',
      } as Resource)
    ).toEqual({
      resourceType: 'Library',
      resourceId: 'lipid',
      canonicalUrl: 'http://example.org/Library/lipid',
      displayName: 'Lipid',
    });
    expect(workspaceLinkInputFromFhirResource({ resourceType: 'Library' } as Resource)).toBeNull();
  });

  it('prefers name then title for display name', () => {
    expect(
      displayNameFromFhirResource({
        resourceType: 'ValueSet',
        id: 'vs1',
        name: 'MyVs',
        title: 'Title',
      } as Resource)
    ).toBe('MyVs');
    expect(
      displayNameFromFhirResource({
        resourceType: 'ValueSet',
        id: 'vs1',
        title: 'Title',
      } as Resource)
    ).toBe('Title');
  });

  it('summarizes link stats', () => {
    expect(
      summarizeWorkspaceResourceLinks({
        attempted: 3,
        created: 1,
        alreadyLinked: 1,
        failed: 1,
      }).message
    ).toContain('linked 1');
    expect(
      summarizeWorkspaceResourceLinks({
        attempted: 0,
        created: 0,
        alreadyLinked: 0,
        failed: 0,
      }).message
    ).toBe('');
  });
});
