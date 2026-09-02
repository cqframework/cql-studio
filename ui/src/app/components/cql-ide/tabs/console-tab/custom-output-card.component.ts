// Author: Preston Lee

import {Component, ChangeDetectionStrategy, input} from '@angular/core';
import { DatePipe } from '@angular/common';
import { OutputSection } from '../../shared/ide-types';

@Component({
  selector: 'app-custom-output-card',
  imports: [DatePipe],
  templateUrl: './custom-output-card.component.html',

  styleUrls: ['./custom-output-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomOutputCardComponent {
  section = input.required<OutputSection>();

  getCardIcon(): string {
    switch (this.section().type) {
      case 'cql-execution':
        return 'bi-play-circle-fill';
      case 'cql-translation':
        return 'bi-translate';
      case 'cql-validation':
        return 'bi-check-circle-fill';
      default:
        return 'bi-card-text';
    }
  }

  getStatusBadgeClass(): string {
    switch (this.section().status) {
      case 'success':
        return 'text-bg-success';
      case 'error':
        return 'text-bg-danger';
      case 'pending':
        return 'text-bg-warning';
      default:
        return 'text-bg-secondary';
    }
  }

  getCardType(): string {
    const section = this.section();
    if (section.metadata?.['libraryName'] && section.metadata?.['patientName']) {
      return 'cql-execution';
    } else if (section.metadata?.['cqlVersion'] && section.metadata?.['contentType'] === 'elm') {
      return 'cql-translation';
    } else if (section.metadata?.['validationType'] === 'cql') {
      return 'cql-validation';
    }
    return 'default';
  }
}
