/// <reference lib="webworker" />
// Author: Preston Lee

import {
  notifyDebugResume,
  type CqlDebugBreakpointSpec,
  type CqlDebugStepMode,
} from '../services/cql-debug/cql-debug-breakpoint-handler';
import type {
  CqlDebugWorkerInboundMessage,
  CqlDebugWorkerOutboundMessage,
} from '../services/cql-debug/cql-debug-protocol';
import { runCqlDebugSession } from '../services/cql-debug/cql-debug-session-runner';

declare const self: DedicatedWorkerGlobalScope;

let breakpoints: CqlDebugBreakpointSpec[] = [];
let stepMode: CqlDebugStepMode = 'continue';
let abort = false;
let sab: SharedArrayBuffer | null = null;
let running = false;

function post(message: CqlDebugWorkerOutboundMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<CqlDebugWorkerInboundMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'start': {
      if (running) {
        post({ type: 'error', message: 'Debug session already running' });
        return;
      }
      abort = false;
      stepMode = 'continue';
      breakpoints = message.payload.breakpoints ?? [];
      sab = message.sab;
      running = true;
      void runCqlDebugSession(message.payload, {
        postMessage: post,
        sab: message.sab,
        getBreakpoints: () => breakpoints,
        getStepMode: () => stepMode,
        setStepMode: mode => {
          stepMode = mode;
        },
        shouldAbort: () => abort,
      }).finally(() => {
        running = false;
      });
      break;
    }
    case 'setBreakpoints':
      breakpoints = message.breakpoints;
      break;
    case 'command':
      stepMode = message.command;
      if (sab) {
        notifyDebugResume(sab, message.command);
      }
      if (message.command === 'stop') {
        abort = true;
      }
      break;
    case 'stop':
      abort = true;
      stepMode = 'stop';
      if (sab) {
        notifyDebugResume(sab, 'stop');
      }
      break;
    default:
      break;
  }
};

post({ type: 'ready' });
