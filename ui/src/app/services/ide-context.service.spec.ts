// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { Group, Patient } from 'fhir/r4';
import { IdeContextService } from './ide-context.service';
import { PatientService } from './patient.service';
import { GroupService } from './group.service';

function createIdeContextService() {
  const patientService = Object.create(PatientService.prototype) as PatientService;
  patientService.selectedPatients = [];
  patientService.clearSelection = PatientService.prototype.clearSelection.bind(patientService);
  patientService.addPatient = PatientService.prototype.addPatient.bind(patientService);
  patientService.getDisplayName = PatientService.prototype.getDisplayName.bind(patientService);

  const groupService = Object.create(GroupService.prototype) as GroupService;
  groupService.selectedGroups = [];
  groupService.clearSelection = GroupService.prototype.clearSelection.bind(groupService);
  groupService.addGroup = GroupService.prototype.addGroup.bind(groupService);
  groupService.getDisplayName = GroupService.prototype.getDisplayName.bind(groupService);

  const service = Object.create(IdeContextService.prototype) as IdeContextService;
  (service as unknown as { patientService: PatientService }).patientService = patientService;
  (service as unknown as { groupService: GroupService }).groupService = groupService;
  (service as unknown as { _contextType: ReturnType<typeof signal<'Patient' | 'Group'>> })._contextType = signal<'Patient' | 'Group'>('Patient');
  (service as unknown as { _selectionVersion: ReturnType<typeof signal<number>> })._selectionVersion = signal(0);
  Object.assign(service as object, {
    contextType: (service as unknown as { _contextType: ReturnType<typeof signal<'Patient' | 'Group'>> })._contextType.asReadonly(),
    selectionVersion: (service as unknown as { _selectionVersion: ReturnType<typeof signal<number>> })._selectionVersion.asReadonly(),
    selectedCount: IdeContextService.prototype.selectedCount,
    hasSelection: IdeContextService.prototype.hasSelection,
  });

  return { service, patientService, groupService };
}

describe('IdeContextService', () => {
  it('returns Patient references when in Patient mode', () => {
    const { service, patientService } = createIdeContextService();
    const patient: Patient = { resourceType: 'Patient', id: 'p1', name: [{ family: 'Example', given: ['Pat'] }] };
    patientService.addPatient(patient);
    const subjects = service.getSelectedSubjects();
    expect(subjects).toEqual([{
      reference: 'Patient/p1',
      id: 'p1',
      display: 'Pat Example'
    }]);
  });

  it('returns Group references when in Group mode', () => {
    const { service, groupService } = createIdeContextService();
    service.setContextType('Group');
    const group: Group = { resourceType: 'Group', type: 'person', actual: true, id: 'g1', name: 'Cohort' };
    groupService.addGroup(group);
    const subjects = service.getSelectedSubjects();
    expect(subjects).toEqual([{
      reference: 'Group/g1',
      id: 'g1',
      display: 'Cohort'
    }]);
  });

  it('clears opposite selection when switching context type', () => {
    const { service, patientService, groupService } = createIdeContextService();
    patientService.addPatient({ resourceType: 'Patient', id: 'p1' });
    groupService.addGroup({ resourceType: 'Group', type: 'person', actual: true, id: 'g1', name: 'Cohort' });
    service.setContextType('Group');
    expect(patientService.selectedPatients).toHaveLength(0);
    expect(groupService.selectedGroups).toHaveLength(1);
    service.setContextType('Patient');
    expect(groupService.selectedGroups).toHaveLength(0);
  });

  it('resets to Patient mode on clearAllSelections', () => {
    const { service, groupService } = createIdeContextService();
    service.setContextType('Group');
    groupService.addGroup({ resourceType: 'Group', type: 'person', actual: true, id: 'g1' });
    service.clearAllSelections();
    expect(service.contextType()).toBe('Patient');
    expect(groupService.selectedGroups).toHaveLength(0);
  });
});
