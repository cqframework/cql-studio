// Author: Preston Lee

import { Component, signal } from '@angular/core';

import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SessionStorageKeys } from '../../constants/session-storage.constants';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss'
})
export class NavigationComponent {
  protected readonly title = signal('CQL Studio');
  protected readonly showFileMenu = signal(false);

  constructor(private router: Router, protected settingsService: SettingsService) {
    // Listen to route changes to update the signal
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        // Show file menu only on the results-viewer component (not on /results/open)
        const baseUrl = event.url.split('?')[0]; // Remove query parameters for comparison
        this.showFileMenu.set(baseUrl === '/results');
      });
  }

  onOpenNew(): void {
    // Clear any stored data and navigate to home
    sessionStorage.removeItem(SessionStorageKeys.CQL_TEST_RESULTS);
    sessionStorage.removeItem(SessionStorageKeys.VALIDATION_ERRORS);
    sessionStorage.removeItem(SessionStorageKeys.INITIAL_STATUS);
    sessionStorage.removeItem(SessionStorageKeys.INITIAL_SEARCH);
    sessionStorage.removeItem(SessionStorageKeys.ORIGINAL_FILENAME);
    this.router.navigate(['/results/open']);
  }

  onDownloadResults(): void {
    const storedData = sessionStorage.getItem(SessionStorageKeys.CQL_TEST_RESULTS);
    if (storedData) {
      try {
        // Parse and re-stringify to ensure valid JSON formatting
        const data = JSON.parse(storedData);
        const jsonString = JSON.stringify(data, null, 2);
        
        // Get the original filename or use default
        const originalFilename = sessionStorage.getItem(SessionStorageKeys.ORIGINAL_FILENAME) || 'cql-test-results.json';
        
        // Create a blob and download it
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = originalFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Error downloading results:', error);
      }
    }
  }

  goBackToIndex(): void {
    const indexUrl = sessionStorage.getItem(SessionStorageKeys.INDEX_URL);
    if (indexUrl) {
      this.router.navigate(['/results/open'], { queryParams: { index: indexUrl } });
    } else {
      this.router.navigate(['/results/open']);
    }
  }

  hasIndexUrl(): boolean {
    return !!sessionStorage.getItem(SessionStorageKeys.INDEX_URL);
  }
}
