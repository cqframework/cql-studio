// Author: Preston Lee

import { Injectable } from '@angular/core';
import { BrowserToolsRegistry } from './tools';
import type { MCPTool } from './ai.service';

@Injectable({
  providedIn: 'root'
})
export class ToolPolicyService {

  /**
   * Build the set of tool names allowed in Plan Mode (read-only).
   * Derived from browser tool metadata and server tool metadata.
   */
  getPlanModeAllowedTools(serverTools: MCPTool[]): Set<string> {
    const allowed = new Set<string>();
    for (const C of BrowserToolsRegistry.toolClasses) {
      const cls = C as { id: string; planModeAllowed?: boolean };
      if (cls.planModeAllowed === true) {
        allowed.add(cls.id);
      }
    }
    for (const t of serverTools) {
      if (t.allowedInPlanMode !== false) {
        allowed.add(t.name);
      }
    }
    return allowed;
  }

  /**
   * Build the set of tool names blocked in Plan Mode (modification tools).
   */
  getPlanModeBlockedTools(serverTools: MCPTool[]): Set<string> {
    const blocked = new Set<string>();
    for (const C of BrowserToolsRegistry.toolClasses) {
      const cls = C as { id: string; planModeAllowed?: boolean };
      if (cls.planModeAllowed === false) {
        blocked.add(cls.id);
      }
    }
    for (const t of serverTools) {
      if (t.allowedInPlanMode === false) {
        blocked.add(t.name);
      }
    }
    return blocked;
  }

  /**
   * Build status messages for all tools (browser + server).
   */
  getToolStatusMessages(serverTools: MCPTool[]): Record<string, string> {
    const messages: Record<string, string> = {};
    for (const C of BrowserToolsRegistry.toolClasses) {
      const cls = C as { id: string; statusMessage?: string };
      if (cls.statusMessage) {
        messages[cls.id] = cls.statusMessage;
      }
    }
    for (const t of serverTools) {
      if (t.statusMessage) {
        messages[t.name] = t.statusMessage;
      }
    }
    return messages;
  }
}
