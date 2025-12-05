// Author: Preston Lee

import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConceptMap } from 'fhir/r4';

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
}

