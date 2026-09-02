// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { BaseService } from './base.service';
import { Measure, MeasureReport, Bundle, Parameters, OperationOutcome } from 'fhir/r4';
import { Observable } from 'rxjs';
import { SettingsService } from './settings.service';
import { buildHttpHeaders } from './endpoint-config.lib';
import { appendEvaluateEndpointParameters } from './cql-evaluate-parameters.lib';

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
    return this.settingsService.getEffectiveEvaluationServerUrl();
  }

  private evaluationHeaders() {
    const ctx = this.settingsService.getEndpointHttpContext('evaluation', {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json'
    });
    return buildHttpHeaders(
      { ...this.settingsService.getActiveEnvironment().evaluationServer, address: ctx.address },
      ctx.headers
    );
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
  } = {}): Observable<Bundle> {
    const queryParams = new URLSearchParams();
    if (params.name) queryParams.append('name', params.name);
    if (params.title) queryParams.append('title', params.title);
    if (params.url) queryParams.append('url', params.url);
    if (params.status) queryParams.append('status', params.status);
    if (params._count != null) queryParams.append('_count', String(params._count));
    if (params._offset != null) queryParams.append('_offset', String(params._offset));
    const url = `${this.measurePath()}?${queryParams.toString()}`;
    return this.http.get<Bundle>(url, { headers: this.evaluationHeaders() });
  }

  getMeasure(id: string): Observable<Measure> {
    return this.http.get<Measure>(`${this.measurePath()}/${id}`, { headers: this.evaluationHeaders() });
  }

  deleteMeasure(id: string): Observable<void> {
    return this.http.delete<void>(`${this.measurePath()}/${id}`, { headers: this.evaluationHeaders() });
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
    return this.http.post<Measure>(this.measurePath(), normalized, { headers: this.evaluationHeaders() });
  }

  putMeasure(measure: Measure): Observable<Measure> {
    const normalized = this.normalizeMeasureForServer(measure);
    return this.http.put<Measure>(`${this.measurePath()}/${measure.id}`, normalized, { headers: this.evaluationHeaders() });
  }

  postTransactionBundle(bundle: Bundle): Observable<Bundle> {
    return this.http.post<Bundle>(this.getBaseUrl(), bundle, { headers: this.evaluationHeaders() });
  }

  searchMeasureReports(params: {
    measure?: string;
    subject?: string;
    status?: string;
    _count?: number;
    _offset?: number;
  } = {}): Observable<Bundle> {
    const queryParams = new URLSearchParams();
    if (params.measure) queryParams.append('measure', params.measure);
    if (params.subject) queryParams.append('subject', params.subject);
    if (params.status) queryParams.append('status', params.status);
    if (params._count != null) queryParams.append('_count', String(params._count));
    if (params._offset != null) queryParams.append('_offset', String(params._offset));
    const url = `${this.measureReportPath()}?${queryParams.toString()}`;
    return this.http.get<Bundle>(url, { headers: this.evaluationHeaders() });
  }

  getMeasureReport(id: string): Observable<MeasureReport> {
    return this.http.get<MeasureReport>(`${this.measureReportPath()}/${id}`, { headers: this.evaluationHeaders() });
  }

  deleteMeasureReport(id: string): Observable<void> {
    return this.http.delete<void>(`${this.measureReportPath()}/${id}`, { headers: this.evaluationHeaders() });
  }

  createMeasureReport(report: MeasureReport): Observable<MeasureReport> {
    return this.http.post<MeasureReport>(this.measureReportPath(), report, { headers: this.evaluationHeaders() });
  }

  putMeasureReport(report: MeasureReport): Observable<MeasureReport> {
    if (!report.id?.trim()) {
      throw new Error('MeasureReport.id is required for update.');
    }
    return this.http.put<MeasureReport>(
      `${this.measureReportPath()}/${report.id}`,
      report,
      { headers: this.evaluationHeaders() },
    );
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
    appendEvaluateEndpointParameters(parameters, this.settingsService.getActiveEnvironment());
    const url = `${this.measurePath()}/${measureId}/$evaluate-measure`;
    return this.http.post<MeasureReport>(url, parameters, { headers: this.evaluationHeaders() });
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
    return this.http.post<OperationOutcome>(url, parameters, { headers: this.evaluationHeaders() });
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
    appendEvaluateEndpointParameters(parameters, this.settingsService.getActiveEnvironment());
    const url = `${this.measurePath()}/$evaluate-measure`;
    return this.http.post<MeasureReport>(url, parameters, { headers: this.evaluationHeaders() });
  }
}
