// Author: Preston Lee

import { Component, OnInit, OnDestroy, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
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
import { Library } from 'fhir/r4';

@Component({
  selector: 'app-guidelines',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    GuidelinesBrowserComponent,
    GuidelineEditorComponent,
    GuidelineTestingComponent,
    NewGuidelineModalComponent,
    ConversionModalComponent
  ],
  templateUrl: './guidelines.component.html',
  styleUrl: './guidelines.component.scss'
})
export class GuidelinesComponent implements OnInit, OnDestroy {
  @ViewChild(GuidelinesBrowserComponent) browserComponent?: GuidelinesBrowserComponent;
  
  protected readonly showBrowser = signal<boolean>(true);
  protected readonly showEditor = signal<boolean>(false);
  protected readonly showTesting = signal<boolean>(false);
  protected readonly showNewModal = signal<boolean>(false);
  protected readonly showConversionModal = signal<boolean>(false);
  protected readonly currentLibrary = signal<Library | null>(null);
  protected readonly conversionIssues = signal<string[]>([]);
  
  private routeSubscription?: Subscription;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    public libraryService: LibraryService,
    public settingsService: SettingsService,
    private guidelinesStateService: GuidelinesStateService,
    private guidelineValidationService: GuidelineValidationService,
    private translationService: TranslationService,
    private cqlGenerationService: CqlGenerationService
  ) {}

  ngOnInit(): void {
    // Subscribe to route parameter changes to handle navigation between editor and testing
    this.routeSubscription = this.route.paramMap.subscribe(params => {
      const libraryId = params.get('id');
      const urlSegments = this.route.snapshot.url;
      const isTestingRoute = urlSegments.length > 2 && urlSegments[urlSegments.length - 1].path === 'testing';
      
      if (libraryId) {
        if (isTestingRoute) {
          // Load library for testing
          this.libraryService.get(libraryId).subscribe({
            next: (library: Library) => {
              this.currentLibrary.set(library);
              this.showBrowser.set(false);
              this.showEditor.set(false);
              this.showTesting.set(true);
            },
            error: (error: any) => {
              console.error('Error loading library for testing:', error);
              // Stay on browser view
            }
          });
        } else {
          // Load library for editing
          this.loadAndOpenLibrary(libraryId);
        }
      } else {
        // No library ID, show browser
        this.showBrowser.set(true);
        this.showEditor.set(false);
        this.showTesting.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
    }
  }

  onOpenLibrary(library: Library): void {
    this.loadAndOpenLibrary(library.id!);
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

  private loadAndOpenLibrary(libraryId: string): void {
    this.libraryService.get(libraryId).subscribe({
      next: (library: Library) => {
        const validation = this.guidelineValidationService.validateGuidelineFormat(library);
        const canCleanlyOpen = this.guidelineValidationService.canCleanlyOpen(library);

        if (canCleanlyOpen) {
          // Cleanly open the library
          this.openLibrary(library);
        } else {
          // Show conversion modal
          this.currentLibrary.set(library);
          this.conversionIssues.set(validation.issues);
          this.showConversionModal.set(true);
        }
      },
      error: (error) => {
        console.error('Error loading library:', error);
        // Stay on browser view
      }
    });
  }

  onProceedWithConversion(): void {
    const library = this.currentLibrary();
    if (library) {
      this.openLibrary(library);
      this.showConversionModal.set(false);
    }
  }

  onCancelConversion(): void {
    this.showConversionModal.set(false);
    this.currentLibrary.set(null);
    this.conversionIssues.set([]);
  }

  private openLibrary(library: Library): void {
    this.currentLibrary.set(library);
    this.showBrowser.set(false);
    this.showEditor.set(true);
    this.router.navigate(['/guidelines', library.id], { replaceUrl: true });
  }

  onCreateNew(): void {
    this.showNewModal.set(true);
  }

  onNewGuidelineCreate(libraryData: Partial<Library>): void {
    this.showNewModal.set(false);

    // Create the library resource first
    // Use same ID generation as IDE
    const libraryId = libraryData.name!.replace(/[^a-zA-Z0-9-]/g, '-');

    // Initialize empty artifact
    this.guidelinesStateService.initializeEmptyArtifact();
    // Use libraryService.urlFor to generate URL (same as IDE)
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
      return;
    }

    // Generate initial CQL
    const cqlContent = this.cqlGenerationService.generateCql(artifact);

    // Translate to ELM
    const baseUrl = this.settingsService.getEffectiveTranslationBaseUrl();
    if (!baseUrl) {
      console.error('Translation service not configured');
      return;
    }

    this.translationService.translateCqlToElm(cqlContent, baseUrl).subscribe({
      next: (elmXml: string) => {
        // Ensure URL is properly set using libraryService.urlFor (same as IDE)
        const libraryUrl = this.libraryService.urlFor(libraryId);
        
        const newLibrary: Library = {
          resourceType: 'Library' as const,
          id: libraryId,
          name: libraryData.name!,
          title: libraryData.title || libraryData.name!,
          version: libraryData.version || '1.0.0',
          status: 'active' as const,
          url: libraryUrl, // Use libraryService.urlFor to match IDE behavior
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
              data: btoa(cqlContent)
            },
            {
              contentType: 'application/elm+xml',
              data: btoa(elmXml)
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

        this.libraryService.post(newLibrary).subscribe({
          next: (library: Library) => {
            this.openLibrary(library);
          },
          error: (error) => {
            console.error('Error creating library:', error);
          }
        });
      },
      error: (error) => {
        console.error('Error translating CQL:', error);
      }
    });
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

  onDeleteLibrary(library: Library): void {
    if (!library.id) {
      console.error('Cannot delete library: no ID');
      return;
    }

    this.libraryService.delete(library).subscribe({
      next: () => {
        // If we're currently viewing/editing this library, close it first
        if (this.currentLibrary()?.id === library.id) {
          this.showEditor.set(false);
          this.showTesting.set(false);
          this.currentLibrary.set(null);
          this.guidelinesStateService.reset();
        }
        
        // Reload the browser to refresh the list
        if (this.browserComponent) {
          this.browserComponent.loadLibraries();
        } else {
          // Fallback: navigate to trigger reload
          this.router.navigate(['/guidelines'], { replaceUrl: true });
        }
      },
      error: (error: any) => {
        console.error('Error deleting library:', error);
        const errorMessage = error?.message || error?.error?.message || 'Unknown error';
        alert(`Failed to delete library: ${errorMessage}`);
      }
    });
  }
}

