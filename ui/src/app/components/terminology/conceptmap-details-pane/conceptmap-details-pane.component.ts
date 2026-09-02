// Author: Preston Lee

import { Component, input, inject, ChangeDetectionStrategy } from '@angular/core';
import { ConceptMap } from 'fhir/r4';
import { ToastService } from '../../../services/toast.service';
import { downloadJson } from '../../../services/download-blob.lib';
import { formatFhirDate, terminologyDownloadFilename } from '../../../services/terminology-ui.lib';

@Component({
  selector: 'app-conceptmap-details-pane',
  imports: [],
  templateUrl: './conceptmap-details-pane.component.html',

  styleUrl: './conceptmap-details-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConceptMapDetailsPaneComponent {
  // Inputs
  selectedConceptMap = input<ConceptMap | null>(null);
  
  // Services
  private toastService = inject(ToastService);

  protected readonly formatFhirDate = formatFhirDate;

  isArray(value: any): boolean {
    return Array.isArray(value);
  }

  getIdentifiers(conceptMap: ConceptMap | null): any[] {
    if (!conceptMap?.identifier) return [];
    return Array.isArray(conceptMap.identifier) ? conceptMap.identifier : [conceptMap.identifier];
  }

  downloadConceptMap(conceptMap: ConceptMap): void {
    try {
      downloadJson(conceptMap, terminologyDownloadFilename('ConceptMap', conceptMap));
    } catch (error) {
      console.error('Failed to download ConceptMap:', error);
      this.toastService.showError('Failed to download ConceptMap', 'Download Error');
    }
  }
}

