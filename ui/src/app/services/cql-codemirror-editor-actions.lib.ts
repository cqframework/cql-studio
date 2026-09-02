// Author: Preston Lee

import {
  EditorView,
  Decoration,
  DecorationSet,
  hoverTooltip,
  activateHover,
  closeHoverTooltips,
  keymap,
  Tooltip
} from '@codemirror/view';
import { Extension, StateEffect, StateField, Transaction } from '@codemirror/state';
import { CqlDefinitionIndex } from './elm-locator.lib';
import { isCqlIdentPart } from './cql-identifier.lib';

export type CqlEditorActionId =
  | 'go-to-definition'
  | 'find-references'
  | 'rename-symbol'
  | 'open-terminology'
  | 'peek-valueset';

export interface CqlEditorAction {
  id: CqlEditorActionId;
  label: string;
  run: () => void | Promise<void>;
}

export interface EditorActionsHandlers {
  findActionsAt: (line: number, column: number) => CqlEditorAction[];
  getHoverInfoAt?: (line: number, column: number) => string | null;
  /** Optional: used for Cmd/Ctrl underline when actions include go-to or terminology */
  findUnderlineSpanAt?: (line: number, column: number) => { from: number; to: number } | null;
}

export const setDefinitionIndexEffect = StateEffect.define<CqlDefinitionIndex | null>();
const setLinkDecorationsEffect = StateEffect.define<DecorationSet>();

interface EditorActionsState {
  index: CqlDefinitionIndex | null;
  linkDecorations: DecorationSet;
}

const editorActionsField = StateField.define<EditorActionsState>({
  create(): EditorActionsState {
    return {
      index: null,
      linkDecorations: Decoration.none
    };
  },
  update(value, tr): EditorActionsState {
    let { index, linkDecorations } = value;

    for (const effect of tr.effects) {
      if (effect.is(setDefinitionIndexEffect)) {
        index = effect.value;
        linkDecorations = Decoration.none;
      }
      if (effect.is(setLinkDecorationsEffect)) {
        linkDecorations = effect.value;
      }
    }

    if (tr.docChanged) {
      linkDecorations = Decoration.none;
    }

    return { index, linkDecorations };
  },
  provide(field): Extension {
    return EditorView.decorations.from(field, state => state.linkDecorations);
  }
});

