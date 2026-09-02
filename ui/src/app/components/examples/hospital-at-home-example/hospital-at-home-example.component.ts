// Author: Preston Lee

import { Component } from '@angular/core';
import { ExampleImportCtaComponent } from '../example-import-cta/example-import-cta.component';
import { findExampleById } from '../examples.catalog';

@Component({
  selector: 'app-hospital-at-home-example',
  imports: [ExampleImportCtaComponent],
  templateUrl: './hospital-at-home-example.component.html'
})
export class HospitalAtHomeExampleComponent {
  protected readonly example = findExampleById('hospital-at-home')!;
}
