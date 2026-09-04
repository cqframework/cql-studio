// Author: Preston Lee

import { createHash, randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import { MCPToolNames, normalizeOpenCodeLibraries } from '@cql-studio/core';
import type {
  CreateOpenCodeSessionRequest,
  OpenCodeAttachmentDto,
  OpenCodeAttachmentUploadRequest,
  OpenCodeProviderConfig,
  OpenCodeFileDiffDto,
  OpenCodeWorkspaceManifest,
  OpenCodeWorkspaceSyncRequest,
} from '@cql-studio/core';
import { OpenCodeExitCode, OpenCodeFatalError } from './fatal.js';

const execFileAsync = promisify(execFile);
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_CONVERTED_BYTES = 4 * 1024 * 1024;
/** MarkItDown CLI name; must resolve via PATH at runner startup. */
export const MARKITDOWN_BIN = 'markitdown';

export interface OpenCodeWorkspaceOptions {
  rewriteLocalhost?: boolean;
  mcpBridgeBin?: string;
}

/**
 * Resolve an executable by searching PATH.
 */
export function resolveExecutableOnPath(
  bin: string,
  pathEnv: string = process.env.PATH ?? ''
): string | undefined {
  const trimmed = bin.trim();
  if (!trimmed) return undefined;
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, trimmed);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

/**
 * Fail fast when MarkItDown is missing so PDF/DOCX uploads do not fail mid-session.
 * Returns the resolved absolute path when found on PATH.
 */
export function assertMarkitdownAvailable(pathEnv: string = process.env.PATH ?? ''): string {
  const resolved = resolveExecutableOnPath(MARKITDOWN_BIN, pathEnv);
  if (resolved) return resolved;
  throw new OpenCodeFatalError(
    `MarkItDown is required for PDF/DOCX attachment conversion but "${MARKITDOWN_BIN}" was not found on PATH. Install with: python3 -m pip install 'markitdown[pdf,docx]==0.1.7' (or run the opencode Docker image) and ensure the binary is on PATH.`,
    OpenCodeExitCode.UNAVAILABLE
  );
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.text', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.xml',
  '.yaml', '.yml', '.html', '.htm', '.css', '.scss', '.js', '.jsx', '.ts', '.tsx', '.py',
  '.java', '.go', '.rs', '.sql', '.log', '.ini', '.toml', '.sh', '.bash', '.bat', '.ps1',
  '.graphql', '.gql', '.ttl', '.rdf', '.cql', '.rtf', '.tex', '.rst', '.adoc', '.conf', '.cfg',
  '.env', '.properties', '.dockerfile', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.kt',
  '.swift', '.rb', '.php', '.pl', '.vim', '.xhtml',
]);
const MARKITDOWN_EXTENSIONS = new Set(['.pdf', '.docx']);
const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.zip', '.gz', '.tar', '.7z', '.rar',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.mp3', '.wav', '.mp4',
  '.mov', '.avi', '.xlsx', '.xls', '.pptx', '.ppt', '.odt', '.ods',
]);

export function mcpBridgeExecutable(
  moduleUrl = import.meta.url,
  configured = process.env.CQL_STUDIO_OPENCODE_MCP_BRIDGE_BIN
): string {
  return configured?.trim() || fileURLToPath(new URL('./mcp-bridge.js', moduleUrl));
}

export interface MaterializedWorkspace {
  id: string;
  directory: string;
  /** Focused writable relative path, or empty when no writable libraries exist. */
  activeFile: string;
  manifest: OpenCodeWorkspaceManifest;
  baselineByFile: Map<string, string>;
}

export interface OpenCodeAttachmentInput extends OpenCodeAttachmentUploadRequest {}

function safeSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 100);
  return normalized || fallback;
}

