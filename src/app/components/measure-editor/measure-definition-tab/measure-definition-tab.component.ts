// Author: Preston Lee

import { Component, input, output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Measure,
  CodeableConcept,
  Coding,
  Identifier,
  ContactDetail,
  UsageContext,
  RelatedArtifact,
  Period
} from 'fhir/r4';
import { ClipboardService } from '../../../services/clipboard.service';
import { ToastService } from '../../../services/toast.service';

type PasteableField =
  | 'scoring'
  | 'improvementNotation'
  | 'topic'
  | 'compositeScoring'
  | 'jurisdiction'
  | 'subjectCodeableConcept';

@Component({
  selector: 'app-measure-definition-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './measure-definition-tab.component.html',
  styleUrl: './measure-definition-tab.component.scss'
})
export class MeasureDefinitionTabComponent {
  measure = input<Measure | null>(null);
  measureChange = output<Measure>();

  private clipboardService = inject(ClipboardService);
  private toastService = inject(ToastService);

  protected readonly hasMeasure = computed(() => !!this.measure());

  protected patchMeasure(partial: Partial<Measure>): void {
    const m = this.measure();
    if (!m) return;
    const updated = { ...m, ...partial } as Measure;
    this.measureChange.emit(updated);
  }

  protected addMeasureToClipboard(m: Measure | null): void {
    if (!m) return;
    try {
      this.clipboardService.addResource(m);
      this.toastService.showSuccess('Measure added to clipboard.', 'Clipboard Updated');
    } catch (err) {
      console.error('Failed to add Measure to clipboard:', err);
      this.toastService.showError('Failed to add Measure to clipboard.', 'Clipboard Error');
    }
  }

  protected pasteMeasureFromClipboard(): void {
    const items = this.clipboardService.query({ typeFilter: 'Measure' });
    if (items.length === 0) {
      this.toastService.showWarning('No Measure on clipboard.', 'Paste');
      return;
    }
    const item = items[0];
    const payload = item.payload;
    if (payload && typeof payload === 'object' && 'resourceType' in payload && payload.resourceType === 'Measure') {
      this.measureChange.emit(payload as Measure);
      this.toastService.showSuccess('Measure pasted from clipboard.', 'Paste');
    } else {
      this.toastService.showWarning('Clipboard item is not a Measure.', 'Paste');
    }
  }

  protected addCodeableConceptToClipboard(cc: CodeableConcept | undefined): void {
    const coding = this.getFirstCoding(cc);
    if (!coding?.system && !coding?.code) {
      this.toastService.showWarning('No coding with system or code to add.', 'Clipboard');
      return;
    }
    try {
      this.clipboardService.addCoding(coding);
      this.toastService.showSuccess('Coding added to clipboard.', 'Clipboard Updated');
    } catch (err) {
      console.error('Failed to add Coding to clipboard:', err);
      this.toastService.showError('Failed to add Coding to clipboard.', 'Clipboard Error');
    }
  }

  protected pasteJurisdictionFromClipboard(index: number): void {
    const cc = this.getCodeableConceptFromClipboard();
    if (cc) {
      this.patchJurisdiction(index, cc);
      this.toastService.showSuccess('Pasted from clipboard.', 'Paste');
    }
  }

  protected pasteTypeFromClipboard(index: number): void {
    const cc = this.getCodeableConceptFromClipboard();
    if (cc) {
      this.patchType(index, cc);
      this.toastService.showSuccess('Pasted from clipboard.', 'Paste');
    }
  }

  protected pasteTopicFromClipboard(index: number): void {
    const cc = this.getCodeableConceptFromClipboard();
    if (cc) {
      this.patchTopic(index, cc);
      this.toastService.showSuccess('Pasted from clipboard.', 'Paste');
    }
  }

  private getCodeableConceptFromClipboard(): CodeableConcept | null {
    const items = this.clipboardService.query({ typeFilter: 'Coding' });
    if (items.length === 0) {
      this.toastService.showWarning('No Coding on clipboard.', 'Paste');
      return null;
    }
    const payload = items[0].payload;
    if (payload && typeof payload === 'object' && 'system' in payload && 'code' in payload) {
      return { coding: [payload as Coding] };
    }
    this.toastService.showWarning('Clipboard item is not a Coding.', 'Paste');
    return null;
  }

