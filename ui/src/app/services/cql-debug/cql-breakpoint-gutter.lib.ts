// Author: Preston Lee

import { gutter, GutterMarker, EditorView, Decoration } from '@codemirror/view';
import { StateField, StateEffect, RangeSet, type Extension } from '@codemirror/state';

export const breakpointToggleEffect = StateEffect.define<{ pos: number; on: boolean }>({
  map: (value, mapping) => ({ pos: mapping.mapPos(value.pos), on: value.on }),
});

const debugPausedLineEffect = StateEffect.define<number | null>();

const breakpointMarker = new (class extends GutterMarker {
  override toDOM() {
    const span = document.createElement('span');
    span.textContent = '●';
    span.className = 'cm-cql-breakpoint-marker';
    span.setAttribute('aria-label', 'Breakpoint');
    return span;
  }
})();

const breakpointState = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(set, transaction) {
    set = set.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(breakpointToggleEffect)) {
        if (effect.value.on) {
          set = set.update({ add: [breakpointMarker.range(effect.value.pos)] });
        } else {
          set = set.update({ filter: from => from !== effect.value.pos });
        }
      }
    }
    return set;
  },
});

const pausedLineMark = Decoration.line({ class: 'cm-cql-debug-paused-line' });

const pausedLineField = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let lineNumber: number | null | undefined;
    for (const effect of transaction.effects) {
      if (effect.is(debugPausedLineEffect)) {
        lineNumber = effect.value;
      }
    }
    if (lineNumber === undefined) {
      return decorations.map(transaction.changes);
    }
    if (lineNumber == null || lineNumber < 1 || lineNumber > transaction.state.doc.lines) {
      return Decoration.none;
    }
    const line = transaction.state.doc.line(lineNumber);
    return Decoration.set([pausedLineMark.range(line.from)]);
  },
  provide: field => EditorView.decorations.from(field),
});

function hasBreakpointAt(view: EditorView, pos: number): boolean {
  const breakpoints = view.state.field(breakpointState);
  let found = false;
  breakpoints.between(pos, pos, () => {
    found = true;
  });
  return found;
}

interface CqlBreakpointGutterCallbacks {
  /** Return true when the toggle was accepted (marker should update). */
  onToggle: (line: number, enabled: boolean) => boolean;
  onAltClick: (line: number) => void;
}

export function createCqlBreakpointGutterExtensions(
  callbacks: CqlBreakpointGutterCallbacks
): Extension[] {
  return [
    breakpointState,
    pausedLineField,
    gutter({
      class: 'cm-cql-breakpoint-gutter',
      markers: view => view.state.field(breakpointState),
      initialSpacer: () => breakpointMarker,
      renderEmptyElements: true,
      domEventHandlers: {
        mousedown(view, line, event) {
          const mouse = event as MouseEvent;
          const lineNumber = view.state.doc.lineAt(line.from).number;
          if (mouse.altKey) {
            callbacks.onAltClick(lineNumber);
            return true;
          }
          const currentlyOn = hasBreakpointAt(view, line.from);
          const wantEnabled = !currentlyOn;
          const accepted = callbacks.onToggle(lineNumber, wantEnabled);
          if (accepted) {
            view.dispatch({
              effects: breakpointToggleEffect.of({ pos: line.from, on: wantEnabled }),
            });
          }
          return true;
        },
      },
    }),
    EditorView.baseTheme({
      '.cm-cql-breakpoint-gutter .cm-gutterElement': {
        color: '#dc3545',
        paddingLeft: '4px',
        cursor: 'pointer',
        minWidth: '1rem',
      },
      '.cm-cql-debug-paused-line': {
        backgroundColor: 'rgba(255, 193, 7, 0.25)',
      },
    }),
  ];
}

export function setDebugPausedLine(view: EditorView, line: number | null): void {
  if (line == null || line < 1 || line > view.state.doc.lines) {
    view.dispatch({ effects: debugPausedLineEffect.of(line) });
    return;
  }
  const docLine = view.state.doc.line(line);
  view.dispatch({
    effects: debugPausedLineEffect.of(line),
    selection: { anchor: docLine.from, head: docLine.from },
    scrollIntoView: true,
  });
}
