// Author: Preston Lee

import { Injectable, inject, signal, computed } from '@angular/core';
import { IdeContextType, IdeExecutionSubject } from '../models/ide-context.model';
import { PatientService } from './patient.service';
import { GroupService } from './group.service';

@Injectable({
	providedIn: 'root'
})
export class IdeContextService {
	private readonly patientService = inject(PatientService);
	private readonly groupService = inject(GroupService);

	private readonly _contextType = signal<IdeContextType>('Patient');
	private readonly _selectionVersion = signal(0);

	readonly contextType = this._contextType.asReadonly();
	readonly selectionVersion = this._selectionVersion.asReadonly();

	readonly selectedCount = computed(() => {
		this._selectionVersion();
		return this.getSelectedSubjects().length;
	});

	readonly hasSelection = computed(() => this.selectedCount() > 0);

	notifySelectionChanged(): void {
		this._selectionVersion.update(version => version + 1);
	}

	setContextType(type: IdeContextType): void {
		if (type === this._contextType()) {
			return;
		}
		if (type === 'Patient') {
			this.groupService.clearSelection();
		} else {
			this.patientService.clearSelection();
		}
		this._contextType.set(type);
		this.notifySelectionChanged();
	}

	getSelectedSubjects(): IdeExecutionSubject[] {
		if (this._contextType() === 'Group') {
			return this.groupService.selectedGroups
				.filter(group => group.id)
				.map(group => ({
					reference: `Group/${group.id}`,
					id: group.id!,
					display: this.groupService.getDisplayName(group)
				}));
		}
		return this.patientService.selectedPatients
			.filter(patient => patient.id)
			.map(patient => ({
				reference: `Patient/${patient.id}`,
				id: patient.id!,
				display: this.patientService.getDisplayName(patient)
			}));
	}

	getSubjectDisplayById(): Map<string, string> {
		const map = new Map<string, string>();
		for (const subject of this.getSelectedSubjects()) {
			map.set(subject.id, subject.display);
		}
		return map;
	}

	clearAllSelections(): void {
		this.patientService.clearSelection();
		this.groupService.clearSelection();
		this._contextType.set('Patient');
		this.notifySelectionChanged();
	}
}
