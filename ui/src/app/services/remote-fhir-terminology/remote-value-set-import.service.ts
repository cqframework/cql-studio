// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Bundle, Resource, ValueSet } from 'fhir/r4';
import { isReadOnlyTerminologyEndpointUrl } from '@cql-studio/core';
import { SettingsService } from '../settings.service';
import { TerminologyService } from '../terminology.service';

@Injectable({
  providedIn: 'root'
})
export class RemoteValueSetImportService {
  private terminology = inject(TerminologyService);
  private settings = inject(SettingsService);

  terminologyEndpointIsReadOnly(): boolean {
    return isReadOnlyTerminologyEndpointUrl(this.settings.getEffectiveTerminologyEndpointAddress());
  }

  async postValueSet(toSend: ValueSet): Promise<void> {
    const collection: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: toSend as Resource }]
    };
    await firstValueFrom(this.terminology.postBundle(collection));
  }
}
