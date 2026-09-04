// Author: Preston Lee

import type { OpenCodeWorkspaceManifest } from '@cql-studio/core';
import { MCPToolNames } from '@cql-studio/core';

/**
 * Resolve which workspace CQL file `cql_validate` should target.
 * Empty sessions start with ACTIVE_FILE=""; after create-draft the MCP process
 * env is not restarted, so prefer an explicit tool arg, then a still-valid env
 * path, then the first writable library in the live manifest.
 */
export function resolveMcpValidateTarget(
  manifest: OpenCodeWorkspaceManifest,
  options: { fileArg?: unknown; envActiveFile?: string | null }
): string {
  if (typeof options.fileArg === 'string' && options.fileArg.trim()) {
    return options.fileArg.trim();
  }
  const envActive = typeof options.envActiveFile === 'string' ? options.envActiveFile.trim() : '';
  if (envActive && manifest.files[envActive]) return envActive;
  const fromManifest = Object.entries(manifest.files)
    .find(([file, entry]) => entry.writable && file.startsWith('libraries/'))
    ?.[0];
  if (fromManifest) return fromManifest;
  throw new Error(
    `No writable CQL library is available to validate. Call ${MCPToolNames.CQL_LIBRARY_CREATE_DRAFT} first.`
  );
}
