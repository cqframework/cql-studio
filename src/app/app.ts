// Author: Preston Lee

import { Component, signal, inject, AfterViewInit, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { RouterOutlet, Router, ActivatedRoute } from '@angular/router';

import { FormsModule } from '@angular/forms';
import { NavigationComponent } from './components/navigation/navigation.component';
import { SettingsService } from './services/settings.service';
import { ToastService } from './services/toast.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule, NavigationComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements AfterViewInit {
  protected readonly title = signal('CQL Studio');

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected settingsService = inject(SettingsService);
  protected toastService = inject(ToastService);

  @ViewChildren('toastElement') toastElements!: QueryList<ElementRef<HTMLElement>>;

  constructor() {
    // Check for URL query parameters only on initial load
    // Use snapshot to avoid subscribing to every query parameter change
    const params = this.route.snapshot.queryParams;
    if (params['url']) {
      // If there's a URL parameter, navigate directly to results
      this.router.navigate(['/results'], { queryParams: params });
    }
  }

  ngAfterViewInit(): void {
    // Initialize Bootstrap toasts when they're added to the DOM
    this.toastElements.changes.subscribe(() => {
      this.initializeToasts();
    });
    // Initialize any existing toasts
    this.initializeToasts();
  }

  private initializeToasts(): void {
    // Use setTimeout to ensure DOM is updated
    setTimeout(() => {
      const bootstrap = (window as any).bootstrap;
      if (bootstrap && bootstrap.Toast) {
        this.toastElements.forEach(toastRef => {
          const element = toastRef.nativeElement;
          // Only initialize if not already initialized
          if (!element.dataset['bsToastInitialized']) {
            // Bootstrap automatically reads data-bs-autohide and data-bs-delay from attributes
            // We can also pass options directly, but using data attributes is cleaner
            // When autohide is false, delay is ignored by Bootstrap
            const autohideAttr = element.dataset['bsAutohide'];
            const delayAttr = element.dataset['bsDelay'];
            
            const autohide = autohideAttr !== 'false';
            const delay = delayAttr ? parseInt(delayAttr, 10) : 5000;

            const toastOptions: any = {
              autohide: autohide
            };
            
            // Only include delay option when autohide is true
            // Bootstrap validates that delay must be a number if provided
            if (autohide) {
              toastOptions.delay = delay;
            }

            const toast = new bootstrap.Toast(element, toastOptions);

            // Bootstrap fires hidden.bs.toast when toast is completely hidden
            // This happens both for autohide and manual dismissal
            element.addEventListener('hidden.bs.toast', () => {
              const toastId = element.id;
              if (toastId) {
                this.toastService.remove(toastId);
              }
            });

            toast.show();
            element.dataset['bsToastInitialized'] = 'true';
          }
        });
      }
    }, 0);
  }

  getToastClass(type: string): string {
    return this.toastService.getToastClassForType(type as any);
  }

  getToastIcon(type: string): string {
    return this.toastService.getBootstrapIconForType(type as any);
  }
}