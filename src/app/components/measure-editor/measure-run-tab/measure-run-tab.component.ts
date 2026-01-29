// Author: Preston Lee

import { Component, input, signal, inject, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Subject } from 'rxjs';
import { debounceTime, filter, switchMap, catchError } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { Measure, MeasureReport, Patient } from 'fhir/r4';
import { MeasureService } from '../../../services/measure.service';
import { PatientService } from '../../../services/patient.service';
import { SettingsService } from '../../../services/settings.service';
import { ToastService } from '../../../services/toast.service';
import { MeasureReportViewComponent } from '../measure-report-view/measure-report-view.component';

export interface SubjectOption {
  reference: string;
  display: string;
}

@Component({
  selector: 'app-measure-run-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, MeasureReportViewComponent],
  templateUrl: './measure-run-tab.component.html',
  styleUrl: './measure-run-tab.component.scss'
})
export class MeasureRunTabComponent {
  @ViewChild('subjectResultsList') subjectResultsListRef?: ElementRef<HTMLUListElement>;

  measure = input<Measure | null>(null);

  protected readonly periodStart = signal('');
  protected readonly periodEnd = signal('');
  protected readonly reportType = signal<'subject' | 'subject-list' | 'population'>('population');
  protected readonly subject = signal('');
  protected readonly running = signal(false);
  protected readonly result = signal<MeasureReport | null>(null);
  protected readonly runError = signal<string | null>(null);

  protected readonly subjectSearchQuery = signal('');
  protected readonly subjectSearchResults = signal<SubjectOption[]>([]);
  protected readonly subjectSearchLoading = signal(false);
  protected readonly subjectSearchOpen = signal(false);
  protected readonly subjectSearchHighlightIndex = signal(-1);

  protected readonly showSubjectSearch = computed(() => {
    const t = this.reportType();
    return t === 'subject' || t === 'subject-list';
  });

  protected readonly hasValidConfiguration = () => {
    const base = this.settingsService.getEffectiveFhirBaseUrl();
    return base.trim() !== '';
  };

  private measureService = inject(MeasureService);
  private patientService = inject(PatientService);
  private settingsService = inject(SettingsService);
  private toastService = inject(ToastService);
  private subjectSearchTrigger = new Subject<string>();

  constructor() {
    this.subjectSearchTrigger
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(term => {
        if (term.length < 2) {
          this.subjectSearchOpen.set(false);
          this.subjectSearchResults.set([]);
          this.subjectSearchLoading.set(false);
        } else {
          this.subjectSearchLoading.set(true);
          this.subjectSearchResults.set([]);
          this.subjectSearchOpen.set(true);
        }
      });

    this.subjectSearchTrigger
      .pipe(
        debounceTime(300),
        filter(term => term.length >= 2),
        switchMap(term =>
          this.patientService.search(term).pipe(
            catchError(() => of({ entry: [] } as { entry: Array<{ resource?: Patient }> }))
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe(bundle => {
        this.subjectSearchLoading.set(false);
        const entries = bundle?.entry ?? [];
        const options: SubjectOption[] = entries
          .map(e => e.resource)
          .filter((r): r is Patient => !!r?.id)
          .map(p => ({
            reference: `Patient/${p.id}`,
            display: this.patientDisplay(p)
          }));
        this.subjectSearchResults.set(options);
        this.subjectSearchOpen.set(options.length > 0);
        this.subjectSearchHighlightIndex.set(options.length > 0 ? 0 : -1);
      });
  }

  private patientDisplay(p: Patient): string {
    const names = p.name ?? [];
    const first = names[0];
    if (first?.given?.length || first?.family) {
      const given = first.given?.join(' ') ?? '';
      const family = first.family ?? '';
      return ([given, family].filter(Boolean).join(' ').trim() || p.id) ?? '';
    }
    return p.id ?? '';
  }

  get periodStartValue(): string {
    return this.periodStart();
  }
  set periodStartValue(v: string) {
    this.periodStart.set(v);
  }
  get periodEndValue(): string {
    return this.periodEnd();
  }
  set periodEndValue(v: string) {
    this.periodEnd.set(v);
  }
  get reportTypeValue(): string {
    return this.reportType();
  }
  set reportTypeValue(v: string) {
    this.reportType.set(v as 'subject' | 'subject-list' | 'population');
  }
  get subjectValue(): string {
    return this.subject();
  }
  set subjectValue(v: string) {
    this.subject.set(v);
  }

  protected onSubjectInput(value: string): void {
    this.subject.set(value);
    this.subjectSearchQuery.set(value);
    if (this.showSubjectSearch()) {
      this.subjectSearchTrigger.next(value.trim());
      if (value.trim().length < 2) {
        this.subjectSearchOpen.set(false);
        this.subjectSearchResults.set([]);
      }
    }
  }

  protected onSubjectKeydown(event: KeyboardEvent): void {
    if (!this.showSubjectSearch()) return;
    const open = this.subjectSearchOpen();
    const results = this.subjectSearchResults();
    let idx = this.subjectSearchHighlightIndex();

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (open && results.length) {
        idx = idx < results.length - 1 ? idx + 1 : 0;
        this.subjectSearchHighlightIndex.set(idx);
        this.scrollHighlightIntoView(idx);
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (open && results.length) {
        idx = idx <= 0 ? results.length - 1 : idx - 1;
        this.subjectSearchHighlightIndex.set(idx);
        this.scrollHighlightIntoView(idx);
      }
      return;
    }
    if (event.key === 'Enter' && open && results.length && idx >= 0) {
      event.preventDefault();
      this.selectSubjectOption(results[idx]);
      return;
    }
    if (event.key === 'Escape') {
      this.subjectSearchOpen.set(false);
    }
  }

  private scrollHighlightIntoView(index: number): void {
    setTimeout(() => {
      const list = this.subjectResultsListRef?.nativeElement;
      const item = list?.querySelector(`[data-subject-index="${index}"]`);
      (item as HTMLElement)?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  protected selectSubjectOption(option: SubjectOption): void {
    this.subject.set(option.reference);
    this.subjectSearchQuery.set(option.display);
    this.subjectSearchOpen.set(false);
    this.subjectSearchHighlightIndex.set(-1);
  }

  protected onSubjectBlur(): void {
    setTimeout(() => this.subjectSearchOpen.set(false), 200);
  }

  protected async run(): Promise<void> {
    const m = this.measure();
    if (!m?.id) {
      this.toastService.showWarning('No measure loaded.', 'Run');
      return;
    }
    if (!this.hasValidConfiguration()) {
      this.toastService.showWarning('Configure FHIR base URL in Settings.', 'Run');
      return;
    }
    const start = this.periodStart().trim();
    const end = this.periodEnd().trim();
    if (!start || !end) {
      this.toastService.showWarning('Set period start and end.', 'Run');
      return;
    }
    this.running.set(true);
    this.runError.set(null);
    this.result.set(null);
    try {
      const report = await firstValueFrom(this.measureService.evaluateMeasure(m.id, {
        periodStart: start,
        periodEnd: end,
        reportType: this.reportType(),
        subject: this.subject().trim() || undefined
      }));
      this.result.set(report);
      if (report) {
        this.toastService.showSuccess('Measure evaluation completed.', 'Run');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Evaluate measure failed.';
      this.runError.set(msg);
      this.toastService.showError(msg, 'Run');
    } finally {
      this.running.set(false);
    }
  }

  protected setDefaultPeriod(): void {
    const now = new Date();
    const year = now.getFullYear();
    this.periodStart.set(`${year}-01-01`);
    this.periodEnd.set(`${year}-12-31`);
  }
}
