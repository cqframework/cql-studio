// Author: Preston Lee

import { Component, Input, Output, EventEmitter, OnDestroy, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SummaryComponent } from '../builder/summary/summary.component';
import { FunctionsComponent } from '../builder/functions/functions.component';
import { InclusionsComponent } from '../builder/inclusions/inclusions.component';
import { ExclusionsComponent } from '../builder/exclusions/exclusions.component';
import { SubpopulationsComponent } from '../builder/subpopulations/subpopulations.component';
import { BaseElementsComponent } from '../builder/base-elements/base-elements.component';
import { RecommendationsComponent } from '../builder/recommendations/recommendations.component';
import { ParametersComponent } from '../builder/parameters/parameters.component';
import { ErrorStatementComponent } from '../builder/error-statement/error-statement.component';
import { ExternalCqlComponent } from '../builder/external-cql/external-cql.component';
import { LibraryService } from '../../../services/library.service';
import { SettingsService } from '../../../services/settings.service';
import { GuidelinesStateService } from '../../../services/guidelines-state.service';
import { TranslationService } from '../../../services/translation.service';
import { CqlGenerationService } from '../../../services/cql-generation.service';
import { CqlParsingService } from '../../../services/cql-parsing.service';
import { Library } from 'fhir/r4';

@Component({
  selector: 'app-guideline-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SummaryComponent,
    FunctionsComponent,
    InclusionsComponent,
    ExclusionsComponent,
    SubpopulationsComponent,
    BaseElementsComponent,
    RecommendationsComponent,
    ParametersComponent,
    ErrorStatementComponent,
    ExternalCqlComponent
  ],
  templateUrl: './guideline-editor.component.html',
  styleUrl: './guideline-editor.component.scss'
})
export class GuidelineEditorComponent implements OnInit, OnDestroy {
  @Input() library!: Library;
  @Output() close = new EventEmitter<void>();

  protected readonly activeTab = signal<string>('summary');
  protected readonly tabMetadata = computed(() => this.guidelinesStateService.getTabMetadata());
  protected readonly statusMessage = signal<string>('');
  protected readonly isSaving = computed(() => this.guidelinesStateService.isSaving());
  protected readonly isDirty = computed(() => this.guidelinesStateService.isDirty());
  protected readonly error = computed(() => this.guidelinesStateService.error());
  protected readonly artifact = computed(() => this.guidelinesStateService.artifact());
  protected readonly cqlPreview = computed(() => {
    const artifact = this.artifact();
    if (!artifact) {
      return '';
    }
    return this.cqlGenerationService.generateCql(artifact);
  });

  constructor(
    private router: Router,
    private libraryService: LibraryService,
    public settingsService: SettingsService,
    private guidelinesStateService: GuidelinesStateService,
    private translationService: TranslationService,
    private cqlGenerationService: CqlGenerationService,
    private cqlParsingService: CqlParsingService
  ) {}

  ngOnInit(): void {
    // Load the library into the state service
    this.loadLibrary();
  }

  private loadLibrary(): void {
    this.guidelinesStateService.setLoading(true);
    this.guidelinesStateService.setError(null);
    this.guidelinesStateService.setLibrary(this.library);
    this.guidelinesStateService.setActiveLibraryId(this.library.id || null);

    // Extract CQL content
    let cqlContent = '';
    if (this.library.content) {
      for (const content of this.library.content) {
        if (content.contentType === 'text/cql' && content.data) {
          try {
            cqlContent = atob(content.data);
            break;
          } catch (e) {
            console.error('Error decoding CQL content:', e);
          }
        }
      }
    }

    // Try to parse CQL into visual builder model
    let artifact = null;
    if (cqlContent) {
      artifact = this.cqlParsingService.parseCql(cqlContent);
    }

    // Check for visual builder metadata in extension
    if (this.library.extension) {
      const metadataExt = this.library.extension.find(
        ext => ext.url === 'http://cqframework.org/fhir/StructureDefinition/guidelines-builder-metadata'
      );
      if (metadataExt && metadataExt.valueString) {
        try {
          artifact = JSON.parse(metadataExt.valueString);
        } catch (e) {
          console.error('Error parsing visual builder metadata:', e);
        }
      }
    }

    if (artifact) {
      // Update metadata from library if not in parsed artifact
      // Ensure URL is set using libraryService.urlFor (same as IDE)
      const libraryUrl = this.library.url || (this.library.id ? this.libraryService.urlFor(this.library.id) : '');
      
      if (this.library.name && !artifact.metadata?.name) {
        artifact.metadata = {
          ...artifact.metadata,
          name: this.library.name,
          title: this.library.title || this.library.name,
          version: this.library.version || '1.0.0', // Ensure version is never null
          description: this.library.description || artifact.metadata?.description,
          url: libraryUrl || artifact.metadata?.url || ''
        };
      } else if (artifact.metadata) {
        // Ensure URL and version are set even if metadata exists
        artifact.metadata.url = artifact.metadata.url || libraryUrl || '';
        artifact.metadata.version = artifact.metadata.version || this.library.version || '1.0.0';
      }
      this.guidelinesStateService.setArtifact(artifact);
    } else {
      // Fallback: initialize empty artifact with library metadata
      this.guidelinesStateService.initializeEmptyArtifact();
      if (this.library.name) {
        const libraryUrl = this.library.url || (this.library.id ? this.libraryService.urlFor(this.library.id) : '');
        this.guidelinesStateService.updateMetadata({
          name: this.library.name,
          title: this.library.title || this.library.name,
          version: this.library.version || '1.0.0', // Ensure version is never null
          description: this.library.description,
          url: libraryUrl
        });
      }
    }

    this.guidelinesStateService.setLoading(false);
  }

