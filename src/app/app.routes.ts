// Author: Preston Lee

import { Routes } from '@angular/router';
import { CqlIdeComponent } from './components/cql-ide/cql-ide.component';
import { IdeLayoutComponent } from './components/ide-layout/ide-layout.component';
import { OpenComponent } from './components/open/open.component';
import { ResultsViewerComponent } from './components/results-viewer/results-viewer.component';
import { ResultsDocumentationComponent } from './components/results-documentation/results-documentation.component';
import { RunnerDocumentationComponent } from './components/runner-documentation/runner-documentation.component';
import { SettingsComponent } from './components/settings/settings.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { RunnerComponent } from './components/runner/runner.component';
import { FhirUploaderComponent } from './components/fhir-uploader/fhir-uploader.component';
import { TerminologyLayoutComponent } from './components/terminology/terminology-layout.component';
import { ValueSetsTabComponent } from './components/terminology/valuesets-tab/valuesets-tab.component';
import { ConceptMapsTabComponent } from './components/terminology/conceptmaps-tab/conceptmaps-tab.component';
import { CodeSystemsTabComponent } from './components/terminology/codesystems-tab/codesystems-tab.component';
import { ValidationTabComponent } from './components/terminology/validation-tab/validation-tab.component';
import { AboutComponent } from './components/about/about.component';
import { LandingComponent } from './components/landing/landing.component';
import { GuidelinesComponent } from './components/guidelines/guidelines.component';

export const routes: Routes = [
  // Normal app routes
  { path: '', component: LandingComponent, pathMatch: 'full' },
  { path: 'results/open', component: OpenComponent },
  { path: 'results', component: ResultsViewerComponent },
  { path: 'documentation', redirectTo: '/documentation/results', pathMatch: 'full' },
  { path: 'documentation/results', component: ResultsDocumentationComponent },
  { path: 'documentation/runner', component: RunnerDocumentationComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'runner', component: RunnerComponent },
  { path: 'uploader', component: FhirUploaderComponent },
  { 
    path: 'terminology', 
    component: TerminologyLayoutComponent,
    children: [
      { path: '', redirectTo: 'valuesets', pathMatch: 'full' },
      { path: 'valuesets', component: ValueSetsTabComponent },
      { path: 'conceptmaps', component: ConceptMapsTabComponent },
      { path: 'codesystems', component: CodeSystemsTabComponent },
      { path: 'validation', component: ValidationTabComponent }
    ]
  },
  { path: 'guidelines', component: GuidelinesComponent },
  { path: 'guidelines/:id/testing', component: GuidelinesComponent },
  { path: 'guidelines/:id', component: GuidelinesComponent },
  { path: 'about', component: AboutComponent },
  
  // IDE routes with separate layout
  { 
    path: 'ide', 
    component: IdeLayoutComponent,
    children: [
      { path: '', component: CqlIdeComponent },
      { path: 'results', component: CqlIdeComponent },
      { path: 'documentation', component: CqlIdeComponent },
      { path: 'documentation/results', component: CqlIdeComponent },
      { path: 'documentation/runner', component: CqlIdeComponent },
      { path: 'settings', component: CqlIdeComponent },
      { path: 'dashboard', component: CqlIdeComponent },
      { path: 'runner', component: CqlIdeComponent }
    ]
  },
  
  { path: '**', redirectTo: '' }
];
