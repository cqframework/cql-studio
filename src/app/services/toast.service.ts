// Author: Preston Lee

import { Injectable, signal } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  title?: string;
  message: string;
  type: ToastType;
  duration: number; // milliseconds, 0 = no auto-hide
}

export interface ToastOptions {
  title?: string;
  message: string;
  type?: ToastType;
  duration?: number; // milliseconds, 0 = no auto-hide (default 5000ms)
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  public readonly toasts = this._toasts.asReadonly();

  private getBootstrapIcon(type: ToastType): string {
    switch (type) {
      case 'success':
        return 'bi-check-circle';
      case 'error':
        return 'bi-x-circle';
      case 'warning':
        return 'bi-exclamation-triangle';
      case 'info':
        return 'bi-info-circle';
      default:
        return 'bi-info-circle';
    }
  }

  getBootstrapIconForType(type: ToastType): string {
    return this.getBootstrapIcon(type);
  }

  private getToastClass(type: ToastType): string {
    switch (type) {
      case 'success':
        return 'text-bg-success';
      case 'error':
        return 'text-bg-danger';
      case 'warning':
        return 'text-bg-warning';
      case 'info':
        return 'text-bg-info';
      default:
        return 'text-bg-info';
    }
  }

  getToastClassForType(type: ToastType): string {
    return this.getToastClass(type);
  }

  show(options: ToastOptions): void {
    const type = options.type || 'info';
    const duration = options.duration ?? 5000; // Default 5 seconds (Bootstrap default)

    const toast: Toast = {
      id: uuidv4(),
      title: options.title,
      message: options.message,
      type,
      duration
    };

    // Add toast to the signal
    // Bootstrap will handle autohide and fire hidden.bs.toast event
    // The app component will listen to that event and call remove()
    this._toasts.update(toasts => [...toasts, toast]);
  }

  remove(id: string): void {
    this._toasts.update(toasts => toasts.filter(t => t.id !== id));
  }

  showSuccess(message: string, title?: string, duration?: number): void {
    this.show({ message, title, type: 'success', duration });
  }

  showError(message: string, title?: string, duration?: number): void {
    this.show({ message, title, type: 'error', duration });
  }

  showWarning(message: string, title?: string, duration?: number): void {
    this.show({ message, title, type: 'warning', duration });
  }

  showInfo(message: string, title?: string, duration?: number): void {
    this.show({ message, title, type: 'info', duration });
  }
}