  protected pasteFromClipboardIntoField(field: PasteableField): void {
    const m = this.measure();
    if (!m) return;
    const items = this.clipboardService.query({ typeFilter: 'Coding' });
    if (items.length === 0) {
      this.toastService.showWarning('No Coding on clipboard. Add a coding from Terminology first.', 'Paste');
      return;
    }
    const item = items[0];
    const payload = item.payload;
    if (payload && typeof payload === 'object' && 'system' in payload && 'code' in payload) {
      const coding = payload as Coding;
      const cc: CodeableConcept = { coding: [coding] };
      const updated = { ...m } as Measure;
      if (field === 'scoring') updated.scoring = cc;
      else if (field === 'improvementNotation') updated.improvementNotation = cc;
      else if (field === 'compositeScoring') updated.compositeScoring = cc;
      else if (field === 'subjectCodeableConcept') updated.subjectCodeableConcept = cc;
      else if (field === 'jurisdiction' && Array.isArray(updated.jurisdiction)) updated.jurisdiction = [cc];
      else if (field === 'jurisdiction') updated.jurisdiction = [cc];
      else if (field === 'topic' && Array.isArray(updated.topic)) updated.topic = [cc];
      else if (field === 'topic') updated.topic = [cc];
      this.measureChange.emit(updated);
      this.toastService.showSuccess('Pasted from clipboard.', 'Paste');
    } else {
      this.toastService.showWarning('Clipboard item is not a Coding.', 'Paste');
    }
  }

  private getFirstCoding(cc: CodeableConcept | undefined): Coding | undefined {
    return cc?.coding?.[0];
  }

  protected displayCodeableConcept(cc: CodeableConcept | undefined): string {
    const c = this.getFirstCoding(cc);
    if (!c) return cc?.text ?? '—';
    return ([c.system, c.code, c.display].filter(Boolean).join(' | ') || cc?.text) ?? '—';
  }

  protected displayLibraryRefs(library: string[] | undefined): string {
    if (!library?.length) return '—';
    return library.join(', ');
  }

  protected displayIdentifiers(identifier: Identifier[] | undefined): string {
    if (!identifier?.length) return '—';
    return identifier.map(i => [i.system, i.value].filter(Boolean).join(' = ')).join('; ');
  }

  protected displayContactSummary(contacts: ContactDetail[] | undefined): string {
    if (!contacts?.length) return '—';
    return contacts.map(c => c.name ?? c.telecom?.[0]?.value ?? '—').join('; ');
  }

  protected displayUsageContextSummary(useContext: UsageContext[] | undefined): string {
    if (!useContext?.length) return '—';
    return useContext
      .map(u => (u.valueCodeableConcept?.text ?? u.code?.code ?? '') + (u.valueQuantity ? ` ${u.valueQuantity.value}` : ''))
      .filter(Boolean)
      .join('; ') || '—';
  }

  protected displayPeriod(period: Period | undefined): string {
    if (!period) return '—';
    const start = period.start ?? '';
    const end = period.end ?? '';
    if (start && end) return `${start} to ${end}`;
    return start || end || '—';
  }

  protected displayRelatedArtifactSummary(related: RelatedArtifact[] | undefined): string {
    if (!related?.length) return '—';
    return related.map(r => r.type + (r.display ? `: ${r.display}` : '')).join('; ');
  }

  protected displayDefinitionList(def: string[] | undefined): string {
    if (!def?.length) return '—';
    return def.join('\n\n');
  }

