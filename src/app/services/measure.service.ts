// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { BaseService } from './base.service';
import { Measure, MeasureReport, Bundle, Parameters, OperationOutcome } from 'fhir/r4';
import { Observable } from 'rxjs';
import { SettingsService } from './settings.service';

/** R4 $evaluate-measure reportType: subject | subject-list | population */
export interface EvaluateMeasureParams {
  periodStart: string;
  periodEnd: string;
  reportType?: 'subject' | 'subject-list' | 'population';
  subject?: string;
  practitioner?: string;
  lastReceivedOn?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MeasureService extends BaseService {
  protected settingsService = inject(SettingsService);

  private getBaseUrl(): string {
    const url = this.settingsService.getEffectiveFhirBaseUrl();
    return url.trim().replace(/\/+$/, '');
  }

  private measurePath(): string {
    return `${this.getBaseUrl()}/Measure`;
  }

  private measureReportPath(): string {
    return `${this.getBaseUrl()}/MeasureReport`;
  }

  searchMeasures(params: {
    name?: string;
    title?: string;
    url?: string;
    status?: string;
    _count?: number;
    _offset?: number;
  } = {}): Observable<Bundle<Measure>> {
    const queryParams = new URLSearchParams();
    if (params.name) queryParams.append('name', params.name);
    if (params.title) queryParams.append('title', params.title);
    if (params.url) queryParams.append('url', params.url);
    if (params.status) queryParams.append('status', params.status);
    if (params._count != null) queryParams.append('_count', String(params._count));
    if (params._offset != null) queryParams.append('_offset', String(params._offset));
    const url = `${this.measurePath()}?${queryParams.toString()}`;
    return this.http.get<Bundle<Measure>>(url, { headers: this.headers() });
  }

  getMeasure(id: string): Observable<Measure> {
    return this.http.get<Measure>(`${this.measurePath()}/${id}`, { headers: this.headers() });
  }

  deleteMeasure(id: string): Observable<void> {
    return this.http.delete<void>(`${this.measurePath()}/${id}`, { headers: this.headers() });
  }

  /**
   * Ensures backbone elements have required ids (e.g. supplementalData) for servers that require them.
   */
  normalizeMeasureForServer(measure: Measure): Measure {
    const m = JSON.parse(JSON.stringify(measure)) as Measure;
    if (m.supplementalData?.length) {
      m.supplementalData = m.supplementalData.map((sd, i) => ({
        ...sd,
        id: sd.id ?? `supplemental-data-${i + 1}`
      }));
    }
    if (m.group?.length) {
      m.group = m.group.map((g, gi) => {
        const group = { ...g, id: g.id ?? `group-${gi + 1}` };
        if (group.population?.length) {
          group.population = group.population.map((p, pi) => ({
            ...p,
            id: p.id ?? `population-${gi + 1}-${pi + 1}`
          }));
        }
        if (group.stratifier?.length) {
          group.stratifier = group.stratifier.map((s, si) => {
            const strat = { ...s, id: s.id ?? `stratifier-${gi + 1}-${si + 1}` };
            if (strat.component?.length) {
              strat.component = strat.component.map((c, ci) => ({
                ...c,
                id: c.id ?? `stratifier-component-${gi + 1}-${si + 1}-${ci + 1}`
              }));
            }
            return strat;
          });
        }
        return group;
      });
    }
    return m;
  }

  createMeasure(measure: Measure): Observable<Measure> {
    const normalized = this.normalizeMeasureForServer(measure);
    return this.http.post<Measure>(this.measurePath(), normalized, { headers: this.headers() });
  }

  putMeasure(measure: Measure): Observable<Measure> {
    const normalized = this.normalizeMeasureForServer(measure);
    return this.http.put<Measure>(`${this.measurePath()}/${measure.id}`, normalized, { headers: this.headers() });
  }

  postTransactionBundle(bundle: Bundle): Observable<Bundle> {
    return this.http.post<Bundle>(this.getBaseUrl(), bundle, { headers: this.headers() });
  }

  searchMeasureReports(params: {
    measure?: string;
    subject?: string;
    status?: string;
    _count?: number;
    _offset?: number;
  } = {}): Observable<Bundle<MeasureReport>> {
    const queryParams = new URLSearchParams();
    if (params.measure) queryParams.append('measure', params.measure);
    if (params.subject) queryParams.append('subject', params.subject);
    if (params.status) queryParams.append('status', params.status);
    if (params._count != null) queryParams.append('_count', String(params._count));
    if (params._offset != null) queryParams.append('_offset', String(params._offset));
    const url = `${this.measureReportPath()}?${queryParams.toString()}`;
    return this.http.get<Bundle<MeasureReport>>(url, { headers: this.headers() });
  }

  getMeasureReport(id: string): Observable<MeasureReport> {
    return this.http.get<MeasureReport>(`${this.measureReportPath()}/${id}`, { headers: this.headers() });
  }

  deleteMeasureReport(id: string): Observable<void> {
    return this.http.delete<void>(`${this.measureReportPath()}/${id}`, { headers: this.headers() });
  }

  evaluateMeasure(measureId: string, params: EvaluateMeasureParams): Observable<MeasureReport> {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: [
        { name: 'periodStart', valueDate: params.periodStart },
        { name: 'periodEnd', valueDate: params.periodEnd }
      ]
    };
    if (params.reportType) {
      parameters.parameter!.push({ name: 'reportType', valueCode: params.reportType });
    }
    if (params.subject) {
      parameters.parameter!.push({ name: 'subject', valueString: params.subject });
    }
    if (params.practitioner) {
      parameters.parameter!.push({ name: 'practitioner', valueString: params.practitioner });
    }
    if (params.lastReceivedOn) {
      parameters.parameter!.push({ name: 'lastReceivedOn', valueDateTime: params.lastReceivedOn });
    }
    const url = `${this.measurePath()}/${measureId}/$evaluate-measure`;
    return this.http.post<MeasureReport>(url, parameters, { headers: this.headers() });
  }

  /**
   * Runs the FHIR $validate operation on the Measure.
   * POST [base]/Measure/$validate with Parameters { resource, mode? }.
   */
  validateMeasure(measure: Measure, mode?: 'create' | 'update'): Observable<OperationOutcome> {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: [{ name: 'resource', resource: this.normalizeMeasureForServer(measure) }]
    };
    if (mode) {
      parameters.parameter!.push({ name: 'mode', valueCode: mode });
    }
    const url = `${this.measurePath()}/$validate`;
    return this.http.post<OperationOutcome>(url, parameters, { headers: this.headers() });
  }

  evaluateMeasureByUrl(measureUrl: string, params: EvaluateMeasureParams): Observable<MeasureReport> {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: [
        { name: 'periodStart', valueDate: params.periodStart },
        { name: 'periodEnd', valueDate: params.periodEnd },
        { name: 'measure', valueCanonical: measureUrl }
      ]
    };
    if (params.reportType) {
      parameters.parameter!.push({ name: 'reportType', valueCode: params.reportType });
    }
    if (params.subject) {
      parameters.parameter!.push({ name: 'subject', valueString: params.subject });
    }
    if (params.practitioner) {
      parameters.parameter!.push({ name: 'practitioner', valueString: params.practitioner });
    }
    if (params.lastReceivedOn) {
      parameters.parameter!.push({ name: 'lastReceivedOn', valueDateTime: params.lastReceivedOn });
    }
    const url = `${this.measurePath()}/$evaluate-measure`;
    return this.http.post<MeasureReport>(url, parameters, { headers: this.headers() });
  }
}