function isModifierPressed(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function posToLineColumn(view: EditorView, pos: number): { line: number; column: number } {
  const lineInfo = view.state.doc.lineAt(pos);
  return {
    line: lineInfo.number,
    column: pos - lineInfo.from
  };
}

function closeHover(view?: EditorView): void {
  if (view) {
    view.dispatch({ effects: closeHoverTooltips });
  }
}

function primaryAction(actions: CqlEditorAction[]): CqlEditorAction | null {
  return (
    actions.find(a => a.id === 'go-to-definition') ??
    actions.find(a => a.id === 'open-terminology') ??
    actions[0] ??
    null
  );
}

function enclosingQuoteRangeOnLine(
  line: string,
  localPos: number,
  lineStart: number
): { from: number; to: number } | null {
  for (const quote of ['"', "'"] as const) {
    let i = 0;
    while (i < line.length) {
      if (line[i] !== quote) {
        i += 1;
        continue;
      }
      const start = i;
      i += 1;
      while (i < line.length) {
        if (line[i] === '\\' && i + 1 < line.length) {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          const end = i + 1;
          if (localPos >= start && localPos <= end) {
            return { from: lineStart + start, to: lineStart + end };
          }
          i += 1;
          break;
        }
        i += 1;
      }
    }
  }
  return null;
}

/**
 * Document range that should keep a hover tooltip open while the pointer stays over the token.
 * Without `end`, CodeMirror closes as soon as the mouse leaves the exact `pos`.
 */
function hoverKeepAliveRange(
  view: EditorView,
  pos: number,
  handlers: EditorActionsHandlers
): { from: number; to: number } {
  const { line, column } = posToLineColumn(view, pos);
  const underline = handlers.findUnderlineSpanAt?.(line, column);
  if (underline && underline.from <= pos && pos <= underline.to) {
    return underline;
  }

  const text = view.state.doc.toString();
  const clamped = Math.max(0, Math.min(pos, text.length));
  const lineInfo = view.state.doc.lineAt(clamped);
  const local = clamped - lineInfo.from;
  const quoted = enclosingQuoteRangeOnLine(lineInfo.text, local, lineInfo.from);
  if (quoted) {
    return quoted;
  }

  let from = clamped;
  let to = clamped;
  while (from > lineInfo.from && isCqlIdentPart(text[from - 1])) {
    from -= 1;
  }
  while (to < lineInfo.to && isCqlIdentPart(text[to])) {
    to += 1;
  }
  if (from < to) {
    return { from, to };
  }
  return { from: clamped, to: Math.min(clamped + 1, lineInfo.to) };
}

function buildHoverPanelDom(
  view: EditorView,
  infoText: string | null,
  actions: CqlEditorAction[]
): HTMLElement {
  const root = document.createElement('div');
  root.id = 'cql-editor-hover-panel';
  root.className = 'cm-cql-hover-panel';

  if (infoText) {
    const info = document.createElement('div');
    info.className = 'cm-cql-hover-info p-2 small border-bottom';
    info.id = 'cql-editor-hover-info';
    info.textContent = infoText;
    root.appendChild(info);
  }

  if (actions.length > 0) {
    const list = document.createElement('div');
    list.className = 'cm-cql-hover-actions';
    for (const action of actions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dropdown-item';
      item.id = `cql-editor-action-${action.id}`;
      item.textContent = action.label;
      item.addEventListener('mousedown', event => {
        // Keep the tooltip from stealing the click before mouseup/click.
        event.preventDefault();
        event.stopPropagation();
      });
      item.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        closeHover(view);
        // Defer so CodeMirror finishes the click transaction before IDE chrome updates.
        queueMicrotask(() => {
          void action.run();
        });
      });
      list.appendChild(item);
    }
    root.appendChild(list);
  }

  return root;
}

function createUnifiedHoverTooltip(handlers: EditorActionsHandlers): Extension & {
  active: StateField<readonly Tooltip[]>;
} {
  return hoverTooltip(
    (view, pos): Tooltip | null => {
      const { line, column } = posToLineColumn(view, pos);
      const infoText = handlers.getHoverInfoAt?.(line, column) ?? null;
      const actions = handlers.findActionsAt(line, column);
      if (!infoText && actions.length === 0) {
        return null;
      }
      const range = hoverKeepAliveRange(view, pos, handlers);
      return {
        pos: range.from,
        end: range.to,
        // Arrow hit-tests as part of the tooltip, bridging the gap to the text.
        arrow: true,
        above: true,
        create() {
          return {
            dom: buildHoverPanelDom(view, infoText, actions),
            // Keep the panel snug to the arrow/text so the pointer can reach it.
            offset: { x: 0, y: 0 }
          };
        }
      };
    },
    { hoverTime: 250 }
  );
}

function hasHoverContentAt(
  handlers: EditorActionsHandlers,
  line: number,
  column: number
): boolean {
  const infoText = handlers.getHoverInfoAt?.(line, column) ?? null;
  const actions = handlers.findActionsAt(line, column);
  return !!infoText || actions.length > 0;
}

