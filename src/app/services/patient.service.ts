// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { BaseService } from './base.service';
import { Patient, Bundle, Parameters } from 'fhir/r4';
import { Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { SettingsService } from './settings.service';

@Injectable({
	providedIn: 'root'
})
export class PatientService extends BaseService {

	public static readonly PATIENT_PATH = '/Patient';

	public selectedPatients: Patient[] = [];

	protected settingsService = inject(SettingsService);

	url(): string {
		const baseUrl = this.settingsService.getEffectiveFhirBaseUrl();
		return baseUrl + PatientService.PATIENT_PATH;
	}

	urlFor(id: string) {
		const baseUrl = this.settingsService.getEffectiveFhirBaseUrl();
		return baseUrl + '/Patient/' + id;
	}

	search(searchTerm: string): Observable<Bundle<Patient>> {
		const encoded = encodeURIComponent(searchTerm);
		return this.http.get<Bundle<Patient>>(this.url() + "?name:contains=" + encoded, { headers: this.headers() });
	}

	get(id: string) {
		return this.http.get<Patient>(this.urlFor(id), { headers: this.headers() });
	}

	post(patient: Patient) {
		return this.http.post<Patient>(this.url(), JSON.stringify(patient), { headers: this.headers() });
	}

	put(patient: Patient) {
		return this.http.put<Patient>(this.urlFor(patient.id!), JSON.stringify(patient), { headers: this.headers() });
	}

	delete(patient: Patient) {
		return this.http.delete<Patient>(this.urlFor(patient.id!), { headers: this.headers() });
	}

	clearSelection() {
		this.selectedPatients = [];
	}

	addPatient(patient: Patient): void {
		if (patient.id && !this.selectedPatients.find(p => p.id === patient.id)) {
			this.selectedPatients.push(patient);
		}
	}

	removePatient(patientId: string): void {
		this.selectedPatients = this.selectedPatients.filter(p => p.id !== patientId);
	}

	hasPatient(patientId: string): boolean {
		return this.selectedPatients.some(p => p.id === patientId);
	}

	get selectedPatient(): Patient | null {
		return this.selectedPatients.length > 0 ? this.selectedPatients[0] : null;
	}
}
