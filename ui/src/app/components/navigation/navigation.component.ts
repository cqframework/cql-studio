// Author: Preston Lee

import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { SessionStorageKeys } from '../../constants/session-storage.constants';
import { SettingsService } from '../../services/settings.service';
import { EnvironmentService } from '../../services/environment.service';
import { EnvironmentSwitchService } from '../../services/environment-switch.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './navigation.component.html',

  styleUrl: './navigation.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationComponent {
  protected readonly title = signal('CQL Studio');

  private readonly router = inject(Router);
  protected readonly settingsService = inject(SettingsService);
  protected readonly environmentService = inject(EnvironmentService);
  private readonly environmentSwitchService = inject(EnvironmentSwitchService);
  protected readonly authService = inject(AuthService);

  private readonly navUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects.split('?')[0]),
    ),
    { initialValue: this.router.url.split('?')[0] }
  );

  protected readonly showFileMenu = computed(() => this.navUrl() === '/results');

  readonly activeEnvironmentName = computed(() => this.environmentService.activeEnvironment().name);
  readonly workspaceEnvironmentSections = this.environmentService.workspaceCatalogWithEnvironments;

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

  activateEnvironment(id: string): void {
    this.environmentSwitchService.activateEnvironment(id);
  }

  activateWorkspaceEnvironment(workspaceId: string, environmentId: string): void {
    this.environmentSwitchService.activateWorkspaceEnvironment(workspaceId, environmentId);
  }

  isPersonalEnvironmentSelected(id: string): boolean {
    return this.environmentService.isPersonalEnvironmentSelected(id);
  }

  isWorkspaceEnvironmentSelected(workspaceId: string, environmentId: string): boolean {
    return this.environmentService.isWorkspaceEnvironmentSelected(workspaceId, environmentId);
  }

  async signOut(): Promise<void> {
    this.environmentSwitchService.clearWorkspaceCatalog();
    await this.authService.logout();
    await this.router.navigate(['/']);
  }
}
