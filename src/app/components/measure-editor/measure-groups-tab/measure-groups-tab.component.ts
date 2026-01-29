// Author: Preston Lee

import { Component, input, output, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Measure, CodeableConcept, Coding, MeasureGroup, MeasureGroupPopulation, MeasureGroupStratifier, MeasureSupplementalData, Expression } from 'fhir/r4';
import { ClipboardService } from '../../../services/clipboard.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-measure-groups-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './measure-groups-tab.component.html',
  styleUrl: './measure-groups-tab.component.scss'
})
export class MeasureGroupsTabComponent {
  measure = input<Measure | null>(null);
  measureChange = output<Measure>();

  private clipboardService = inject(ClipboardService);
  private toastService = inject(ToastService);

  protected readonly groups = computed(() => this.measure()?.group ?? []);
  protected readonly supplementalData = computed(() => this.measure()?.supplementalData ?? []);

  protected patchMeasure(partial: Partial<Measure>): void {
    const m = this.measure();
    if (!m) return;
    this.measureChange.emit({ ...m, ...partial } as Measure);
  }

  protected patchGroup(groupIndex: number, partial: Partial<MeasureGroup>): void {
    const m = this.measure();
    if (!m?.group?.length || groupIndex < 0 || groupIndex >= m.group.length) return;
    const next = [...m.group];
    next[groupIndex] = { ...next[groupIndex], ...partial };
    this.measureChange.emit({ ...m, group: next });
  }

  protected patchPopulation(groupIndex: number, popIndex: number, partial: Partial<MeasureGroupPopulation>): void {
    const m = this.measure();
    const group = m?.group?.[groupIndex];
    if (!group?.population?.length || popIndex < 0 || popIndex >= group.population.length) return;
    const nextPop = [...group.population];
    nextPop[popIndex] = { ...nextPop[popIndex], ...partial };
    const nextGroups = [...(m!.group ?? [])];
    nextGroups[groupIndex] = { ...group, population: nextPop };
    this.measureChange.emit({ ...m!, group: nextGroups });
  }

  protected patchStratifier(groupIndex: number, stratIndex: number, partial: Partial<MeasureGroupStratifier>): void {
    const m = this.measure();
    const group = m?.group?.[groupIndex];
    if (!group?.stratifier?.length || stratIndex < 0 || stratIndex >= group.stratifier.length) return;
    const nextStrat = [...group.stratifier];
    nextStrat[stratIndex] = { ...nextStrat[stratIndex], ...partial };
    const nextGroups = [...(m!.group ?? [])];
    nextGroups[groupIndex] = { ...group, stratifier: nextStrat };
    this.measureChange.emit({ ...m!, group: nextGroups });
  }

  protected patchStratifierComponent(
    groupIndex: number,
    stratIndex: number,
    compIndex: number,
    partial: { description?: string; criteria?: { expression?: string; language?: string } }
  ): void {
    const m = this.measure();
    const group = m?.group?.[groupIndex];
    const strat = group?.stratifier?.[stratIndex];
    if (!strat?.component?.length || compIndex < 0 || compIndex >= strat.component.length) return;
    const nextComp = [...strat.component];
    const current = nextComp[compIndex];
    const merged: typeof current = { ...current };
    if (partial.description !== undefined) merged.description = partial.description;
    if (partial.criteria !== undefined) {
      merged.criteria = {
        expression: partial.criteria.expression ?? current.criteria?.expression,
        language: partial.criteria.language ?? current.criteria?.language ?? 'text/cql'
      };
    }
    nextComp[compIndex] = merged;
    const nextStrat = [...(group!.stratifier ?? [])];
    nextStrat[stratIndex] = { ...strat, component: nextComp };
    const nextGroups = [...(m!.group ?? [])];
    nextGroups[groupIndex] = { ...group!, stratifier: nextStrat };
    this.measureChange.emit({ ...m!, group: nextGroups });
  }

  protected patchSupplementalData(sdIndex: number, partial: Partial<MeasureSupplementalData>): void {
    const m = this.measure();
    if (!m?.supplementalData?.length || sdIndex < 0 || sdIndex >= m.supplementalData.length) return;
    const next = [...m.supplementalData];
    next[sdIndex] = { ...next[sdIndex], ...partial };
    this.measureChange.emit({ ...m, supplementalData: next });
  }