/** Allocate a unique basename under `usedNames` (lowercase keys). */
function uniqueCqlFileName(name: string, fallback: string, usedNames: Set<string>): string {
  const base = safeSegment(name, fallback).replace(/\.cql$/i, '');
  let candidate = `${base}.cql`;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}-${index++}.cql`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function countChangedLines(before: string, after: string): { additions: number; deletions: number } {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    deletions: Math.max(0, beforeLines.length - prefix - suffix),
    additions: Math.max(0, afterLines.length - prefix - suffix),
  };
}

function normalizeOllamaBaseUrl(raw: string, rewriteLocalhost: boolean): string {
  const url = new URL(raw);
  if (rewriteLocalhost && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    url.hostname = 'host.docker.internal';
  }
  const withoutSlash = url.toString().replace(/\/+$/, '');
  return withoutSlash.endsWith('/v1') ? withoutSlash : `${withoutSlash}/v1`;
}

function normalizeProviderBaseUrl(raw: string, appendV1 = true): string {
  const url = new URL(raw);
  const withoutSlash = url.toString().replace(/\/+$/, '');
  return appendV1 && !withoutSlash.endsWith('/v1') ? `${withoutSlash}/v1` : withoutSlash;
}

export function providerFor(input: CreateOpenCodeSessionRequest): OpenCodeProviderConfig {
  if (input.provider) return input.provider;
  return { type: 'ollama', model: input.ollamaModel, baseUrl: input.ollamaBaseUrl };
}

export function providerIdFor(provider: OpenCodeProviderConfig): string {
  if (provider.type === 'ollama') return 'ollama';
  if (provider.type === 'openai') return 'openai';
  const id = (provider.name || 'custom')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  return id || 'custom';
}

export class OpenCodeWorkspaceManager {
  private readonly root: string;
  private readonly rewriteLocalhost: boolean;
  private markitdownBinPath: string;
  private readonly mcpBridgeBin?: string;

  constructor(
    root = process.env.CQL_STUDIO_OPENCODE_WORKSPACE_ROOT || '/workspaces',
    options: OpenCodeWorkspaceOptions = {}
  ) {
    this.root = path.resolve(root);
    this.rewriteLocalhost =
      options.rewriteLocalhost ??
      process.env.CQL_STUDIO_OPENCODE_RUNNER_REWRITE_LOCALHOST !== 'false';
    this.markitdownBinPath = MARKITDOWN_BIN;
    this.mcpBridgeBin = options.mcpBridgeBin?.trim() || undefined;
  }

  /** Prefer the absolute path verified at runner startup. */
  useMarkitdownBin(bin: string): void {
    const trimmed = bin.trim();
    if (trimmed) this.markitdownBinPath = trimmed;
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    // Runtime sessions are intentionally ephemeral. Anything left at runner startup
    // cannot have a live owning session and is therefore an orphan.
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
      const orphan = path.join(this.root, entry.name);
      await chmod(path.join(orphan, 'dependencies'), 0o700).catch(() => undefined);
      await rm(orphan, { recursive: true, force: true });
    }
  }

  async create(input: CreateOpenCodeSessionRequest): Promise<MaterializedWorkspace> {
    const requestedId = input.resume?.sessionId;
    const id = requestedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)
      ? requestedId
      : randomUUID();
    const directory = path.join(this.root, id);
    if (requestedId) await rm(directory, { recursive: true, force: true });
    const librariesDirectory = path.join(directory, 'libraries');
    const dependenciesDirectory = path.join(directory, 'dependencies');
    const metadataDirectory = path.join(directory, '.cql-studio');
    const commandsDirectory = path.join(directory, '.opencode', 'commands');
    const validateVsacSkillDirectory = path.join(directory, '.opencode', 'skills', 'validate-vsac');
    const attachmentsDirectory = path.join(directory, 'attachments');
    await mkdir(librariesDirectory, { recursive: true, mode: 0o700 });
    // Populate first, then remove directory write permission once all dependencies exist.
    await mkdir(dependenciesDirectory, { recursive: true, mode: 0o700 });
    await mkdir(metadataDirectory, { recursive: true, mode: 0o700 });
    await mkdir(commandsDirectory, { recursive: true, mode: 0o700 });
    await mkdir(validateVsacSkillDirectory, { recursive: true, mode: 0o700 });
    await mkdir(attachmentsDirectory, { recursive: true, mode: 0o700 });

    const libraries = normalizeOpenCodeLibraries(input);
    const writableIds = new Set(libraries.map(library => library.id));
    const focusedId = input.focusedLibraryId && writableIds.has(input.focusedLibraryId)
      ? input.focusedLibraryId
      : libraries[0]?.id;
    const usedNames = new Set<string>();

    const manifest: OpenCodeWorkspaceManifest = {
      schemaVersion: 1,
      sessionId: id,
      createdAt: new Date().toISOString(),
      activeLibraryId: focusedId ?? '',
      files: {},
    };
    const baselineByFile = new Map<string, string>();
    let activeFile = '';

    for (const library of libraries) {
      // Empty/whitespace CQL is allowed so brand-new open editors stay writable.
      if (!library.id || typeof library.cqlContent !== 'string') continue;
      const fileName = uniqueCqlFileName(library.name, library.id, usedNames);
      const relativeFile = `libraries/${fileName}`;
      await writeFile(path.join(directory, relativeFile), library.cqlContent, {
        encoding: 'utf8',
        mode: 0o600,
      });
      manifest.files[relativeFile] = {
        libraryId: library.id,
        name: library.name,
        version: library.version,
        canonicalUrl: library.canonicalUrl,
        fhirVersionId: library.fhirVersionId,
        sourceHash: sha256(library.originalContent ?? library.cqlContent),
        draft: (library.originalContent ?? library.cqlContent) !== library.cqlContent,
        writable: true,
      };
      baselineByFile.set(relativeFile, library.cqlContent);
      if (library.id === focusedId) activeFile = relativeFile;
    }
    if (!activeFile) {
      activeFile = Object.keys(manifest.files).find(file => file.startsWith('libraries/')) ?? '';
      if (activeFile) manifest.activeLibraryId = manifest.files[activeFile]?.libraryId ?? '';
    }

    for (const dependency of input.dependencies ?? []) {
      if (!dependency.cqlContent.trim() || writableIds.has(dependency.id)) continue;
      const dependencyName = uniqueCqlFileName(dependency.name, dependency.id, usedNames);
      const relativeFile = `dependencies/${dependencyName}`;
      await writeFile(path.join(directory, relativeFile), dependency.cqlContent, { encoding: 'utf8', mode: 0o400 });
      manifest.files[relativeFile] = {
        libraryId: dependency.id,
        name: dependency.name,
        version: dependency.version,
        canonicalUrl: dependency.canonicalUrl,
        fhirVersionId: dependency.fhirVersionId,
        sourceHash: sha256(dependency.originalContent ?? dependency.cqlContent),
        draft: false,
        writable: false,
      };
    }
    await chmod(dependenciesDirectory, 0o500);

    await this.writeAgentInstructions(directory, activeFile, manifest);
    await this.writeCommands(directory, commandsDirectory, validateVsacSkillDirectory, activeFile);
    await this.writeOpenCodeConfig(directory, input, activeFile);
    await writeFile(path.join(metadataDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      encoding: 'utf8',
      mode: 0o400,
    });

    return {
      id,
      directory,
      activeFile,
      manifest,
      baselineByFile,
    };
  }

  private async writeAgentInstructions(
    directory: string,
    activeFile: string,
    manifest: OpenCodeWorkspaceManifest
  ): Promise<void> {
    const writableFiles = Object.entries(manifest.files)
      .filter(([, entry]) => entry.writable)
      .map(([file]) => file);
    const focusLine = activeFile
      ? `The focused writable CQL library is \`${activeFile}\`.`
      : [
          'There is currently no writable CQL library in the IDE.',
          `Do not create \`.cql\` files under \`libraries/\` yourself.`,
          `Immediately call the MCP tool \`${MCPToolNames.CQL_LIBRARY_CREATE_DRAFT}\` with a \`name\` argument (CQL identifier, e.g. \`MyLibrary\`).`,
          'That opens a draft editor tab in CQL Studio and syncs it into this workspace; then edit only the returned \`libraries/....cql\` path.',
        ].join(' ');
    const writableList = writableFiles.length
      ? `Writable libraries:\n${writableFiles.map(file => `- \`${file}\``).join('\n')}`
      : 'Writable libraries: (none)';
    const agentInstructions = [
      '# CQL Studio OpenCode workspace',
      '',
      focusLine,
      writableList,
      'Files in `dependencies/` are reference-only and must not be edited.',
      'Only edit existing files under `libraries/` after they appear in the writable list above.',
      `When no suitable open library exists (or the user asks for a new library), call \`${MCPToolNames.CQL_LIBRARY_CREATE_DRAFT}\` first. Never invent library files on disk outside that tool.`,
      'Preserve the CQL library name and version unless the user explicitly asks to change them.',
      `When repairing CQL, treat the current CQL Studio Problems context as the initial diagnostic set and then run ${MCPToolNames.CQL_VALIDATE} after editing.`,
      'Before adding or changing a FHIR conversion helper call, read `dependencies/FHIRHelpers.cql` and use only a function declared there. Preserve each library\'s existing FHIRHelpers alias, or add the 4.0.1 include when needed.',
      'Never invent ValueSet, CodeSystem, or VSAC canonical URLs.',
      'Do not access paths outside this workspace and do not run destructive commands.',
      'CQL Studio will validate and review every file diff before saving it to FHIR.',
      '',
    ].join('\n');
    const agentsPath = path.join(directory, 'AGENTS.md');
    await chmod(agentsPath, 0o600).catch(() => undefined);
    await writeFile(agentsPath, agentInstructions, { encoding: 'utf8', mode: 0o400 });
  }

  private async writeCommands(
    directory: string,
    commandsDirectory: string,
    validateVsacSkillDirectory: string,
    activeFile: string
  ): Promise<void> {
    const focusRef = activeFile || 'libraries/*.cql';
    const commands: Record<string, { description: string; template: string }> = {
      validate: {
        description: 'Validate writable CQL without editing',
        template: `Validate ${activeFile ? `@${activeFile}` : 'all writable libraries under libraries/'} with ${MCPToolNames.CQL_VALIDATE}. Report errors and warnings with locations. Do not edit unless explicitly asked.`,
      },
      review: {
        description: 'Validate and review writable CQL',
        template: `First validate ${activeFile ? `@${activeFile}` : 'writable libraries'} with ${MCPToolNames.CQL_VALIDATE}. Then review for CQL correctness, clinical intent, dependency usage, terminology accuracy, and maintainability. Use the other read-only MCP tools when external context is needed. Do not edit unless explicitly asked.`,
      },
      explain: {
        description: 'Explain CQL with an optional focus',
        template: `Explain the requested CQL in ${activeFile ? `@${activeFile}` : 'the writable libraries'} for a CQL author. Focus on: $ARGUMENTS`,
      },
      dependencies: {
        description: 'Inspect includes and resolve dependency problems',
        template: `Inspect ${activeFile ? `@${activeFile}` : 'writable libraries'} and the dependency files, then run ${MCPToolNames.CQL_VALIDATE}. Explain every include, missing or conflicting version, and dependency-related diagnostic. For an unresolved Library include, use ${MCPToolNames.CQL_LIBRARY_SEARCH} and ${MCPToolNames.CQL_LIBRARY_READ} against the configured read-only endpoints. Do not edit or save FHIR resources.`,
      },
      library: {
        description: 'Research read-only FHIR Library resources',
        template: `Use ${MCPToolNames.CQL_LIBRARY_SEARCH} and ${MCPToolNames.CQL_LIBRARY_READ} to research this Library request without modifying FHIR: $ARGUMENTS`,
      },
      draft: {
        description: 'Open a new draft CQL library in the IDE',
        template: [
          `Call the MCP tool \`${MCPToolNames.CQL_LIBRARY_CREATE_DRAFT}\` with \`name\` set to the CQL identifier from $ARGUMENTS (or choose a sensible PascalCase name if none was given).`,
          'Do not write any `.cql` file yourself before that tool returns.',
          'After it succeeds, confirm the new IDE tab and the writable `libraries/....cql` path, then wait for further edit instructions unless the user already asked for content.',
        ].join(' '),
      },
      valueset: {
        description: 'Research an authoritative VSAC ValueSet',
        template: `Use ${MCPToolNames.VSAC_SEARCH} for ValueSet discovery, ${MCPToolNames.VALIDATE_VSAC} only for an exact URL or OID supplied by the user or existing CQL, and ${MCPToolNames.VALUESET_EXPAND} when concepts must be inspected. Never guess an identifier or canonical URL: $ARGUMENTS`,
      },
      context: {
        description: 'Show active CQL Studio endpoints and capabilities',
        template: `Use ${MCPToolNames.CQL_STUDIO_CONTEXT} to summarize the active CQL Studio environment, configured endpoint roles, and available read-only capabilities. Never expose credentials or headers.`,
      },
      fhir: {
        description: 'Read or search the configured FHIR environment',
        template: `Use ${MCPToolNames.CQL_STUDIO_CONTEXT} when endpoint selection is unclear, then use ${MCPToolNames.FHIR_READ} or ${MCPToolNames.FHIR_SEARCH} to answer this request from the configured FHIR environment. Keep searches bounded, return only relevant fields, and do not modify any resource: $ARGUMENTS`,
      },
      research: {
        description: 'Research a topic with web search and safe fetching',
        template: `Research this request with ${MCPToolNames.SEARXNG_SEARCH} and the hardened fetch tools. Prefer the smallest useful number of calls, distinguish source evidence from inference, and include the source URLs in the answer: $ARGUMENTS`,
      },
      terminology: {
        description: 'Research ValueSets, CodeSystems, and expansions',
        template: `Research this terminology request using the configured read-only tools. Use ${MCPToolNames.VSAC_SEARCH} for VSAC discovery, ${MCPToolNames.VALIDATE_VSAC} only for an exact user-supplied or existing reference, ${MCPToolNames.VALUESET_EXPAND} for concepts, and ${MCPToolNames.FHIR_READ} or ${MCPToolNames.FHIR_SEARCH} for other configured terminology resources. Never guess a canonical URL or identifier: $ARGUMENTS`,
      },
      'validate-vsac': {
        description: 'Validate VSAC references in writable CQL or an exact URL/OID',
        template: `Load the validate-vsac skill. Validate $ARGUMENTS when it contains an exact VSAC canonical URL or OID. When no argument is supplied, inspect ${activeFile ? `@${activeFile}` : 'writable libraries'} and validate every declared VSAC ValueSet reference. Report whether each reference is authoritative in VSAC and whether it is present on the configured terminology endpoint. Do not write any FHIR resource.`,
      },
    };
    await Promise.all(Object.entries(commands).map(async ([name, command]) => {
      const commandPath = path.join(commandsDirectory, `${name}.md`);
      await chmod(commandPath, 0o600).catch(() => undefined);
      await writeFile(
        commandPath,
        `---\ndescription: ${command.description}\n---\n${command.template}\n`,
        { encoding: 'utf8', mode: 0o400 }
      );
    }));

    const validateVsacSkill = [
      '---',
      'name: validate-vsac',
      'description: Validate exact VSAC ValueSet URLs or OIDs, and audit VSAC ValueSet declarations in writable CQL Libraries without guessing identifiers or modifying FHIR.',
      'compatibility: opencode',
      '---',
      '',
      '# Validate VSAC terminology',
      '',
      `1. Read \`${focusRef}\` when no exact reference was supplied.`,
      `2. For an exact canonical URL or OID supplied by the user or declared in CQL, call \`${MCPToolNames.VALIDATE_VSAC}\`.`,
      `3. If only a clinical name or topic is known, use \`${MCPToolNames.VSAC_SEARCH}\` for discovery instead of guessing an identifier.`,
      `4. Use \`${MCPToolNames.FHIR_SEARCH}\` with the terminology role and an exact canonical URL to determine whether a verified ValueSet is already present on the configured terminology server.`,
      `5. Use \`${MCPToolNames.VALUESET_EXPAND}\` only when the user asks to inspect concepts or confirm that the configured terminology server can expand an already-present ValueSet.`,
      '6. Report verified URL, id/OID, version, VSAC status, terminology-server presence, and any validation error.',
      '',
      'This skill is read-only. Never call a write endpoint, never invent or normalize a canonical URL, and never treat a general web search result as authoritative VSAC evidence.',
      '',
    ].join('\n');
    const skillPath = path.join(validateVsacSkillDirectory, 'SKILL.md');
    await chmod(skillPath, 0o600).catch(() => undefined);
    await writeFile(
      skillPath,
      validateVsacSkill,
      { encoding: 'utf8', mode: 0o400 }
    );
  }

  private async writeOpenCodeConfig(
    directory: string,
    input: CreateOpenCodeSessionRequest,
    activeFile: string
  ): Promise<void> {
    const provider = providerFor(input);
    const providerId = providerIdFor(provider);
    const modelId = provider.model || input.ollamaModel;
    const configuredProviders = [provider, ...(input.providers ?? [])]
      .filter((candidate, index, all) => all.findIndex(item => providerIdFor(item) === providerIdFor(candidate)) === index);
    const providerConfigs = Object.fromEntries(configuredProviders.map(candidate => {
      const candidateId = providerIdFor(candidate);
      const candidateBaseUrl = candidate.type === 'ollama'
        ? normalizeOllamaBaseUrl(candidate.baseUrl || input.ollamaBaseUrl, this.rewriteLocalhost)
        : normalizeProviderBaseUrl(candidate.baseUrl || 'https://api.openai.com/v1');
      const candidateOptions: Record<string, unknown> = { baseURL: candidateBaseUrl };
      if (candidate.apiKey?.trim()) candidateOptions.apiKey = candidate.apiKey.trim();
      const candidateModel = candidate.model || modelId;
      return [candidateId, {
        npm: candidate.type === 'openai' ? '@ai-sdk/openai' : '@ai-sdk/openai-compatible',
        name: candidate.name || (candidate.type === 'ollama' ? 'Ollama (local)' : 'OpenAI'),
        options: candidateOptions,
        models: {
          [candidateModel]: {
            name: candidateModel,
            options: { reasoningEffort: 'none' },
            variants: {
              fast: { reasoningEffort: 'none' },
              thinking: { reasoningEffort: 'medium' },
            },
          },
        },
      }];
    }));
    const opencodeConfig = {
      $schema: 'https://opencode.ai/config.json',
      autoupdate: false,
      share: 'disabled',
      model: `${providerId}/${modelId}`,
      small_model: `${providerId}/${modelId}`,
      instructions: ['AGENTS.md'],
      permission: {
        edit: 'allow',
        bash: 'deny',
        webfetch: 'deny',
        external_directory: 'deny',
        doom_loop: 'ask',
        skill: { '*': 'allow' },
      },
      provider: providerConfigs,
      ...(input.toolBridge ? {
        mcp: {
          'cql-studio': {
            type: 'local',
            command: [process.execPath, mcpBridgeExecutable(import.meta.url, this.mcpBridgeBin)],
            environment: {
              CQL_STUDIO_OPENCODE_MCP_BRIDGE_URL: input.toolBridge.baseUrl,
              CQL_STUDIO_OPENCODE_MCP_CAPABILITY: input.toolBridge.capability,
              CQL_STUDIO_OPENCODE_MCP_WORKSPACE: directory,
              CQL_STUDIO_OPENCODE_MCP_ACTIVE_FILE: activeFile,
            },
            enabled: true,
            timeout: 25_000,
          },
        },
      } : {}),
    };
    await writeFile(path.join(directory, 'opencode.json'), JSON.stringify(opencodeConfig, null, 2), {
      encoding: 'utf8',
      mode: 0o400,
    });
  }

  async diff(workspace: MaterializedWorkspace): Promise<OpenCodeFileDiffDto[]> {
    const diffs: OpenCodeFileDiffDto[] = [];
    for (const [file, before] of workspace.baselineByFile) {
      const after = await readFile(path.join(workspace.directory, file), 'utf8');
      if (after === before) continue;
      const counts = countChangedLines(before, after);
      diffs.push({
        file,
        libraryId: workspace.manifest.files[file].libraryId,
        before,
        after,
        ...counts,
      });
    }
    return diffs;
  }

  async syncActiveFile(workspace: MaterializedWorkspace, content: string, libraryId?: string): Promise<void> {
    const targetFile = libraryId
      ? Object.entries(workspace.manifest.files).find(([, entry]) => entry.writable && entry.libraryId === libraryId)?.[0]
      : workspace.activeFile;
    if (!targetFile) throw new Error('No writable CQL library is available to synchronize');
    const absolute = this.resolveReference(workspace, targetFile);
    await writeFile(absolute, content, { encoding: 'utf8', mode: 0o600 });
    workspace.baselineByFile.set(targetFile, content);
  }

  async syncWorkspace(
    workspace: MaterializedWorkspace,
    input: OpenCodeWorkspaceSyncRequest,
    options: { allowRemove?: boolean } = {}
  ): Promise<void> {
    const allowRemove = options.allowRemove !== false;
    const dependenciesDirectory = path.join(workspace.directory, 'dependencies');
    await chmod(dependenciesDirectory, 0o700).catch(() => undefined);

    const writableIds = new Set(input.libraries.map(library => library.id));
    const focusedId = input.focusedLibraryId && writableIds.has(input.focusedLibraryId)
      ? input.focusedLibraryId
      : input.libraries[0]?.id;
    const usedNames = new Set<string>();

    const nextFiles: OpenCodeWorkspaceManifest['files'] = {};
    const nextBaselines = new Map<string, string>();
    let activeFile = '';

    const existingByLibraryId = new Map(
      Object.entries(workspace.manifest.files).map(([file, entry]) => [entry.libraryId, { file, entry }])
    );

    for (const library of input.libraries) {
      if (!library.id || typeof library.cqlContent !== 'string') continue;
      const existing = existingByLibraryId.get(library.id);
      let relativeFile: string;
      if (existing?.file.startsWith('libraries/')) {
        relativeFile = existing.file;
        usedNames.add(path.basename(relativeFile).toLowerCase());
      } else {
        relativeFile = `libraries/${uniqueCqlFileName(library.name, library.id, usedNames)}`;
      }
      await writeFile(path.join(workspace.directory, relativeFile), library.cqlContent, {
        encoding: 'utf8',
        mode: 0o600,
      });
      nextFiles[relativeFile] = {
        libraryId: library.id,
        name: library.name,
        version: library.version,
        canonicalUrl: library.canonicalUrl,
        fhirVersionId: library.fhirVersionId,
        sourceHash: sha256(library.originalContent ?? library.cqlContent),
        draft: (library.originalContent ?? library.cqlContent) !== library.cqlContent,
        writable: true,
      };
      nextBaselines.set(relativeFile, library.cqlContent);
      if (library.id === focusedId) activeFile = relativeFile;
    }

    for (const dependency of input.dependencies ?? []) {
      if (!dependency.cqlContent.trim() || writableIds.has(dependency.id)) continue;
      const existing = existingByLibraryId.get(dependency.id);
      let relativeFile: string;
      if (existing?.file.startsWith('dependencies/') && !writableIds.has(dependency.id)) {
        relativeFile = existing.file;
        usedNames.add(path.basename(relativeFile).toLowerCase());
      } else {
        relativeFile = `dependencies/${uniqueCqlFileName(dependency.name, dependency.id, usedNames)}`;
      }
      await writeFile(path.join(workspace.directory, relativeFile), dependency.cqlContent, {
        encoding: 'utf8',
        mode: 0o400,
      }).catch(async () => {
        await chmod(path.join(workspace.directory, relativeFile), 0o600).catch(() => undefined);
        await writeFile(path.join(workspace.directory, relativeFile), dependency.cqlContent, {
          encoding: 'utf8',
          mode: 0o400,
        });
      });
      nextFiles[relativeFile] = {
        libraryId: dependency.id,
        name: dependency.name,
        version: dependency.version,
        canonicalUrl: dependency.canonicalUrl,
        fhirVersionId: dependency.fhirVersionId,
        sourceHash: sha256(dependency.originalContent ?? dependency.cqlContent),
        draft: false,
        writable: false,
      };
    }

    if (!activeFile) {
      activeFile = Object.keys(nextFiles).find(file => file.startsWith('libraries/')) ?? '';
    }

    if (allowRemove) {
      for (const [file] of Object.entries(workspace.manifest.files)) {
        if (nextFiles[file]) continue;
        await rm(path.join(workspace.directory, file), { force: true }).catch(() => undefined);
      }
    }

    workspace.manifest.files = nextFiles;
    workspace.manifest.activeLibraryId = activeFile ? (nextFiles[activeFile]?.libraryId ?? '') : '';
    workspace.activeFile = activeFile;
    workspace.baselineByFile = nextBaselines;
    await chmod(dependenciesDirectory, 0o500).catch(() => undefined);
    await this.writeAgentInstructions(workspace.directory, activeFile, workspace.manifest);
    const commandsDirectory = path.join(workspace.directory, '.opencode', 'commands');
    const validateVsacSkillDirectory = path.join(workspace.directory, '.opencode', 'skills', 'validate-vsac');
    await mkdir(commandsDirectory, { recursive: true, mode: 0o700 });
    await mkdir(validateVsacSkillDirectory, { recursive: true, mode: 0o700 });
    await this.writeCommands(workspace.directory, commandsDirectory, validateVsacSkillDirectory, activeFile);
    const manifestPath = path.join(workspace.directory, '.cql-studio', 'manifest.json');
    await chmod(manifestPath, 0o600).catch(() => undefined);
    await writeFile(manifestPath, JSON.stringify(workspace.manifest, null, 2), { encoding: 'utf8', mode: 0o400 });
  }

  async readActiveFile(workspace: MaterializedWorkspace): Promise<string> {
    if (!workspace.activeFile) return '';
    return readFile(this.resolveReference(workspace, workspace.activeFile), 'utf8');
  }

  async readFileContent(workspace: MaterializedWorkspace, relativeFile: string): Promise<string> {
    return readFile(this.resolveReference(workspace, relativeFile), 'utf8');
  }

  fileForLibrary(workspace: MaterializedWorkspace, libraryId: string): string | undefined {
    return Object.entries(workspace.manifest.files).find(([, entry]) => entry.libraryId === libraryId)?.[0];
  }

  writableLibraryIds(workspace: MaterializedWorkspace): string[] {
    return Object.values(workspace.manifest.files)
      .filter(entry => entry.writable)
      .map(entry => entry.libraryId);
  }

  async addAttachment(workspace: MaterializedWorkspace, input: OpenCodeAttachmentInput): Promise<OpenCodeAttachmentDto> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 200) throw new Error('Attachment filename is invalid');
    if (typeof input.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) {
      throw new Error('Attachment data must be base64 encoded');
    }
    const bytes = Buffer.from(input.data, 'base64');
    if (!bytes.length) throw new Error('Attachment is empty');
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`);

    const id = randomUUID();
    const extension = path.extname(name).toLowerCase();
    const stem = safeSegment(extension ? name.slice(0, -extension.length) : name, 'attachment');
    const temporary = path.join(workspace.directory, 'attachments', `.upload-${id}`);
    const converted = MARKITDOWN_EXTENSIONS.has(extension);
    const declaredText = TEXT_EXTENSIONS.has(extension) || (input.mimeType || '').toLowerCase().startsWith('text/');
    // Browsers frequently omit a MIME type for uncommon text extensions. Treat
    // valid UTF-8 without NUL bytes as text, while keeping binary uploads out.
    let decodedText: string | undefined;
    if (!converted && !declaredText && !bytes.includes(0)) {
      try {
        decodedText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        decodedText = undefined;
      }
    }
    const text = declaredText || (!BINARY_EXTENSIONS.has(extension) && decodedText !== undefined);
    if (!converted && !text) {
      throw new Error('Unsupported attachment type. Upload a text file, PDF, or DOCX document.');
    }

    await writeFile(temporary, bytes, { mode: 0o600 });
    try {
      let content: string;
      if (converted) {
        try {
          const result = await execFileAsync(this.markitdownBinPath, [temporary], {
            encoding: 'utf8',
            timeout: 30_000,
            maxBuffer: MAX_CONVERTED_BYTES,
          });
          content = result.stdout;
        } catch (error) {
          const detail = error instanceof Error ? error.message.split('\n')[0] : 'conversion failed';
          throw new Error(`Could not convert ${name} with MarkItDown: ${detail}`);
        }
      } else {
        content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      }
      if (!content.trim()) throw new Error(`Attachment ${name} did not contain readable text`);
      if (Buffer.byteLength(content, 'utf8') > MAX_CONVERTED_BYTES) {
        throw new Error(`Converted attachment exceeds the ${MAX_CONVERTED_BYTES / 1024 / 1024} MB text limit`);
      }
      const outputName = `${id.slice(0, 8)}-${stem}${converted ? '.md' : (extension || '.txt')}`;
      const relativePath = `attachments/${outputName}`;
      const outputPath = path.join(workspace.directory, relativePath);
      const header = converted ? `<!-- Converted from ${name} by MarkItDown -->\n\n` : '';
      await writeFile(outputPath, `${header}${content}`, { encoding: 'utf8', mode: 0o400 });
      return {
        id,
        name,
        mimeType: input.mimeType?.trim() || 'application/octet-stream',
        size: bytes.length,
        path: relativePath,
        converted,
        createdAt: new Date().toISOString(),
      };
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async removeAttachment(workspace: MaterializedWorkspace, attachment: OpenCodeAttachmentDto): Promise<void> {
    const relative = attachment.path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!relative.startsWith('attachments/') || relative.includes('..')) throw new Error('Attachment path is invalid');
    const resolved = path.resolve(workspace.directory, relative);
    if (!resolved.startsWith(`${path.join(workspace.directory, 'attachments')}${path.sep}`)) throw new Error('Attachment path escaped the workspace');
    await rm(resolved, { force: true });
  }

  async ensureProviderModel(workspace: MaterializedWorkspace, provider: OpenCodeProviderConfig, model: string): Promise<void> {
    const normalizedModel = model.trim();
    if (!normalizedModel || normalizedModel.length > 200) throw new Error('Provider model is invalid');
    const configPath = path.join(workspace.directory, 'opencode.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      provider?: Record<string, { models?: Record<string, unknown>; options?: Record<string, unknown>; npm?: string; name?: string }>;
    };
    const id = providerIdFor(provider);
    const providerConfig = config.provider?.[id];
    if (!providerConfig) throw new Error(`Provider is not configured for this session: ${id}`);
    providerConfig.models ??= {};
    providerConfig.models[normalizedModel] = {
      name: normalizedModel,
      options: { reasoningEffort: 'none' },
      variants: {
        fast: { reasoningEffort: 'none' },
        thinking: { reasoningEffort: 'medium' },
      },
    };
    // Keep the provider credentials/config read-only to the OpenCode process, but
    // briefly grant the runner owner write access while it updates the selected
    // model. `writeFile` does not change an existing file's mode, so attempting to
    // write the 0400 config directly fails with EACCES in the runner container.
    await chmod(configPath, 0o600);
    try {
      await writeFile(configPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    } finally {
      await chmod(configPath, 0o400).catch(() => undefined);
    }
  }

  isWritableFile(workspace: MaterializedWorkspace, candidate: string): boolean {
    const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '');
    const entry = workspace.manifest.files[normalized];
    if (entry?.writable) return true;
    const absolute = path.resolve(workspace.directory, candidate);
    return Object.entries(workspace.manifest.files).some(([file, fileEntry]) => {
      if (!fileEntry.writable) return false;
      return absolute === this.resolveReference(workspace, file);
    });
  }

  /** @deprecated Use isWritableFile. */
  isActiveFile(workspace: MaterializedWorkspace, candidate: string): boolean {
    return this.isWritableFile(workspace, candidate);
  }

  references(workspace: MaterializedWorkspace, query = '', limit = 30): Array<{ path: string; name: string; writable: boolean }> {
    const normalized = query.trim().toLowerCase().replace(/^@/, '');
    return Object.entries(workspace.manifest.files)
      .filter(([file]) => file.toLowerCase().endsWith('.cql') && (!normalized || file.toLowerCase().includes(normalized)))
      .slice(0, Math.min(Math.max(limit, 1), 50))
      .map(([file, entry]) => ({ path: file, name: path.basename(file), writable: entry.writable }));
  }

  resolveReference(workspace: MaterializedWorkspace, relativeFile: string): string {
    const normalized = relativeFile.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!workspace.manifest.files[normalized] || !normalized.toLowerCase().endsWith('.cql')) {
      throw new Error(`CQL workspace reference is not allowed: ${relativeFile}`);
    }
    const absolute = path.resolve(workspace.directory, normalized);
    if (!absolute.startsWith(`${workspace.directory}${path.sep}`)) {
      throw new Error(`CQL workspace reference escaped the workspace: ${relativeFile}`);
    }
    return absolute;
  }

  async validationPayload(workspace: MaterializedWorkspace, requestedFile?: string): Promise<{
    activeFile: string;
    files: Array<{ path: string; content: string; writable: boolean }>;
  }> {
    const activeFile = requestedFile || workspace.activeFile ||
      Object.keys(workspace.manifest.files).find(file => workspace.manifest.files[file]?.writable) ||
      Object.keys(workspace.manifest.files)[0] ||
      '';
    if (activeFile) this.resolveReference(workspace, activeFile);
    const files = await Promise.all(Object.entries(workspace.manifest.files).map(async ([file, entry]) => ({
      path: file,
      content: await readFile(this.resolveReference(workspace, file), 'utf8'),
      writable: entry.writable,
    })));
    return { activeFile, files };
  }

  async remove(workspace: MaterializedWorkspace): Promise<void> {
    const resolved = path.resolve(workspace.directory);
    if (path.dirname(resolved) !== this.root) {
      throw new Error('Refusing to remove a workspace outside the configured root');
    }
    // Dependencies are intentionally locked while a session is active; unlock only for cleanup.
    await chmod(path.join(resolved, 'dependencies'), 0o700).catch(() => undefined);
    await rm(resolved, { recursive: true, force: true });
  }
}
