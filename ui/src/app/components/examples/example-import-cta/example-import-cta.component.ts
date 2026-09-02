// Author: Preston Lee

import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  FHIR_REGISTRY_IMPORTER_QUERY_PACKAGE,
  FHIR_REGISTRY_IMPORTER_QUERY_SOURCE,
  FHIR_REGISTRY_IMPORTER_QUERY_URL,
  FHIR_REGISTRY_IMPORTER_QUERY_VERSION,
  FHIR_REGISTRY_IMPORTER_SOURCE_URL
} from '../../fhir-registry-importer/fhir-registry-importer.deep-link';

@Component({
  selector: 'app-example-import-cta',
  imports: [RouterLink],
  templateUrl: './example-import-cta.component.html'
})
export class ExampleImportCtaComponent {
  readonly packageId = input('');
  readonly packageVersion = input('');
  readonly packageUrl = input('');
  readonly buttonId = input('example-import-cta');

  protected queryParams(): Record<string, string> {
    const url = this.packageUrl().trim();
    if (url) {
      return {
        [FHIR_REGISTRY_IMPORTER_QUERY_SOURCE]: FHIR_REGISTRY_IMPORTER_SOURCE_URL,
        [FHIR_REGISTRY_IMPORTER_QUERY_URL]: url
      };
    }
    const params: Record<string, string> = {
      [FHIR_REGISTRY_IMPORTER_QUERY_PACKAGE]: this.packageId()
    };
    const version = this.packageVersion().trim();
    if (version) {
      params[FHIR_REGISTRY_IMPORTER_QUERY_VERSION] = version;
    }
    return params;
  }
}
