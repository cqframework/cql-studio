// Author: Preston Lee

import { Component, input, inject, ChangeDetectionStrategy } from '@angular/core';
import { CodeSystem } from 'fhir/r4';
import { ToastService } from '../../../services/toast.service';
import { downloadJson } from '../../../services/download-blob.lib';
import { formatFhirDate, terminologyDownloadFilename } from '../../../services/terminology-ui.lib';

@Component({
  selector: 'app-codesystem-details-pane',
  imports: [],
  templateUrl: './codesystem-details-pane.component.html',

  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeSystemDetailsPaneComponent {
  readonly selectedCodeSystem = input<CodeSystem | null>(null);

  private readonly toastService = inject(ToastService);

  protected readonly formatFhirDate = formatFhirDate;

  downloadCodeSystem(codeSystem: CodeSystem): void {
    try {
      downloadJson(codeSystem, terminologyDownloadFilename('CodeSystem', codeSystem));
    } catch (error) {
      console.error('Failed to download CodeSystem:', error);
      this.toastService.showError('Failed to download CodeSystem', 'Download Error');
    }
  }
}
