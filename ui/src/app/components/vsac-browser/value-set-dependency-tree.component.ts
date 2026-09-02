// Author: Preston Lee

import { Component, computed, input } from '@angular/core';
import { ValueSetDependencyNode, ValueSetDependencyStatus, ValueSetDependencyTreeRow } from './value-set-dependency.model';

@Component({
  selector: 'app-value-set-dependency-tree',

  templateUrl: './value-set-dependency-tree.component.html'
})
export class ValueSetDependencyTreeComponent {
  readonly tree = input<ValueSetDependencyNode | null>(null);
  readonly importableCount = input(0);

  readonly rows = computed(() => {
    const root = this.tree();
    if (!root) return [] as ValueSetDependencyTreeRow[];
    const out: ValueSetDependencyTreeRow[] = [];
    const visit = (node: ValueSetDependencyNode, depth: number) => {
      out.push({ node, depth });
      for (const child of node.children) {
        visit(child, depth + 1);
      }
    };
    visit(root, 0);
    return out;
  });

  nodeLabel(node: ValueSetDependencyNode): string {
    const vs = node.valueSet;
    if (!vs) return node.reference || node.key;
    return vs.title || vs.name || vs.id || vs.url || 'ValueSet';
  }

  nodeMeta(node: ValueSetDependencyNode): string {
    const vs = node.valueSet;
    if (!vs) return node.reference || 'Unresolved reference';
    return vs.url || vs.id || node.key;
  }

  statusIconClass(status: ValueSetDependencyStatus): string {
    switch (status) {
      case 'ideal':
        return 'bi bi-check-circle-fill text-success';
      case 'conditional':
        return 'bi bi-cloud-arrow-up-fill text-primary';
      case 'questionable':
        return 'bi bi-exclamation-triangle-fill text-warning';
      case 'reference':
        return 'bi bi-diagram-3-fill text-success';
      case 'external':
        return 'bi bi-box-arrow-up-right text-secondary';
      case 'duplicate':
        return 'bi bi-copy text-secondary';
      case 'cycle':
        return 'bi bi-arrow-repeat text-warning';
      case 'error':
      default:
        return 'bi bi-x-octagon-fill text-danger';
    }
  }

  statusLabel(status: ValueSetDependencyStatus): string {
    switch (status) {
      case 'ideal':
        return 'Ideal import candidate';
      case 'conditional':
        return 'Conditional import behavior';
      case 'questionable':
        return 'Questionable: depends on code system availability';
      case 'reference':
        return 'Reference-only composition';
      case 'external':
        return 'External/implicit reference not resolved';
      case 'duplicate':
        return 'Duplicate dependency already visited';
      case 'cycle':
        return 'Cycle detected in dependency graph';
      case 'error':
      default:
        return 'Dependency evaluation error';
    }
  }
}
