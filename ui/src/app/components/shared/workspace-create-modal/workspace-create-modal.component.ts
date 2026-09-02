// Author: Preston Lee

import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Workspace, WorkspaceVisibility } from '../../../models/team.model';
import { WorkspaceService } from '../../../services/workspace.service';
import { EnvironmentSwitchService } from '../../../services/environment-switch.service';

@Component({
  selector: 'app-workspace-create-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './workspace-create-modal.component.html',
})
export class WorkspaceCreateModalComponent {
  private readonly workspaceService = inject(WorkspaceService);
  private readonly environmentSwitchService = inject(EnvironmentSwitchService);

  readonly open = model(false);
  readonly idPrefix = input('workspace-create');

  readonly created = output<Workspace>();
  readonly closed = output<void>();

  readonly name = signal('');
  readonly description = signal('');
  readonly visibility = signal<WorkspaceVisibility>('PRIVATE');
  readonly error = signal('');
  readonly saving = signal(false);

  close(): void {
    this.error.set('');
    this.saving.set(false);
    this.open.set(false);
    this.closed.emit();
  }

  async submit(): Promise<void> {
    const name = this.name().trim();
    if (!name || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.error.set('');
    try {
      const ws = await this.workspaceService.create({
        name,
        description: this.description().trim() || undefined,
        visibility: this.visibility(),
      });
      this.name.set('');
      this.description.set('');
      this.visibility.set('PRIVATE');
      this.error.set('');
      this.open.set(false);
      await this.environmentSwitchService.reloadWorkspaceCatalog();
      this.created.emit(ws);
    } catch (e) {
      this.error.set((e as Error).message || 'Failed to create workspace');
    } finally {
      this.saving.set(false);
    }
  }
}
