// Author: Preston Lee

import { Component, OnInit, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Workspace } from '../../../models/team.model';
import { WorkspaceService } from '../../../services/workspace.service';
import { WorkspaceCreateModalComponent } from '../workspace-create-modal/workspace-create-modal.component';

function isEditableWorkspace(ws: Workspace): boolean {
  return ws.myRole === 'OWNER' || ws.myRole === 'EDITOR';
}

@Component({
  selector: 'app-add-to-workspaces-panel',
  standalone: true,
  imports: [FormsModule, WorkspaceCreateModalComponent],
  templateUrl: './add-to-workspaces-panel.component.html',
})
export class AddToWorkspacesPanelComponent implements OnInit {
  private readonly workspaceService = inject(WorkspaceService);

  readonly idPrefix = input('add-to-workspaces');
  /** Selected workspace ids (two-way). */
  readonly selectedWorkspaceIds = model<string[]>([]);

  readonly workspaces = signal<Workspace[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly showCreateModal = signal(false);

  readonly editableWorkspaces = computed(() => this.workspaces().filter(isEditableWorkspace));

  readonly selectedCount = computed(() => this.selectedWorkspaceIds().length);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const list = await this.workspaceService.list();
      this.workspaces.set(list);
      const editableIds = new Set(list.filter(isEditableWorkspace).map((w) => w.id));
      this.selectedWorkspaceIds.update((ids) => ids.filter((id) => editableIds.has(id)));
    } catch (e) {
      this.error.set((e as Error).message || 'Failed to load workspaces');
      this.workspaces.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  isSelected(workspaceId: string): boolean {
    return this.selectedWorkspaceIds().includes(workspaceId);
  }

  toggleWorkspace(workspaceId: string, checked: boolean): void {
    this.selectedWorkspaceIds.update((ids) => {
      if (checked) {
        return ids.includes(workspaceId) ? ids : [...ids, workspaceId];
      }
      return ids.filter((id) => id !== workspaceId);
    });
  }

  openCreateModal(): void {
    this.showCreateModal.set(true);
  }

  onWorkspaceCreated(ws: Workspace): void {
    this.workspaces.update((list) => {
      if (list.some((w) => w.id === ws.id)) {
        return list;
      }
      return [{ ...ws, myRole: ws.myRole ?? 'OWNER' }, ...list];
    });
    this.selectedWorkspaceIds.update((ids) =>
      ids.includes(ws.id) ? ids : [...ids, ws.id]
    );
  }
}