  protected addGroup(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.group ?? []), { population: [], stratifier: [] }];
    this.measureChange.emit({ ...m, group: next });
  }

  protected removeGroup(groupIndex: number): void {
    const m = this.measure();
    if (!m?.group?.length || groupIndex < 0 || groupIndex >= m.group.length) return;
    const next = m.group.filter((_, i) => i !== groupIndex);
    this.measureChange.emit({ ...m, group: next.length ? next : undefined });
  }

  protected addPopulation(groupIndex: number): void {
    const m = this.measure();
    const group = m?.group?.[groupIndex];
    if (!m || !group) return;
    const newPop: MeasureGroupPopulation = {
      code: {},
      criteria: { language: 'text/cql', expression: '' }
    };
    const nextPop = [...(group.population ?? []), newPop];
    const nextGroups = [...(m.group ?? [])];
    nextGroups[groupIndex] = { ...group, population: nextPop };
    this.measureChange.emit({ ...m, group: nextGroups });
  }

  protected removePopulation(groupIndex: number, popIndex: number): void {
    const m = this.measure();
    const group = m?.group?.[groupIndex];
    if (!group?.population?.length || popIndex < 0 || popIndex >= group.population.length) return;
    const nextPop = group.population.filter((_, i) => i !== popIndex);
    const nextGroups = [...(m!.group ?? [])];
    nextGroups[groupIndex] = { ...group, population: nextPop.length ? nextPop : undefined };
    this.measureChange.emit({ ...m!, group: nextGroups });
  }

  protected addStratifier(groupIndex: number): void {
    const m = this.measure();
    const group = m?.group?.[groupIndex];
    if (!m || !group) return;
    const newStrat: MeasureGroupStratifier = {
      code: { text: '' },
      criteria: { language: 'text/cql', expression: '' }
    };
    const nextStrat = [...(group.stratifier ?? []), newStrat];
    const nextGroups = [...(m.group ?? [])];
    nextGroups[groupIndex] = { ...group, stratifier: nextStrat };
    this.measureChange.emit({ ...m, group: nextGroups });
  }

  protected removeStratifier(groupIndex: number, stratIndex: number): void {
    const m = this.measure();
    const group = m?.group?.[groupIndex];
    if (!group?.stratifier?.length || stratIndex < 0 || stratIndex >= group.stratifier.length) return;
    const nextStrat = group.stratifier.filter((_, i) => i !== stratIndex);
    const nextGroups = [...(m!.group ?? [])];
    nextGroups[groupIndex] = { ...group, stratifier: nextStrat.length ? nextStrat : undefined };
    this.measureChange.emit({ ...m!, group: nextGroups });
  }

  protected addStratifierComponent(groupIndex: number, stratIndex: number): void {
    const m = this.measure();
    const group = m?.group?.[groupIndex];
    const strat = group?.stratifier?.[stratIndex];
    if (!m || !group || !strat) return;
    const newComp = {
      code: { text: '' as string },
      criteria: { language: 'text/cql' as const, expression: '' }
    };
    const nextComp = [...(strat.component ?? []), newComp];
    const nextStrat = [...(group.stratifier ?? [])];
    nextStrat[stratIndex] = { ...strat, component: nextComp };
    const nextGroups = [...(m.group ?? [])];
    nextGroups[groupIndex] = { ...group, stratifier: nextStrat };
    this.measureChange.emit({ ...m, group: nextGroups });
  }

  protected removeStratifierComponent(groupIndex: number, stratIndex: number, compIndex: number): void {
    const m = this.measure();
    const group = m?.group?.[groupIndex];
    const strat = group?.stratifier?.[stratIndex];
    if (!strat?.component?.length || compIndex < 0 || compIndex >= strat.component.length) return;
    const nextComp = strat.component.filter((_, i) => i !== compIndex);
    const nextStrat = [...(group!.stratifier ?? [])];
    nextStrat[stratIndex] = { ...strat, component: nextComp.length ? nextComp : undefined };
    const nextGroups = [...(m!.group ?? [])];
    nextGroups[groupIndex] = { ...group!, stratifier: nextStrat };
    this.measureChange.emit({ ...m!, group: nextGroups });
  }

  protected addSupplementalData(): void {
    const m = this.measure();
    if (!m) return;
    const newSd: MeasureSupplementalData = {
      code: { text: '' },
      criteria: { language: 'text/cql', expression: '' }
    };
    const next = [...(m.supplementalData ?? []), newSd];
    this.measureChange.emit({ ...m, supplementalData: next });
  }

  protected removeSupplementalData(sdIndex: number): void {
    const m = this.measure();
    if (!m?.supplementalData?.length || sdIndex < 0 || sdIndex >= m.supplementalData.length) return;
    const next = m.supplementalData.filter((_, i) => i !== sdIndex);
    this.measureChange.emit({ ...m, supplementalData: next.length ? next : undefined });
  }

  private toExpression(existing: Expression | undefined, expression: string): Expression {
    return {
      expression: expression || (existing?.expression ?? ''),
      language: existing?.language ?? 'text/cql'
    };
  }

  protected setPopulationCriteriaExpression(groupIndex: number, popIndex: number, expression: string): void {
    const group = this.measure()?.group?.[groupIndex];
    const pop = group?.population?.[popIndex];
    if (!pop) return;
    this.patchPopulation(groupIndex, popIndex, {
      criteria: this.toExpression(pop.criteria, expression)
    });
  }

  protected setStratifierCriteriaExpression(groupIndex: number, stratIndex: number, expression: string): void {
    const group = this.measure()?.group?.[groupIndex];
    const strat = group?.stratifier?.[stratIndex];
    if (!strat) return;
    this.patchStratifier(groupIndex, stratIndex, {
      criteria: this.toExpression(strat.criteria, expression)
    });
  }

  protected setSupplementalDataCriteriaExpression(sdIndex: number, expression: string): void {
    const sd = this.measure()?.supplementalData?.[sdIndex];
    if (!sd) return;
    this.patchSupplementalData(sdIndex, {
      criteria: this.toExpression(sd.criteria, expression)
    });
  }

  protected addCodeableConceptToClipboard(cc: CodeableConcept | undefined): void {
    const coding = cc?.coding?.[0];
    if (!coding?.system && !coding?.code) {
      this.toastService.showWarning('No coding to add.', 'Clipboard');
      return;
    }
    try {
      this.clipboardService.addCoding(coding as Coding);
      this.toastService.showSuccess('Coding added to clipboard.', 'Clipboard Updated');
    } catch (err) {
      console.error('Failed to add Coding to clipboard:', err);
      this.toastService.showError('Failed to add Coding to clipboard.', 'Clipboard Error');
    }
  }

  protected displayCodeableConcept(cc: CodeableConcept | undefined): string {
    const c = cc?.coding?.[0];
    if (!c) return cc?.text ?? '—';
    const joined = [c.system, c.code, c.display].filter(Boolean).join(' | ');
    return joined || (cc?.text ?? '—');
  }

  protected getPopulationCode(pop: { code?: CodeableConcept }): CodeableConcept | undefined {
    return pop.code;
  }

  protected getCriteriaExpression(criteria: { expression?: string } | undefined): string {
    return criteria?.expression ?? '—';
  }

  protected getCriteriaLanguage(criteria: { language?: string } | undefined): string {
    return criteria?.language ?? '—';
  }

  protected displaySupplementalDataUsage(usage: CodeableConcept[] | undefined): string {
    if (!usage?.length) return '—';
    return usage.map(u => this.displayCodeableConcept(u)).join(', ');
  }

  /** FHIR R4 code system URLs for terminology-bound Measure.group/supplementalData fields (measure-definitions.html). */
  private static readonly MEASURE_POPULATION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/measure-population';
  private static readonly MEASURE_DATA_USAGE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/measure-data-usage';

  /** MeasurePopulationType (Extensible) – R4 ValueSet measure-population */
  protected populationTypeOptions: { value: string; label: string }[] = [
    { value: '', label: '(none)' },
    { value: 'initial-population', label: 'Initial Population' },
    { value: 'numerator', label: 'Numerator' },
    { value: 'numerator-exclusion', label: 'Numerator Exclusion' },
    { value: 'denominator', label: 'Denominator' },
    { value: 'denominator-exclusion', label: 'Denominator Exclusion' },
    { value: 'denominator-exception', label: 'Denominator Exception' },
    { value: 'measure-population', label: 'Measure Population' },
    { value: 'measure-population-exclusion', label: 'Measure Population Exclusion' },
    { value: 'measure-observation', label: 'Measure Observation' }
  ];

  /** MeasureDataUsage (Extensible) – R4 ValueSet measure-data-usage */
  protected supplementalDataUsageOptions: { value: string; label: string }[] = [
    { value: '', label: '(none)' },
    { value: 'supplemental-data', label: 'Supplemental Data' },
    { value: 'risk-adjustment-factor', label: 'Risk Adjustment Factor' }
  ];

  protected getPopulationCodeCode(pop: { code?: CodeableConcept }): string {
    return pop.code?.coding?.[0]?.code ?? '';
  }

  protected setPopulationCode(groupIndex: number, popIndex: number, code: string): void {
    const opt = this.populationTypeOptions.find(o => o.value === code);
    const coding = code
      ? { system: MeasureGroupsTabComponent.MEASURE_POPULATION_SYSTEM, code, display: opt?.label }
      : undefined;
    const cc: CodeableConcept = coding ? { coding: [coding] } : {};
    this.patchPopulation(groupIndex, popIndex, { code: cc });
  }

  protected getSupplementalDataUsageCode(sd: MeasureSupplementalData): string {
    const first = sd.usage?.[0];
    return first?.coding?.[0]?.code ?? '';
  }

  protected setSupplementalDataUsageCode(sdIndex: number, code: string): void {
    const m = this.measure();
    if (!m?.supplementalData?.length || sdIndex < 0 || sdIndex >= m.supplementalData.length) return;
    const opt = this.supplementalDataUsageOptions.find(o => o.value === code);
    const coding = code
      ? { system: MeasureGroupsTabComponent.MEASURE_DATA_USAGE_SYSTEM, code, display: opt?.label }
      : undefined;
    const usage: CodeableConcept[] = coding ? [{ coding: [coding] }] : [];
    this.patchSupplementalData(sdIndex, { usage });
  }
}
