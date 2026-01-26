// Author: Preston Lee

import { Component, signal, inject } from '@angular/core';
import { RouterOutlet, Router, ActivatedRoute } from '@angular/router';

import { FormsModule } from '@angular/forms';
import { NavigationComponent } from './components/navigation/navigation.component';
import { SettingsService } from './services/settings.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule, NavigationComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('CQL Studio');

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected settingsService = inject(SettingsService);

  constructor() {
    // Check for URL query parameters only on initial load
    // Use snapshot to avoid subscribing to every query parameter change
    const params = this.route.snapshot.queryParams;
    if (params['url']) {
      // If there's a URL parameter, navigate directly to results
      this.router.navigate(['/results'], { queryParams: params });
    }
  }

}