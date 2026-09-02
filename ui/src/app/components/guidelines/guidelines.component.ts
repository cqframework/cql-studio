// Author: Preston Lee

import { Component, signal, viewChild, inject, effect, untracked, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { GuidelinesBrowserComponent } from './guidelines-browser/guidelines-browser.component';
import { GuidelineEditorComponent } from './guideline-editor/guideline-editor.component';
import { GuidelineTestingComponent } from './guideline-testing/guideline-testing.component';
import { NewGuidelineModalComponent } from './new-guideline-modal/new-guideline-modal.component';
import { ConversionModalComponent } from './conversion-modal/conversion-modal.component';
import { LibraryService } from '../../services/library.service';
import { SettingsService } from '../../services/settings.service';
import { GuidelinesStateService } from '../../services/guidelines-state.service';
import { GuidelineValidationService } from '../../services/guideline-validation.service';
import { TranslationService } from '../../services/translation.service';
import { CqlGenerationService } from '../../services/cql-generation.service';
import { ToastService } from '../../services/toast.service';
import { Library } from 'fhir/r4';
import { encodeUtf8Base64 } from '../../services/utf8-encoding.lib';
import { describeFhirHttpFailure } from '../../services/fhir-http-error.lib';

@Component({
  selector: 'app-guidelines',
  imports: [
    FormsModule,
    GuidelinesBrowserComponent,
    GuidelineEditorComponent,
    GuidelineTestingComponent,
    NewGuidelineModalComponent,
    ConversionModalComponent
  ],
  templateUrl: './guidelines.component.html',

  styleUrl: './guidelines.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuidelinesComponent {
  browserComponent = viewChild(GuidelinesBrowserComponent);
  
  protected readonly showBrowser = signal<boolean>(true);
  protected readonly showEditor = signal<boolean>(false);
  protected readonly showTesting = signal<boolean>(false);
  protected readonly showNewModal = signal<boolean>(false);
  protected readonly showConversionModal = signal<boolean>(false);
  protected readonly currentLibrary = signal<Library | null>(null);
  protected readonly conversionIssues = signal<string[]>([]);

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  public libraryService = inject(LibraryService);
  public settingsService = inject(SettingsService);
  private guidelinesStateService = inject(GuidelinesStateService);
  private guidelineValidationService = inject(GuidelineValidationService);
  private translationService = inject(TranslationService);
  private cqlGenerationService = inject(CqlGenerationService);
  private toastService = inject(ToastService);
  private loadGeneration = 0;

  private readonly libraryId = toSignal(
    this.route.paramMap.pipe(map(params => params.get('id'))),
    { initialValue: this.route.snapshot.paramMap.get('id') }
  );

  private readonly routeUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  constructor() {
    effect(() => {
      const id = this.libraryId();
      const url = this.routeUrl();
      const isTestingRoute = /\/guidelines\/[^/]+\/testing(?:\?|$)/.test(url);

      // Only react to route changes; UI signal writes must not re-enter this effect.
      untracked(() => {
        if (!id) {
          this.loadGeneration++;
          this.showBrowser.set(true);
          this.showEditor.set(false);
          this.showTesting.set(false);
          return;
        }

        if (isTestingRoute) {
          if (this.showTesting() && this.currentLibrary()?.id === id) {
            return;
          }
          void this.loadLibraryForTesting(id);
          return;
        }

        if (
          (this.showEditor() && this.currentLibrary()?.id === id) ||
          (this.showConversionModal() && this.currentLibrary()?.id === id)
        ) {
          return;
        }

        void this.loadAndOpenLibrary(id);
      });
    });
  }

  onOpenLibrary(library: Library): void {
    void this.loadAndOpenLibrary(library.id!);
  }

  onTestLibrary(library: Library): void {
    this.currentLibrary.set(library);
    this.showBrowser.set(false);
    this.showTesting.set(true);
    // Navigate to testing route
    if (library.id) {
      this.router.navigate(['/guidelines', library.id, 'testing'], { 
        replaceUrl: false 
      });
    }
  }

  private async loadLibraryForTesting(libraryId: string): Promise<void> {
    const generation = ++this.loadGeneration;
    try {
      const library = await firstValueFrom(this.libraryService.get(libraryId));
      if (generation !== this.loadGeneration) {
        return;
      }
      this.currentLibrary.set(library);
      this.showBrowser.set(false);
      this.showEditor.set(false);
      this.showTesting.set(true);
    } catch (error: any) {
      if (generation !== this.loadGeneration) {
        return;
      }
      console.error('Error loading library for testing:', error);
      // Stay on browser view
    }
  }

  private async loadAndOpenLibrary(libraryId: string): Promise<void> {
    const generation = ++this.loadGeneration;
    try {
      const library = await firstValueFrom(this.libraryService.get(libraryId));
      if (generation !== this.loadGeneration) {
        return;
      }
      const validation = this.guidelineValidationService.validateGuidelineFormat(library);
      const canCleanlyOpen = this.guidelineValidationService.canCleanlyOpen(library);
      const skipConversion = this.guidelinesStateService.consumeSkipConversion(libraryId);

      if (canCleanlyOpen || skipConversion) {
        this.openLibrary(library);
      } else {
        // Show conversion modal
        this.currentLibrary.set(library);
        this.conversionIssues.set(validation.issues);
        this.showConversionModal.set(true);
      }
    } catch (error) {
      if (generation !== this.loadGeneration) {
        return;
      }
      console.error('Error loading library:', error);
      // Stay on browser view
    }
  }

  onProceedWithConversion(): void {
    const library = this.currentLibrary();
    if (library?.id) {
      // Survives route remount when navigating to /guidelines/:id
      this.guidelinesStateService.markSkipConversion(library.id);
      this.showConversionModal.set(false);
      this.openLibrary(library);
    }
  }

  onCancelConversion(): void {
    this.loadGeneration++;
    this.showConversionModal.set(false);
    this.currentLibrary.set(null);
    this.conversionIssues.set([]);
    this.router.navigate(['/guidelines'], { replaceUrl: true });
  }

  private openLibrary(library: Library): void {
    this.currentLibrary.set(library);
    this.showBrowser.set(false);
    this.showEditor.set(true);
    this.showTesting.set(false);
    this.showConversionModal.set(false);
    const id = library.id;
    // Avoid remount loops when already on /guidelines/:id (e.g. after conversion Proceed).
    if (id && !this.router.url.split('?')[0].endsWith(`/guidelines/${id}`)) {
      this.router.navigate(['/guidelines', id], { replaceUrl: true });
    }
  }

  onCreateNew(): void {
    this.showNewModal.set(true);
  }

  async onNewGuidelineCreate(libraryData: Partial<Library>): Promise<void> {
    // Keep modal open until create succeeds so failures are visible.
    const libraryId = libraryData.name!.replace(/[^a-zA-Z0-9-]/g, '-');

    this.guidelinesStateService.initializeEmptyArtifact();
    const libraryUrl = this.libraryService.urlFor(libraryId);
    this.guidelinesStateService.updateMetadata({
      name: libraryData.name!,
      title: libraryData.title || libraryData.name!,
      version: libraryData.version || '1.0.0',
      description: libraryData.description,
      url: libraryUrl
    });

    const artifact = this.guidelinesStateService.artifact();
    if (!artifact) {
      this.toastService.showError('Failed to initialize guideline artifact.', 'Create Guideline');
      return;
    }

    const cqlContent = this.cqlGenerationService.generateCql(artifact);

    let translationResult;
    try {
      translationResult = await this.translationService.translateCqlToElmAsync(cqlContent);
    } catch (error) {
      this.toastService.showError(describeFhirHttpFailure(error), 'Create Guideline');
      return;
    }

    if (translationResult.hasErrors) {
      this.toastService.showError(
        translationResult.errors.join('; ') || 'Translation failed',
        'Create Guideline'
      );
      return;
    }

    const elmXml = translationResult.elmXml || '';

    const newLibrary: Library = {
      resourceType: 'Library' as const,
      id: libraryId,
      name: libraryData.name!,
      title: libraryData.title || libraryData.name!,
      version: libraryData.version || '1.0.0',
      status: 'active' as const,
      url: libraryUrl,
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/library-type',
            code: 'logic-library',
            display: 'Logic Library'
          }
        ]
      },
      content: [
        {
          contentType: 'text/cql',
          data: encodeUtf8Base64(cqlContent)
        },
        {
          contentType: 'application/elm+xml',
          data: encodeUtf8Base64(elmXml)
        }
      ],
      description: libraryData.description || `Guideline: ${libraryData.title || libraryData.name}`,
      extension: [
        {
          url: 'http://cqframework.org/fhir/StructureDefinition/guidelines-builder-metadata',
          valueString: JSON.stringify(artifact)
        }
      ]
    };

    try {
      const library = await firstValueFrom(this.libraryService.post(newLibrary));
      this.showNewModal.set(false);
      this.openLibrary(library);
    } catch (error) {
      console.error('Error creating library:', error);
      this.toastService.showError(describeFhirHttpFailure(error), 'Create Guideline');
    }
  }

  onNewGuidelineCancel(): void {
    this.showNewModal.set(false);
  }

  onEditorClose(): void {
    this.showBrowser.set(true);
    this.showEditor.set(false);
    this.showTesting.set(false);
    this.currentLibrary.set(null);
    this.guidelinesStateService.reset();
    this.router.navigate(['/guidelines'], { replaceUrl: true });
  }

  onTestingClose(): void {
    this.showBrowser.set(true);
    this.showTesting.set(false);
    this.currentLibrary.set(null);
    this.router.navigate(['/guidelines'], { replaceUrl: true });
  }

  async onDeleteLibrary(library: Library): Promise<void> {
    if (!library.id) {
      console.error('Cannot delete library: no ID');
      return;
    }

    try {
      await firstValueFrom(this.libraryService.delete(library));
      // If we're currently viewing/editing this library, close it first
      if (this.currentLibrary()?.id === library.id) {
        this.showEditor.set(false);
        this.showTesting.set(false);
        this.currentLibrary.set(null);
        this.guidelinesStateService.reset();
      }
      
      // Reload the browser to refresh the list
      if (this.browserComponent()) {
        this.browserComponent()!.loadLibraries();
      } else {
        // Fallback: navigate to trigger reload
        this.router.navigate(['/guidelines'], { replaceUrl: true });
      }
    } catch (error: any) {
      console.error('Error deleting library:', error);
      const errorMessage = error?.message || error?.error?.message || 'Unknown error';
      alert(`Failed to delete library: ${errorMessage}`);
    }
  }
}
