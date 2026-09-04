// Author: Preston Lee

/**
 * Process exit codes for the OpenCode runner (sysexits.h conventions).
 * Orchestrators and Docker health/restart policies rely on non-zero codes.
 */
export const OpenCodeExitCode = {
  /** Generic failure */
  GENERAL: 1,
  /** Service could not start or become ready (EX_UNAVAILABLE) */
  UNAVAILABLE: 69,
  /** Unexpected internal/runtime failure (EX_SOFTWARE) */
  SOFTWARE: 70,
  /** OS-level bind/IO failure such as EADDRINUSE (EX_OSERR) */
  OSERR: 71,
  /** Missing or invalid configuration / environment (EX_CONFIG) */
  CONFIG: 78,
} as const;

export type OpenCodeExitCodeValue = (typeof OpenCodeExitCode)[keyof typeof OpenCodeExitCode];

export class OpenCodeFatalError extends Error {
  readonly exitCode: OpenCodeExitCodeValue;

  constructor(message: string, exitCode: OpenCodeExitCodeValue = OpenCodeExitCode.GENERAL) {
    super(message);
    this.name = 'OpenCodeFatalError';
    this.exitCode = exitCode;
  }
}

export function exitCodeForFatal(error: unknown): OpenCodeExitCodeValue {
  if (error instanceof OpenCodeFatalError) return error.exitCode;
  return OpenCodeExitCode.GENERAL;
}
