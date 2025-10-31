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
import { TerminologyComponent } from './components/terminology/terminology.component';
import { AboutComponent } from './components/about/about.component';
import { LandingComponent } from './components/landing/landing.component';

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
  { path: 'terminology', component: TerminologyComponent },
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
