// Author: Preston Lee

import { Component, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConceptMap } from 'fhir/r4';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-conceptmap-details-pane',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './conceptmap-details-pane.component.html',
  styleUrl: './conceptmap-details-pane.component.scss'
})
export class ConceptMapDetailsPaneComponent {
  // Inputs
  selectedConceptMap = input<ConceptMap | null>(null);
  
  // Services
  private toastService = inject(ToastService);

  formatDate(dateString?: string): string {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  }

  isArray(value: any): boolean {
    return Array.isArray(value);
  }

  getIdentifiers(conceptMap: ConceptMap | null): any[] {
    if (!conceptMap?.identifier) return [];
    return Array.isArray(conceptMap.identifier) ? conceptMap.identifier : [conceptMap.identifier];
  }

  downloadConceptMap(conceptMap: ConceptMap): void {
    try {
      const jsonString = JSON.stringify(conceptMap, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const filename = conceptMap.id 
        ? `ConceptMap-${conceptMap.id}.json`
        : conceptMap.url 
          ? `ConceptMap-${conceptMap.url.replace(/[^a-zA-Z0-9]/g, '_')}.json`
          : 'ConceptMap.json';
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download ConceptMap:', error);
      this.toastService.showError('Failed to download ConceptMap', 'Download Error');
    }
  }
}