  protected addIdentifier(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.identifier ?? []), { system: '', value: '' }];
    this.measureChange.emit({ ...m, identifier: next });
  }

  protected removeIdentifier(index: number): void {
    const m = this.measure();
    if (!m?.identifier?.length || index < 0 || index >= m.identifier.length) return;
    const next = m.identifier.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, identifier: next.length ? next : undefined });
  }

  protected patchIdentifier(index: number, partial: Partial<Identifier>): void {
    const m = this.measure();
    if (!m?.identifier?.length || index < 0 || index >= m.identifier.length) return;
    const next = [...m.identifier];
    next[index] = { ...next[index], ...partial };
    this.measureChange.emit({ ...m, identifier: next });
  }

  protected clearSubjectCodeableConcept(): void {
    this.patchMeasure({ subjectCodeableConcept: undefined });
  }

  protected addContact(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.contact ?? []), { name: '' }];
    this.measureChange.emit({ ...m, contact: next });
  }

  protected removeContact(index: number): void {
    const m = this.measure();
    if (!m?.contact?.length || index < 0 || index >= m.contact.length) return;
    const next = m.contact.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, contact: next.length ? next : undefined });
  }

  protected patchContact(index: number, partial: Partial<ContactDetail>): void {
    const m = this.measure();
    if (!m?.contact?.length || index < 0 || index >= m.contact.length) return;
    const next = [...m.contact];
    next[index] = { ...next[index], ...partial };
    this.measureChange.emit({ ...m, contact: next });
  }

  protected setEffectivePeriod(period: Period | undefined): void {
    this.patchMeasure({ effectivePeriod: period ?? undefined });
  }

  protected addUseContext(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.useContext ?? []), { code: { code: '' }, valueCodeableConcept: { text: '' } }];
    this.measureChange.emit({ ...m, useContext: next });
  }

  protected removeUseContext(index: number): void {
    const m = this.measure();
    if (!m?.useContext?.length || index < 0 || index >= m.useContext.length) return;
    const next = m.useContext.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, useContext: next.length ? next : undefined });
  }

  protected patchUseContext(index: number, partial: Partial<UsageContext>): void {
    const m = this.measure();
    if (!m?.useContext?.length || index < 0 || index >= m.useContext.length) return;
    const next = [...m.useContext];
    next[index] = { ...next[index], ...partial };
    this.measureChange.emit({ ...m, useContext: next });
  }

  protected addJurisdiction(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.jurisdiction ?? []), {}];
    this.measureChange.emit({ ...m, jurisdiction: next });
  }

  protected removeJurisdiction(index: number): void {
    const m = this.measure();
    if (!m?.jurisdiction?.length || index < 0 || index >= m.jurisdiction.length) return;
    const next = m.jurisdiction.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, jurisdiction: next.length ? next : undefined });
  }

  protected patchJurisdiction(index: number, cc: CodeableConcept): void {
    const m = this.measure();
    if (!m?.jurisdiction?.length || index < 0 || index >= m.jurisdiction.length) return;
    const next = [...m.jurisdiction];
    next[index] = cc;
    this.measureChange.emit({ ...m, jurisdiction: next });
  }

  protected addTopic(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.topic ?? []), {}];
    this.measureChange.emit({ ...m, topic: next });
  }

  protected removeTopic(index: number): void {
    const m = this.measure();
    if (!m?.topic?.length || index < 0 || index >= m.topic.length) return;
    const next = m.topic.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, topic: next.length ? next : undefined });
  }

  protected patchTopic(index: number, cc: CodeableConcept): void {
    const m = this.measure();
    if (!m?.topic?.length || index < 0 || index >= m.topic.length) return;
    const next = [...m.topic];
    next[index] = cc;
    this.measureChange.emit({ ...m, topic: next });
  }

  protected addAuthor(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.author ?? []), { name: '' }];
    this.measureChange.emit({ ...m, author: next });
  }

  protected removeAuthor(index: number): void {
    const m = this.measure();
    if (!m?.author?.length || index < 0 || index >= m.author.length) return;
    const next = m.author.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, author: next.length ? next : undefined });
  }

  protected patchAuthor(index: number, partial: Partial<ContactDetail>): void {
    const m = this.measure();
    if (!m?.author?.length || index < 0 || index >= m.author.length) return;
    const next = [...m.author];
    next[index] = { ...next[index], ...partial };
    this.measureChange.emit({ ...m, author: next });
  }

  protected addEditor(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.editor ?? []), { name: '' }];
    this.measureChange.emit({ ...m, editor: next });
  }

  protected removeEditor(index: number): void {
    const m = this.measure();
    if (!m?.editor?.length || index < 0 || index >= m.editor.length) return;
    const next = m.editor.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, editor: next.length ? next : undefined });
  }

  protected patchEditor(index: number, partial: Partial<ContactDetail>): void {
    const m = this.measure();
    if (!m?.editor?.length || index < 0 || index >= m.editor.length) return;
    const next = [...m.editor];
    next[index] = { ...next[index], ...partial };
    this.measureChange.emit({ ...m, editor: next });
  }

  protected addReviewer(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.reviewer ?? []), { name: '' }];
    this.measureChange.emit({ ...m, reviewer: next });
  }

  protected removeReviewer(index: number): void {
    const m = this.measure();
    if (!m?.reviewer?.length || index < 0 || index >= m.reviewer.length) return;
    const next = m.reviewer.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, reviewer: next.length ? next : undefined });
  }

  protected patchReviewer(index: number, partial: Partial<ContactDetail>): void {
    const m = this.measure();
    if (!m?.reviewer?.length || index < 0 || index >= m.reviewer.length) return;
    const next = [...m.reviewer];
    next[index] = { ...next[index], ...partial };
    this.measureChange.emit({ ...m, reviewer: next });
  }

  protected addEndorser(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.endorser ?? []), { name: '' }];
    this.measureChange.emit({ ...m, endorser: next });
  }

  protected removeEndorser(index: number): void {
    const m = this.measure();
    if (!m?.endorser?.length || index < 0 || index >= m.endorser.length) return;
    const next = m.endorser.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, endorser: next.length ? next : undefined });
  }

  protected patchEndorser(index: number, partial: Partial<ContactDetail>): void {
    const m = this.measure();
    if (!m?.endorser?.length || index < 0 || index >= m.endorser.length) return;
    const next = [...m.endorser];
    next[index] = { ...next[index], ...partial };
    this.measureChange.emit({ ...m, endorser: next });
  }

  protected addRelatedArtifact(): void {
    const m = this.measure();
    if (!m) return;
    const next: RelatedArtifact[] = [...(m.relatedArtifact ?? []), { type: 'documentation' }];
    this.measureChange.emit({ ...m, relatedArtifact: next });
  }

  protected removeRelatedArtifact(index: number): void {
    const m = this.measure();
    if (!m?.relatedArtifact?.length || index < 0 || index >= m.relatedArtifact.length) return;
    const next = m.relatedArtifact.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, relatedArtifact: next.length ? next : undefined });
  }

  protected patchRelatedArtifact(index: number, partial: Partial<RelatedArtifact>): void {
    const m = this.measure();
    if (!m?.relatedArtifact?.length || index < 0 || index >= m.relatedArtifact.length) return;
    const next = [...m.relatedArtifact];
    next[index] = { ...next[index], ...partial } as RelatedArtifact;
    this.measureChange.emit({ ...m, relatedArtifact: next });
  }

  protected addLibrary(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.library ?? []), ''];
    this.measureChange.emit({ ...m, library: next });
  }

  protected removeLibrary(index: number): void {
    const m = this.measure();
    if (!m?.library?.length || index < 0 || index >= m.library.length) return;
    const next = m.library.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, library: next.length ? next : undefined });
  }

  protected patchLibrary(index: number, value: string): void {
    const m = this.measure();
    if (!m?.library?.length || index < 0 || index >= m.library.length) return;
    const next = [...m.library];
    next[index] = value;
    this.measureChange.emit({ ...m, library: next });
  }

  protected clearScoring(): void {
    this.patchMeasure({ scoring: undefined });
  }

  protected clearCompositeScoring(): void {
    this.patchMeasure({ compositeScoring: undefined });
  }

  protected clearImprovementNotation(): void {
    this.patchMeasure({ improvementNotation: undefined });
  }

  protected addType(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.type ?? []), {}];
    this.measureChange.emit({ ...m, type: next });
  }

  protected removeType(index: number): void {
    const m = this.measure();
    if (!m?.type?.length || index < 0 || index >= m.type.length) return;
    const next = m.type.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, type: next.length ? next : undefined });
  }

  protected patchType(index: number, cc: CodeableConcept): void {
    const m = this.measure();
    if (!m?.type?.length || index < 0 || index >= m.type.length) return;
    const next = [...m.type];
    next[index] = cc;
    this.measureChange.emit({ ...m, type: next });
  }

  protected addDefinition(): void {
    const m = this.measure();
    if (!m) return;
    const next = [...(m.definition ?? []), ''];
    this.measureChange.emit({ ...m, definition: next });
  }

  protected removeDefinition(index: number): void {
    const m = this.measure();
    if (!m?.definition?.length || index < 0 || index >= m.definition.length) return;
    const next = m.definition.filter((_, i) => i !== index);
    this.measureChange.emit({ ...m, definition: next.length ? next : undefined });
  }

  protected patchDefinition(index: number, value: string): void {
    const m = this.measure();
    if (!m?.definition?.length || index < 0 || index >= m.definition.length) return;
    const next = [...m.definition];
    next[index] = value;
    this.measureChange.emit({ ...m, definition: next });
  }

  protected clearDisclaimer(): void {
    this.patchMeasure({ disclaimer: undefined });
  }

  protected clearGuidance(): void {
    this.patchMeasure({ guidance: undefined });
  }

  protected clearEffectivePeriod(): void {
    this.setEffectivePeriod(undefined);
  }

  protected statusOptions = ['draft', 'active', 'retired', 'unknown'] as const;
  protected relatedArtifactTypes = ['documentation', 'justification', 'citation', 'predecessor', 'successor', 'derived-from', 'depends-on', 'composed-of'] as const;

  /** FHIR R4 code system URLs for terminology-bound Measure fields (measure-definitions.html). */
  private static readonly MEASURE_SCORING_SYSTEM = 'http://terminology.hl7.org/CodeSystem/measure-scoring';
  private static readonly COMPOSITE_MEASURE_SCORING_SYSTEM = 'http://terminology.hl7.org/CodeSystem/composite-measure-scoring';
  private static readonly MEASURE_IMPROVEMENT_NOTATION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/measure-improvement-notation';
  private static readonly MEASURE_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/measure-type';

  /** MeasureScoring (Extensible) – R4 ValueSet measure-scoring */
  protected scoringOptions: { value: string; label: string }[] = [
    { value: '', label: '(none)' },
    { value: 'proportion', label: 'Proportion' },
    { value: 'ratio', label: 'Ratio' },
    { value: 'continuous-variable', label: 'Continuous Variable' },
    { value: 'cohort', label: 'Cohort' }
  ];

  /** CompositeMeasureScoring (Extensible) – R4 ValueSet composite-measure-scoring */
  protected compositeScoringOptions: { value: string; label: string }[] = [
    { value: '', label: '(none)' },
    { value: 'opportunity', label: 'Opportunity' },
    { value: 'all-or-nothing', label: 'All-or-nothing' },
    { value: 'linear', label: 'Linear' },
    { value: 'weighted', label: 'Weighted' }
  ];

  /** MeasureImprovementNotation (Required) – R4 ValueSet measure-improvement-notation */
  protected improvementNotationOptions: { value: string; label: string }[] = [
    { value: '', label: '(none)' },
    { value: 'increase', label: 'Increased score indicates improvement' },
    { value: 'decrease', label: 'Decreased score indicates improvement' }
  ];

  /** MeasureType (Extensible) – R4 ValueSet measure-type */
  protected measureTypeOptions: { value: string; label: string }[] = [
    { value: '', label: '(none)' },
    { value: 'process', label: 'Process' },
    { value: 'outcome', label: 'Outcome' },
    { value: 'structure', label: 'Structure' },
    { value: 'patient-reported-outcome', label: 'Patient Reported Outcome' },
    { value: 'composite', label: 'Composite' }
  ];

  protected getCodeFromCodeableConcept(cc: CodeableConcept | undefined): string {
    return cc?.coding?.[0]?.code ?? '';
  }

  protected setScoringCode(code: string): void {
    const opt = this.scoringOptions.find(o => o.value === code);
    const coding = code
      ? { system: MeasureDefinitionTabComponent.MEASURE_SCORING_SYSTEM, code, display: opt?.label }
      : undefined;
    this.patchMeasure({ scoring: coding ? { coding: [coding] } : undefined });
  }

  protected setCompositeScoringCode(code: string): void {
    const opt = this.compositeScoringOptions.find(o => o.value === code);
    const coding = code
      ? { system: MeasureDefinitionTabComponent.COMPOSITE_MEASURE_SCORING_SYSTEM, code, display: opt?.label }
      : undefined;
    this.patchMeasure({ compositeScoring: coding ? { coding: [coding] } : undefined });
  }

  protected setImprovementNotationCode(code: string): void {
    const opt = this.improvementNotationOptions.find(o => o.value === code);
    const coding = code
      ? { system: MeasureDefinitionTabComponent.MEASURE_IMPROVEMENT_NOTATION_SYSTEM, code, display: opt?.label }
      : undefined;
    this.patchMeasure({ improvementNotation: coding ? { coding: [coding] } : undefined });
  }

  protected setTypeCode(index: number, code: string): void {
    const m = this.measure();
    if (!m?.type?.length || index < 0 || index >= m.type.length) return;
    const opt = this.measureTypeOptions.find(o => o.value === code);
    const coding = code
      ? { system: MeasureDefinitionTabComponent.MEASURE_TYPE_SYSTEM, code, display: opt?.label }
      : undefined;
    const next = [...m.type];
    next[index] = coding ? { coding: [coding] } : {};
    this.measureChange.emit({ ...m, type: next });
  }

  protected getTypeCodeAtIndex(index: number): string {
    const m = this.measure();
    const t = m?.type?.[index];
    return this.getCodeFromCodeableConcept(t) ?? '';
  }
}
