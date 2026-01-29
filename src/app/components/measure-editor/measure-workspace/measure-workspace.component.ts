// Author: Preston Lee

import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { Measure, OperationOutcome, CodeableConcept, Identifier } from 'fhir/r4';
import { MeasureService } from '../../../services/measure.service';
import { SettingsService } from '../../../services/settings.service';
import { ToastService } from '../../../services/toast.service';
import { MeasureDefinitionTabComponent } from '../measure-definition-tab/measure-definition-tab.component';
import { MeasureGroupsTabComponent } from '../measure-groups-tab/measure-groups-tab.component';
import { MeasureRunTabComponent } from '../measure-run-tab/measure-run-tab.component';
import { MeasureReportsTabComponent } from '../measure-reports-tab/measure-reports-tab.component';

type WorkspaceTab = 'definition' | 'groups' | 'run' | 'reports';

@Component({
  selector: 'app-measure-workspace',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MeasureDefinitionTabComponent,
    MeasureGroupsTabComponent,
    MeasureRunTabComponent,
    MeasureReportsTabComponent
  ],
  templateUrl: './measure-workspace.component.html',
  styleUrl: './measure-workspace.component.scss'
})
export class MeasureWorkspaceComponent {
  protected readonly measure = signal<Measure | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly activeTab = signal<WorkspaceTab>('definition');

  protected readonly measureTitle = computed(() => {
    const m = this.measure();
    return m?.title ?? m?.name ?? m?.id ?? 'Measure';
  });

  protected readonly measureId = computed(() => this.measure()?.id ?? '');

  protected readonly measureStatus = computed(() => this.measure()?.status ?? '');

  protected readonly isNewMeasure = computed(
    () => this.route.snapshot.paramMap.get('id') === 'new' || this.route.snapshot.routeConfig?.path === 'new'
  );
  protected readonly hasValidConfiguration = () => this.settingsService.getEffectiveFhirBaseUrl().trim() !== '';
  protected readonly saving = signal(false);
  protected readonly reloading = signal(false);
  protected readonly validating = signal(false);
  protected readonly deleting = signal(false);
  protected readonly validationOutcomeRaw = signal<OperationOutcome | null>(null);
  protected readonly validationError = signal<string | null>(null);

  protected readonly sidebarTab = signal<'validation' | 'summary'>('summary');
  protected setSidebarTab(tab: 'validation' | 'summary'): void {
    this.sidebarTab.set(tab);
  }

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private measureService = inject(MeasureService);
  private settingsService = inject(SettingsService);
  private toastService = inject(ToastService);

  constructor() {
    this.route.paramMap
      .pipe(
        filter(params => !!params.get('id')),
        takeUntilDestroyed()
      )
      .subscribe(params => {
        const id = params.get('id')!;
        if (id === 'new') {
          this.measure.set(this.createNewMeasure());
          this.loading.set(false);
          this.error.set(null);
        } else {
          this.loadMeasure(id);
        }
      });
    const path = this.route.snapshot.routeConfig?.path;
    const initialId = this.route.snapshot.paramMap.get('id');
    if (path === 'new' || initialId === 'new') {
      this.measure.set(this.createNewMeasure());
      this.loading.set(false);
      this.error.set(null);
    } else if (initialId) {
      this.loadMeasure(initialId);
    }
  }

  private createNewMeasure(): Measure {
    return {
      resourceType: 'Measure',
      status: 'draft'
    };
  }

  private async loadMeasure(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const m = await firstValueFrom(this.measureService.getMeasure(id));
      this.measure.set(m);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load measure.';
      this.error.set(msg);
      this.toastService.showError(msg, 'Measure Load');
      this.measure.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected async reload(): Promise<void> {
    const id = this.measure()?.id ?? this.route.snapshot.paramMap.get('id');
    if (!id || id === 'new') return;
    this.reloading.set(true);
    this.error.set(null);
    try {
      const m = await firstValueFrom(this.measureService.getMeasure(id));
      this.measure.set(m);
      this.toastService.showSuccess('Measure reloaded from server.', 'Reload');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reload failed.';
      this.error.set(msg);
      this.toastService.showError(msg, 'Reload');
    } finally {
      this.reloading.set(false);
    }
  }

  protected async save(): Promise<void> {
    const m = this.measure();
    if (!m) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      if (this.isNewMeasure()) {
        const created = await firstValueFrom(this.measureService.createMeasure(m));
        this.measure.set(created);
        this.toastService.showSuccess('Measure created.', 'Save');
        if (created.id) {
          this.router.navigate(['/measures', created.id], { replaceUrl: true });
        }
      } else if (m.id) {
        await firstValueFrom(this.measureService.putMeasure(m));
        this.toastService.showSuccess('Measure saved.', 'Save');
      } else {
        this.toastService.showWarning('Measure has no id. Set an id in Definition to save.', 'Save');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed.';
      this.error.set(msg);
      this.toastService.showError(msg, 'Save');
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteMeasure(): Promise<void> {
    const id = this.measure()?.id ?? this.route.snapshot.paramMap.get('id');
    if (!id || id === 'new') return;
    this.deleting.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.measureService.deleteMeasure(id));
      this.toastService.showSuccess('Measure deleted.', 'Delete');
      this.router.navigate(['/measures']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed.';
      this.error.set(msg);
      this.toastService.showError(msg, 'Delete');
    } finally {
      this.deleting.set(false);
    }
  }

  protected async validate(): Promise<void> {
    const m = this.measure();
    if (!m) return;
    this.validating.set(true);
    this.validationOutcomeRaw.set(null);
    this.validationError.set(null);
    this.setSidebarTab('validation');
    try {
      const mode = this.isNewMeasure() ? 'create' : 'update';
      const outcome = await firstValueFrom(this.measureService.validateMeasure(m, mode));
      this.validationOutcomeRaw.set(outcome);
      if (this.hasErrors(outcome)) {
        this.toastService.showError('Validation reported errors. See Validation tab.', 'Validate');
      } else {
        this.toastService.showSuccess('Validation passed.', 'Validate');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Validation request failed.';
      this.validationError.set(msg);
      this.toastService.showError(msg, 'Validate');
    } finally {
      this.validating.set(false);
    }
  }

  private hasErrors(outcome: { issue?: Array<{ severity?: string }> }): boolean {
    return (outcome.issue ?? []).some(i => i.severity === 'error' || i.severity === 'fatal');
  }

  setTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
  }

  onMeasureChange(updated: Measure): void {
    this.measure.set(updated);
  }

  backToLibrary(): void {
    this.router.navigate(['/measures']);
  }

  protected displayCodeableConcept(cc: CodeableConcept | undefined): string {
    const c = cc?.coding?.[0];
    if (!c) return cc?.text ?? '—';
    const joined = [c.system, c.code, c.display].filter(Boolean).join(' | ');
    return joined || (cc?.text ?? '—');
  }

  protected displayIdentifiers(identifier: Identifier[] | undefined): string {
    if (!identifier?.length) return '—';
    return identifier.map(i => [i.system, i.value].filter(Boolean).join(' = ')).join('; ');
  }

  protected populationCodeDisplay(pop: { code?: CodeableConcept }): string {
    const cc = pop.code;
    return cc?.text ?? this.displayCodeableConcept(cc) ?? '—';
  }

  protected criteriaExpression(criteria: { expression?: string } | undefined): string {
    return criteria?.expression ?? '—';
  }
}
