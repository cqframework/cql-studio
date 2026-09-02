// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { BaseService } from './base.service';
import { Patient, Bundle, Parameters } from 'fhir/r4';
import { Observable } from 'rxjs';
import { SettingsService } from './settings.service';
import { buildHttpHeaders } from './endpoint-config.lib';

@Injectable({
	providedIn: 'root'
})
export class PatientService extends BaseService {

	public static readonly PATIENT_PATH = '/Patient';

	public selectedPatients: Patient[] = [];

	protected settingsService = inject(SettingsService);

	private headersForDataEndpoint() {
		const ctx = this.settingsService.getEndpointHttpContext('data', {
			'Content-Type': 'application/fhir+json',
			Accept: 'application/fhir+json'
		});
		return buildHttpHeaders(
			{ ...this.settingsService.getActiveEnvironment().dataEndpoint, address: ctx.address },
			ctx.headers
		);
	}

	url(): string {
		const baseUrl = this.settingsService.getEffectiveDataEndpointAddress();
		return baseUrl + PatientService.PATIENT_PATH;
	}

	urlFor(id: string) {
		const baseUrl = this.settingsService.getEffectiveDataEndpointAddress();
		return baseUrl + '/Patient/' + id;
	}

  search(searchTerm: string, page = 1, pageSize = 20): Observable<Bundle> {
    const encoded = encodeURIComponent(searchTerm);
    const count = Math.max(1, pageSize);
    const offset = Math.max(0, (page - 1) * count);
    return this.http.get<Bundle>(
      `${this.url()}?name:contains=${encoded}&_count=${count}&_offset=${offset}`,
      { headers: this.headersForDataEndpoint() }
    );
  }

	get(id: string) {
		return this.http.get<Patient>(this.urlFor(id), { headers: this.headersForDataEndpoint() });
	}

	getEverything(id: string, options?: { types?: string[] }): Observable<Bundle> {
		let url = `${this.urlFor(id)}/$everything`;
		const types = (options?.types ?? []).filter(t => t.trim() && t !== 'Patient');
		if (types.length > 0) {
			url += `?_type=${encodeURIComponent(types.join(','))}`;
		}
		return this.http.get<Bundle>(url, { headers: this.headersForDataEndpoint() });
	}

	post(patient: Patient) {
		return this.http.post<Patient>(this.url(), JSON.stringify(patient), { headers: this.headersForDataEndpoint() });
	}

	put(patient: Patient) {
		return this.http.put<Patient>(this.urlFor(patient.id!), JSON.stringify(patient), { headers: this.headersForDataEndpoint() });
	}

	delete(patient: Patient) {
		return this.http.delete<Patient>(this.urlFor(patient.id!), { headers: this.headersForDataEndpoint() });
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

	getDisplayName(patient: Patient): string {
		if (patient.name && patient.name.length > 0) {
			const name = patient.name[0];
			const given = name.given ? name.given.join(' ') : '';
			const family = name.family || '';
			const result = `${given} ${family}`.trim();
			if (result) {
				return result;
			}
		}

		if (patient.text?.div) {
			const textMatch = patient.text.div.match(/<div[^>]*>([^<]+)<\/div>/);
			if (textMatch?.[1]) {
				return textMatch[1].trim();
			}
		}

		if (patient.identifier && patient.identifier.length > 0 && patient.identifier[0].value) {
			return patient.identifier[0].value;
		}

		return patient.id || 'Unknown';
	}
}