  ngOnDestroy(): void {
    // Auto-save on unmount if dirty (similar to CDS Connect)
    if (this.isDirty()) {
      this.saveGuideline(false);
    }
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
  }

  saveGuideline(showMessage: boolean = true): void {
    const artifact = this.artifact();
    if (!artifact) {
      this.guidelinesStateService.setError('No guideline to save');
      return;
    }

    // Validate required fields before saving
    const metadata = artifact.metadata || {};
    const name = metadata.name?.trim();
    const version = metadata.version?.trim();
    
    if (!name) {
      this.guidelinesStateService.setError('Library name is required. Please set it in the metadata fields above.');
      return;
    }
    
    if (!version) {
      this.guidelinesStateService.setError('Library version is required. Please set it in the metadata fields above.');
      return;
    }

    this.guidelinesStateService.setSaving(true);
    this.guidelinesStateService.setError(null);
    if (showMessage) {
      this.statusMessage.set('Saving guideline...');
    }

    // Generate CQL from visual model using CqlGenerationService
    const cqlContent = this.cqlGenerationService.generateCql(artifact);

    // Translate to ELM for validation
    const baseUrl = this.settingsService.getEffectiveTranslationBaseUrl();
    if (!baseUrl) {
      this.guidelinesStateService.setError('Translation service not configured');
      this.guidelinesStateService.setSaving(false);
      return;
    }

    this.translationService.translateCqlToElm(cqlContent, baseUrl).subscribe({
      next: (elmXml: string) => {
        // Update existing library
        this.updateLibrary(this.library, cqlContent, elmXml, artifact);
      },
      error: (error) => {
        const errorMessage = this.getErrorMessage(error);
        this.guidelinesStateService.setError(`Translation failed: ${errorMessage}`);
        this.guidelinesStateService.setSaving(false);
        if (showMessage) {
          this.statusMessage.set('Save failed');
        }
      }
    });
  }

  private updateLibrary(library: Library, cqlContent: string, elmXml: string, artifact: any): void {
    const metadata = artifact.metadata || {};
    
    // Use metadata.url if provided (user-edited), otherwise fall back to library.url or generate
    // This allows users to edit the URL after creation while ensuring it's always set
    const libraryUrl = metadata.url?.trim() || library.url || this.libraryService.urlFor(library.id || '');
    
    // Ensure required fields are set (same as IDE)
    const updatedLibrary: Library = {
      ...library,
      name: metadata.name || library.name || 'UnnamedLibrary',
      title: metadata.title || library.title || metadata.name || library.name,
      version: metadata.version || library.version || '1.0.0', // Ensure version is never null
      url: libraryUrl, // Use user-edited URL if provided, otherwise use existing or generate
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
      extension: [
        ...(library.extension || []).filter(ext => 
          ext.url !== 'http://cqframework.org/fhir/StructureDefinition/guidelines-builder-metadata'
        ),
        {
          url: 'http://cqframework.org/fhir/StructureDefinition/guidelines-builder-metadata',
          valueString: JSON.stringify(artifact)
        }
      ]
    };
    
    // Update description if provided
    if (metadata.description !== undefined) {
      updatedLibrary.description = metadata.description;
    }

    this.libraryService.put(updatedLibrary).subscribe({
      next: (library: Library) => {
        this.guidelinesStateService.setLibrary(library);
        this.guidelinesStateService.clearDirty();
        this.guidelinesStateService.setSaving(false);
        this.statusMessage.set('Guideline saved successfully');
        setTimeout(() => this.statusMessage.set(''), 3000);
      },
      error: (error) => {
        const errorMessage = this.getErrorMessage(error);
        this.guidelinesStateService.setError(`Save failed: ${errorMessage}`);
        this.guidelinesStateService.setSaving(false);
        this.statusMessage.set('Save failed');
      }
    });
  }

  private getErrorMessage(error: any): string {
    if (error?.status === 401 || error?.status === 403) {
      return 'Authentication failed. Please check your settings.';
    }
    if (error?.status === 404) {
      return 'Resource not found.';
    }
    if (error?.status >= 500) {
      return 'Server error. Please try again later.';
    }
    return error?.message || 'An unexpected error occurred.';
  }

  onMetadataChange(field: string, value: string): void {
    const updates: any = {};
    updates[field] = value;
    this.guidelinesStateService.updateMetadata(updates);
  }

  onClose(): void {
    this.close.emit();
  }

  onTest(): void {
    if (this.library?.id) {
      this.router.navigate(['/guidelines', this.library.id, 'testing']);
    }
  }
}