export function createEditorActionsExtension(handlers: EditorActionsHandlers): Extension[] {
  const hoverExt = createUnifiedHoverTooltip(handlers);

  return [
    editorActionsField,
    hoverExt,
    EditorView.domEventHandlers({
      mousemove(event, view) {
        const current = view.state.field(editorActionsField).linkDecorations;
        if (!isModifierPressed(event)) {
          if (current.size > 0) {
            view.dispatch({ effects: setLinkDecorationsEffect.of(Decoration.none) });
          }
          return false;
        }

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) {
          if (current.size > 0) {
            view.dispatch({ effects: setLinkDecorationsEffect.of(Decoration.none) });
          }
          return false;
        }

        const { line, column } = posToLineColumn(view, pos);
        const underline = handlers.findUnderlineSpanAt?.(line, column) ?? null;
        const linkDecorations = underline
          ? Decoration.set([
              Decoration.mark({ class: 'cm-cql-definition-link' }).range(underline.from, underline.to)
            ])
          : Decoration.none;
        view.dispatch({ effects: setLinkDecorationsEffect.of(linkDecorations) });
        return false;
      },
      mouseleave(_event, view) {
        if (view.state.field(editorActionsField).linkDecorations.size > 0) {
          view.dispatch({ effects: setLinkDecorationsEffect.of(Decoration.none) });
        }
        return false;
      },
      mousedown(event, view) {
        if (!isModifierPressed(event) || event.button !== 0) {
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) {
          return false;
        }
        const { line, column } = posToLineColumn(view, pos);
        const action = primaryAction(handlers.findActionsAt(line, column));
        if (!action) {
          return false;
        }
        event.preventDefault();
        closeHover(view);
        queueMicrotask(() => {
          void action.run();
        });
        return true;
      },
      contextmenu(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) {
          return false;
        }
        const { line, column } = posToLineColumn(view, pos);
        if (!hasHoverContentAt(handlers, line, column)) {
          return false;
        }
        event.preventDefault();
        activateHover(view, pos, 1, {
          tooltip: hoverExt,
          until: (tr: Transaction) => !!(tr.docChanged || tr.selection)
        });
        return true;
      }
    }),
    EditorView.theme({
      '.cm-cql-definition-link': {
        textDecoration: 'underline',
        cursor: 'pointer'
      },
      '.cm-tooltip.cm-tooltip-hover': {
        border: '1px solid var(--bs-border-color, #dee2e6)',
        backgroundColor: 'var(--bs-body-bg, #fff)',
        color: 'var(--bs-body-color, #212529)',
        borderRadius: '0.375rem',
        boxShadow: '0 0.5rem 1rem rgba(0, 0, 0, 0.15)',
        maxWidth: '28rem',
        padding: '0'
      },
      '.cm-tooltip.cm-tooltip-hover.cm-tooltip-above .cm-tooltip-arrow:before': {
        borderTopColor: 'var(--bs-border-color, #dee2e6)'
      },
      '.cm-tooltip.cm-tooltip-hover.cm-tooltip-above .cm-tooltip-arrow:after': {
        borderTopColor: 'var(--bs-body-bg, #fff)'
      },
      '.cm-tooltip.cm-tooltip-hover.cm-tooltip-below .cm-tooltip-arrow:before': {
        borderBottomColor: 'var(--bs-border-color, #dee2e6)'
      },
      '.cm-tooltip.cm-tooltip-hover.cm-tooltip-below .cm-tooltip-arrow:after': {
        borderBottomColor: 'var(--bs-body-bg, #fff)'
      },
      '.cm-cql-hover-panel': {
        minWidth: '12rem'
      },
      '.cm-cql-hover-info': {
        whiteSpace: 'pre-wrap',
        maxWidth: '28rem'
      },
      '.cm-cql-hover-actions .dropdown-item': {
        fontSize: '0.875rem'
      }
    }),
    keymap.of([
      {
        key: 'F12',
        run(view) {
          const pos = view.state.selection.main.head;
          const { line, column } = posToLineColumn(view, pos);
          const action = primaryAction(handlers.findActionsAt(line, column));
          if (!action) {
            return false;
          }
          closeHover(view);
          queueMicrotask(() => {
            void action.run();
          });
          return true;
        }
      },
      {
        key: 'Escape',
        run(view) {
          view.dispatch({ effects: closeHoverTooltips });
          return true;
        }
      }
    ])
  ];
}

export function reconfigureDefinitionIndex(
  view: EditorView,
  index: CqlDefinitionIndex | null
): void {
  view.dispatch({
    effects: setDefinitionIndexEffect.of(index)
  });
}
