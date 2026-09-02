// Author: Preston Lee

import { Component } from '@angular/core';
import { ExampleImportCtaComponent } from '../example-import-cta/example-import-cta.component';
import { findExampleById } from '../examples.catalog';

@Component({
  selector: 'app-lipid-management-example',
  imports: [ExampleImportCtaComponent],
  templateUrl: './lipid-management-example.component.html'
})
export class LipidManagementExampleComponent {
  protected readonly example = findExampleById('lipid-management')!;
}
