// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { BaseService } from './base.service';
import { Group, Bundle } from 'fhir/r4';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SettingsService } from './settings.service';
import { buildHttpHeaders } from './endpoint-config.lib';

@Injectable({
	providedIn: 'root'
})
export class GroupService extends BaseService {

	public static readonly GROUP_PATH = '/Group';

	public selectedGroups: Group[] = [];

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
		return baseUrl + GroupService.GROUP_PATH;
	}

	urlFor(id: string) {
		const baseUrl = this.settingsService.getEffectiveDataEndpointAddress();
		return baseUrl + '/Group/' + id;
	}

	search(searchTerm: string): Observable<Bundle> {
		const term = searchTerm.trim();
		const params = new URLSearchParams();
		params.set('actual', 'true');
		params.set('type', 'person');
		params.set('_count', '100');
		return this.http.get<Bundle>(
			`${this.url()}?${params.toString()}`,
			{ headers: this.headersForDataEndpoint() }
		).pipe(
			map(bundle => (term ? this.filterBundleBySearchTerm(bundle, term) : bundle))
		);
	}

	private filterBundleBySearchTerm(bundle: Bundle, term: string): Bundle {
		const needle = term.toLowerCase();
		const entries = (bundle.entry ?? []).filter(entry => {
			const resource = entry.resource;
			if (resource?.resourceType !== 'Group') {
				return false;
			}
			const group = resource as Group;
			if (group.id?.toLowerCase().includes(needle)) {
				return true;
			}
			if (group.name?.toLowerCase().includes(needle)) {
				return true;
			}
			return (group.identifier ?? []).some(identifier => identifier.value?.toLowerCase().includes(needle));
		});
		return {
			...bundle,
			entry: entries,
			total: entries.length
		};
	}

	get(id: string) {
		return this.http.get<Group>(this.urlFor(id), { headers: this.headersForDataEndpoint() });
	}

	clearSelection() {
		this.selectedGroups = [];
	}

	addGroup(group: Group): void {
		if (!group.id || group.actual !== true) {
			return;
		}
		if (!this.selectedGroups.find(g => g.id === group.id)) {
			this.selectedGroups.push(group);
		}
	}

	removeGroup(groupId: string): void {
		this.selectedGroups = this.selectedGroups.filter(g => g.id !== groupId);
	}

	hasGroup(groupId: string): boolean {
		return this.selectedGroups.some(g => g.id === groupId);
	}

	get selectedGroup(): Group | null {
		return this.selectedGroups.length > 0 ? this.selectedGroups[0] : null;
	}

	getDisplayName(group: Group): string {
		if (group.name?.trim()) {
			return group.name.trim();
		}
		if (group.identifier && group.identifier.length > 0 && group.identifier[0].value) {
			return group.identifier[0].value;
		}
		return group.id || 'Unknown';
	}
}
