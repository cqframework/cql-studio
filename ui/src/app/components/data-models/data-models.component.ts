// Author: Preston Lee

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Bundle, Library } from 'fhir/r4';
import { LibraryService } from '../../services/library.service';
import { SettingsService } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
import { CqlModelInfoInstallService } from '../../services/cql-model-info-install.service';
import { CqlModelInfoService } from '../../services/cql-model-info.service';
import {
  MODEL_INFO_INSTALL_CATALOG,
  ModelInfoCatalogEntry
} from '../../services/cql-model-info-catalog.lib';
import {
  decodeModelInfoXmlFromLibrary,
  isModelDefinitionLibrary,
  resolveModelInfoIdentity
} from '../../services/cql-model-info.lib';
import { describeFhirHttpFailure } from '../../services/fhir-http-error.lib';
import { SyntaxHighlighterComponent } from '../shared/syntax-highlighter/syntax-highlighter.component';

type DetailTab = 'library' | 'modelinfo';

@Component({
  selector: 'app-data-models',
  imports: [FormsModule, RouterLink, SyntaxHighlighterComponent],
  templateUrl: './data-models.component.html'
})
export class DataModelsComponent implements OnInit {
  private readonly libraryService = inject(LibraryService);
  private readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly installService = inject(CqlModelInfoInstallService);
  private readonly modelInfoService = inject(CqlModelInfoService);

  readonly contentEndpointUrl = computed(() =>
    this.settingsService.getEffectiveContentEndpointAddress()
  );

  readonly searchTerm = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly rows = signal<Library[]>([]);
  readonly total = signal<number | null>(null);

  readonly selected = signal<Library | null>(null);
  readonly detailTab = signal<DetailTab>('library');
  readonly decodedXml = signal<string | null>(null);
  readonly busyAction = signal<string | null>(null);

  readonly catalog = MODEL_INFO_INSTALL_CATALOG;

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      let bundle: Bundle;
      try {
        bundle = await firstValueFrom(
          this.libraryService.searchModelDefinitions(
            this.searchTerm(),
            this.page(),
            this.pageSize(),
            true
          )
        );
      } catch {
        bundle = await firstValueFrom(
          this.libraryService.searchModelDefinitions(
            this.searchTerm(),
            this.page(),
            this.pageSize(),
            false
          )
        );
      }
      const libraries = (bundle.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is Library => r?.resourceType === 'Library');
      this.rows.set(libraries);
      this.total.set(typeof bundle.total === 'number' ? bundle.total : null);
      const sel = this.selected();
      if (sel?.id) {
        const refreshed = libraries.find((l) => l.id === sel.id) ?? null;
        if (refreshed) {
          this.selectLibrary(refreshed);
        }
      }
    } catch (err) {
      this.error.set(describeFhirHttpFailure(err));
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  onSearchSubmit(): void {
    this.page.set(1);
    void this.reload();
  }

  goPage(delta: number): void {
    const next = Math.max(1, this.page() + delta);
    this.page.set(next);
    void this.reload();
  }

  selectLibrary(library: Library): void {
    this.selected.set(library);
    this.detailTab.set('library');
    this.decodedXml.set(null);
  }

  setDetailTab(tab: DetailTab): void {
    this.detailTab.set(tab);
    if (tab === 'modelinfo' && this.decodedXml() == null) {
      const lib = this.selected();
      if (lib) {
        // Prefer identity-aligned XML (fixes published FHIR examples with stale XML versions).
        this.decodedXml.set(
          this.modelInfoService.xmlFromLibrary(lib) ?? decodeModelInfoXmlFromLibrary(lib)
        );
      }
    }
  }

  libraryJsonPreview(library: Library): string {
    const clone = structuredClone(library) as Library & {
      content?: Array<{ data?: string; contentType?: string }>;
    };
    if (clone.content) {
      clone.content = clone.content.map((c) => {
        if (c.data && c.data.length > 120) {
          return {
            ...c,
            data: `${c.data.slice(0, 48)}…(${c.data.length} chars base64 truncated)`
          };
        }
        return c;
      });
    }
    return JSON.stringify(clone, null, 2);
  }

  displayName(library: Library): string {
    const name = library.name === 'FHIRModelDefinition' ? 'FHIR' : library.name;
    if (name && library.version) {
      return `${name} ${library.version}`;
    }
    const id = resolveModelInfoIdentity(library, decodeModelInfoXmlFromLibrary(library));
    return id.version ? `${id.name} ${id.version}` : id.name || library.id || 'Library';
  }

  async deleteSelected(): Promise<void> {
    const lib = this.selected();
    if (!lib?.id) {
      return;
    }
    if (!confirm(`Delete ModelInfo Library ${this.displayName(lib)}?`)) {
      return;
    }
    this.busyAction.set('delete');
    try {
      await firstValueFrom(this.libraryService.deleteOnContent(lib));
      this.toast.showSuccess(`Deleted ${this.displayName(lib)}.`);
      this.selected.set(null);
      this.decodedXml.set(null);
      await this.reload();
    } catch (err) {
      this.toast.showError(describeFhirHttpFailure(err));
    } finally {
      this.busyAction.set(null);
    }
  }

  async installCatalogEntry(entry: ModelInfoCatalogEntry): Promise<void> {
    this.busyAction.set(entry.id);
    try {
      const result = await this.installService.installCatalogEntry(entry);
      this.modelInfoService.xmlFromLibrary(result.modelInfo);
      if (result.helpersWarning) {
        this.toast.showError(
          `Installed ${entry.label}, but companion FHIRHelpers failed: ${result.helpersWarning}`
        );
      } else {
        const helpersNote = result.fhirHelpers
          ? ` Also installed FHIRHelpers ${result.fhirHelpers.version ?? entry.companionHelpers?.version}.`
          : '';
        this.toast.showSuccess(`Installed ${entry.label}.${helpersNote}`);
      }
      await this.reload();
      this.selectLibrary(result.modelInfo);
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : describeFhirHttpFailure(err));
    } finally {
      this.busyAction.set(null);
    }
  }

  async onUploadLibraryJson(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.busyAction.set('upload-json');
    try {
      const text = await file.text();
      const library = await this.installService.installLibraryJson(text);
      if (!isModelDefinitionLibrary(library) && !decodeModelInfoXmlFromLibrary(library)) {
        this.toast.showError('Uploaded Library does not look like a model-definition ModelInfo.');
      } else {
        this.toast.showSuccess(`Uploaded ${this.displayName(library)}.`);
      }
      await this.reload();
      this.selectLibrary(library);
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : describeFhirHttpFailure(err));
    } finally {
      this.busyAction.set(null);
    }
  }

  async onUploadModelInfoXml(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.busyAction.set('upload-xml');
    try {
      const xml = await file.text();
      const library = await this.installService.installModelInfoXml(xml);
      this.toast.showSuccess(`Uploaded ${this.displayName(library)}.`);
      await this.reload();
      this.selectLibrary(library);
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : describeFhirHttpFailure(err));
    } finally {
      this.busyAction.set(null);
    }
  }

  kindBadgeClass(kind: ModelInfoCatalogEntry['kind']): string {
    if (kind === 'ballot') {
      return 'text-bg-warning';
    }
    if (kind === 'bundled') {
      return 'text-bg-secondary';
    }
    return 'text-bg-success';
  }
}
