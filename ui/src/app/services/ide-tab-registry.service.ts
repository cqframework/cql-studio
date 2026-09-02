// Author: Preston Lee

import { Injectable, Type } from '@angular/core';
import { IdePanelTab } from '../components/cql-ide/panels/ide-panel-tab.interface';

export interface TabTypeDefinition {
  type: string;
  title: string;
  component: Type<any>;
  allowedPanels: ('left' | 'right' | 'bottom')[];
  defaultPanel: 'left' | 'right' | 'bottom';
}

@Injectable({
  providedIn: 'root'
})
export class IdeTabRegistryService {
  private tabTypes = new Map<string, TabTypeDefinition>();

  constructor() {
    // Register default tab types
    this.registerTabType({
      type: 'navigation',
      title: 'Navigation',
      component: null as any, // Will be set when components are created
      allowedPanels: ['left'],
      defaultPanel: 'left'
    });

    this.registerTabType({
      type: 'outline',
      title: 'Outline',
      component: null as any,
      allowedPanels: ['left'],
      defaultPanel: 'left'
    });

    this.registerTabType({
      type: 'fhir',
      title: 'FHIR',
      component: null as any,
      allowedPanels: ['right'],
      defaultPanel: 'right'
    });

    this.registerTabType({
      type: 'elm',
      title: 'ELM',
      component: null as any,
      allowedPanels: ['right'],
      defaultPanel: 'right'
    });

    this.registerTabType({
      type: 'problems',
      title: 'Problems',
      component: null as any,
      allowedPanels: ['bottom'],
      defaultPanel: 'bottom'
    });

    this.registerTabType({
      type: 'output',
      title: 'Console',
      component: null as any,
      allowedPanels: ['bottom'],
      defaultPanel: 'bottom'
    });

    this.registerTabType({
      type: 'ai',
      title: 'OpenCode',
      component: null as any,
      allowedPanels: ['right'],
      defaultPanel: 'right'
    });
  }

  registerTabType(definition: TabTypeDefinition): void {
    this.tabTypes.set(definition.type, definition);
  }

  getTabType(type: string): TabTypeDefinition | undefined {
    return this.tabTypes.get(type);
  }

  getAllTabTypes(): TabTypeDefinition[] {
    return Array.from(this.tabTypes.values());
  }

  canMoveTabToPanel(tabType: string, panelId: 'left' | 'right' | 'bottom'): boolean {
    const tabTypeDef = this.getTabType(tabType);
    return tabTypeDef?.allowedPanels.includes(panelId) ?? false;
  }

  getDefaultPanelForTabType(tabType: string): 'left' | 'right' | 'bottom' | undefined {
    const tabTypeDef = this.getTabType(tabType);
    return tabTypeDef?.defaultPanel;
  }

  createTab(type: string, id?: string, data?: any): IdePanelTab | null {
    const tabTypeDef = this.getTabType(type);
    if (!tabTypeDef) return null;

    return {
      id: id || `${type}-${Date.now()}`,
      type,
      title: tabTypeDef.title,
      icon: `bi-${type}`,
      component: tabTypeDef.component,
      isActive: false,
      isClosable: true,
      data
    };
  }

  validateTabMovement(tabType: string, fromPanel: string, toPanel: string): boolean {
    const tabTypeDef = this.getTabType(tabType);
    if (!tabTypeDef) return false;

    // Check if the tab type is allowed in the target panel
    return tabTypeDef.allowedPanels.includes(toPanel as 'left' | 'right' | 'bottom');
  }

  getAvailableTabTypesForPanel(panelId: string): string[] {
    const availableTypes: string[] = [];
    
    for (const [type, definition] of this.tabTypes) {
      if (definition.allowedPanels.includes(panelId as 'left' | 'right' | 'bottom')) {
        availableTypes.push(type);
      }
    }
    
    return availableTypes;
  }
}
