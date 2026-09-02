// Author: Preston Lee

export type SqlWorkflowStep = 'library' | 'cql' | 'elm' | 'sqlGen' | 'execute';

export const SQL_WORKFLOW_ORDER: SqlWorkflowStep[] = ['library', 'cql', 'elm', 'sqlGen', 'execute'];

export type SqlWorkflowStepStatus = 'locked' | 'loading' | 'ok' | 'warn' | 'error';

/** Snapshot of pipeline progress used by pure workflow helpers. */
export interface SqlWorkflowProgress {
  hasSelectedLibrary: boolean;
  libraryComplete: boolean;
  cqlPreview: string;
  isTranslatingElm: boolean;
  hasElmTranslationErrors: boolean;
  hasElmTranslationWarnings: boolean;
  elmXmlRaw: string | null;
  formattedElmXml: string;
  sqlText: string;
  sqlExecuteFailed: boolean;
  sqlResultsRaw: string;
}

export function isLibraryStepComplete(progress: SqlWorkflowProgress): boolean {
  return progress.libraryComplete;
}

export function isCqlStepComplete(progress: SqlWorkflowProgress): boolean {
  return isLibraryStepComplete(progress) && progress.cqlPreview.trim().length > 0;
}

export function isElmStepComplete(progress: SqlWorkflowProgress): boolean {
  return (
    isCqlStepComplete(progress) &&
    !progress.isTranslatingElm &&
    !progress.hasElmTranslationErrors &&
    (progress.elmXmlRaw?.trim() ?? '').length > 0
  );
}

export function isSqlGenStepComplete(progress: SqlWorkflowProgress): boolean {
  return isElmStepComplete(progress) && progress.sqlText.trim().length > 0;
}

export function isWorkflowStepSatisfied(step: SqlWorkflowStep, progress: SqlWorkflowProgress): boolean {
  switch (step) {
    case 'library':
      return isLibraryStepComplete(progress);
    case 'cql':
      return isCqlStepComplete(progress);
    case 'elm':
      return isElmStepComplete(progress);
    case 'sqlGen':
      return isSqlGenStepComplete(progress);
    case 'execute':
      return isSqlGenStepComplete(progress);
    default:
      return false;
  }
}

export function canNavigateToWorkflowStep(step: SqlWorkflowStep, progress: SqlWorkflowProgress): boolean {
  const i = SQL_WORKFLOW_ORDER.indexOf(step);
  if (i <= 0) {
    return progress.hasSelectedLibrary;
  }
  for (let j = 0; j < i; j++) {
    if (!isWorkflowStepSatisfied(SQL_WORKFLOW_ORDER[j], progress)) {
      return false;
    }
  }
  return progress.hasSelectedLibrary;
}

/** First step whose prerequisites are not fully satisfied (where the user should resume). */
export function firstIncompleteWorkflowStep(progress: SqlWorkflowProgress): SqlWorkflowStep | null {
  if (!isLibraryStepComplete(progress)) {
    return 'library';
  }
  if (!isCqlStepComplete(progress)) {
    return 'cql';
  }
  if (!isElmStepComplete(progress)) {
    return 'elm';
  }
  if (!isSqlGenStepComplete(progress)) {
    return 'sqlGen';
  }
  return null;
}

const WORKFLOW_STEP_LABELS: Record<SqlWorkflowStep, string> = {
  library: 'FHIR Library',
  cql: 'Decoded CQL',
  elm: 'ELM Translation',
  sqlGen: 'Generated SQL',
  execute: 'Execute SQL',
};

export function workflowStepLabel(step: SqlWorkflowStep): string {
  return WORKFLOW_STEP_LABELS[step];
}

export function workflowStepStatus(
  step: SqlWorkflowStep,
  progress: SqlWorkflowProgress,
): SqlWorkflowStepStatus {
  if (!canNavigateToWorkflowStep(step, progress)) {
    return 'locked';
  }
  switch (step) {
    case 'library':
      return isLibraryStepComplete(progress) ? 'ok' : 'warn';
    case 'cql':
      return progress.cqlPreview.trim() ? 'ok' : 'warn';
    case 'elm':
      if (progress.isTranslatingElm) {
        return 'loading';
      }
      if (progress.hasElmTranslationErrors) {
        return 'error';
      }
      if (!progress.formattedElmXml) {
        return progress.cqlPreview.trim() ? 'warn' : 'warn';
      }
      return progress.hasElmTranslationWarnings ? 'warn' : 'ok';
    case 'sqlGen':
      return progress.sqlText.trim() ? 'ok' : 'warn';
    case 'execute':
      if (progress.sqlExecuteFailed) {
        return 'error';
      }
      return progress.sqlResultsRaw.trim() ? 'ok' : 'warn';
    default:
      return 'warn';
  }
}

export function workflowStepIconClasses(status: SqlWorkflowStepStatus): string {
  switch (status) {
    case 'locked':
      return 'bi bi-lock-fill text-muted';
    case 'loading':
      return 'bi bi-hourglass-split text-primary';
    case 'ok':
      return 'bi bi-check-circle-fill text-success';
    case 'warn':
      return 'bi bi-exclamation-triangle-fill text-warning';
    case 'error':
      return 'bi bi-x-circle-fill text-danger';
    default:
      return 'bi bi-circle text-muted';
  }
}
