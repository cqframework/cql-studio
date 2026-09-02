// Author: Preston Lee

import { ChangeDetectionStrategy, Component, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FhirPackageCatalogEntry } from '../../../models/fhir-package-registry.types';
import { FhirPackageRegistryService } from '../../../services/fhir-package-registry.service';

@Component({
  selector: 'app-registry-importer-find-packages-panel',
  imports: [FormsModule],
  templateUrl: './registry-importer-find-packages-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegistryImporterFindPackagesPanelComponent {
  readonly findPackagesExpanded = model(true);
  readonly hasImportWorkspace = input(false);
  readonly selectedPackageId = input<string | null>(null);
  readonly localPackageLoading = input(false);
  readonly nonRegistrySourceKind = input<'file' | 'url' | null>(null);
  readonly localPackageError = input<string | null>(null);
  readonly packageUrlInput = model('');

  readonly catalogEntrySelected = output<FhirPackageCatalogEntry>();
  readonly localFileSelected = output<File>();
  readonly packageUrlLoad = output<string>();

  private readonly registryService = inject(FhirPackageRegistryService);

  protected readonly catalogFhirVersionOptions: { label: string; value: string | null }[] = [
    { label: 'Any', value: null },
    { label: 'R4', value: 'R4' },
    { label: 'R5', value: 'R5' },
    { label: 'R6', value: 'R6' },
    { label: 'STU3', value: 'STU3' },
    { label: 'DSTU2', value: 'DSTU2' },
  ];

  protected readonly searchQuery = signal('');
  protected readonly catalogFhirVersionFilter = signal<string | null>(null);
  protected readonly searchLoading = signal(false);
  protected readonly searchError = signal<string | null>(null);
  protected readonly catalogResults = signal<FhirPackageCatalogEntry[]>([]);

  protected toggleFindPackagesExpanded(): void {
    this.findPackagesExpanded.update((v) => !v);
  }

  protected setCatalogFhirVersion(value: string | null): void {
    this.catalogFhirVersionFilter.set(value);
  }

  protected async onSearch(): Promise<void> {
    const q = this.searchQuery().trim();
    const fv = this.catalogFhirVersionFilter();
    if (!q && !fv) {
      this.searchError.set(
        'Enter a package name substring and/or choose a FHIR version filter (registry catalog API).'
      );
      return;
    }
    this.searchLoading.set(true);
    this.searchError.set(null);
    this.catalogResults.set([]);
    try {
      const list = await this.registryService.searchCatalog(q, fv);
      this.catalogResults.set(list);
      if (list.length === 0) {
        this.searchError.set(
          'No packages found. Try a shorter substring, another FHIR version, or browse registry.fhir.org.'
        );
      }
    } catch (e) {
      this.searchError.set(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      this.searchLoading.set(false);
    }
  }

  protected selectCatalogEntry(entry: FhirPackageCatalogEntry): void {
    this.catalogEntrySelected.emit(entry);
  }

  protected onLocalPackageFileSelect(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) {
      return;
    }
    inputEl.value = '';
    this.localFileSelected.emit(file);
  }

  protected onPackageUrlLoad(): void {
    this.packageUrlLoad.emit(this.packageUrlInput());
  }
}
