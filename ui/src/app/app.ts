// Author: Preston Lee

import { Component, signal, inject, viewChildren, ElementRef, effect, afterNextRender, Injector } from '@angular/core';
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
export class App {
  protected readonly title = signal('CQL Studio');

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected settingsService = inject(SettingsService);
  protected toastService = inject(ToastService);
  private injector = inject(Injector);

  toastElements = viewChildren<ElementRef<HTMLElement>>('toastElement');

  constructor() {
    const params = this.route.snapshot.queryParams;
    if (params['url']) {
      this.router.navigate(['/results'], { queryParams: params });
    }

    effect(() => {
      const elements = this.toastElements();
      afterNextRender(() => this.initializeToasts(elements), { injector: this.injector });
    });
  }

  private initializeToasts(elements: readonly ElementRef<HTMLElement>[]): void {
    const bootstrap = (window as any).bootstrap;
    if (bootstrap && bootstrap.Toast) {
      elements.forEach(toastRef => {
        const element = toastRef.nativeElement;
        if (!element.dataset['bsToastInitialized']) {
          const autohideAttr = element.dataset['bsAutohide'];
          const delayAttr = element.dataset['bsDelay'];
          
          const autohide = autohideAttr !== 'false';
          const delay = delayAttr ? parseInt(delayAttr, 10) : 5000;

          const toastOptions: any = {
            autohide: autohide
          };
          
          if (autohide) {
            toastOptions.delay = delay;
          }

          const toast = new bootstrap.Toast(element, toastOptions);

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
  }

  getToastClass(type: string): string {
    return this.toastService.getToastClassForType(type as any);
  }

  getToastIcon(type: string): string {
    return this.toastService.getBootstrapIconForType(type as any);
  }
}
