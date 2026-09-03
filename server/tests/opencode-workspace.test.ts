// Author: Preston Lee

import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  isLightweightOpenCodeConversation,
  openCodeToolsForPrompt,
  isOpenCodeSessionProgress,
  openCodeAttachmentMimeType,
} from '../src/opencode/runtime.js';
import { openCodeResumeMessages, openCodeResumeTranscript } from '../src/opencode/session-history.js';
import { mcpBridgeExecutable, OpenCodeWorkspaceManager } from '../src/opencode/workspace.js';

const activeCql = `library Example version '1.0.0'\nusing FHIR version '4.0.1'\ninclude Shared version '1.0.0'\ndefine Answer: 42\n`;

test('does not treat global runner heartbeats as provider progress', () => {
  assert.equal(isOpenCodeSessionProgress(undefined, 'ses-active'), false);
  assert.equal(isOpenCodeSessionProgress('ses-other', 'ses-active'), false);
  assert.equal(isOpenCodeSessionProgress('ses-active', 'ses-active'), true);
});

test('normalizes provider-facing attachment MIME types', () => {
  assert.equal(openCodeAttachmentMimeType(false), 'text/plain');
  assert.equal(openCodeAttachmentMimeType(true), 'text/markdown');
});

test('uses the lightweight tool-free path only for context-free conversation', () => {
  assert.equal(isLightweightOpenCodeConversation({ message: 'Hi!' }), true);
  assert.equal(isLightweightOpenCodeConversation({ message: '  Hello there.  ' }), true);
  assert.equal(isLightweightOpenCodeConversation({ message: 'Hi, validate my CQL' }), false);
  assert.equal(isLightweightOpenCodeConversation({ message: 'Hi', references: ['dependencies/Shared.cql'] }), false);
  assert.equal(isLightweightOpenCodeConversation({ message: 'Thanks', attachments: ['attachment-1'] }), false);
  assert.equal(isLightweightOpenCodeConversation({
    message: 'Hello',
    editorContext: {
      file: 'libraries/Example.cql',
      selectedText: 'define Answer: 42',
      startLine: 4,
      startColumn: 1,
      endLine: 4,
      endColumn: 18,
      documentRevision: 1,
      mode: 'context',
    },
  }), false);
});

test('explicitly restores tools after a lightweight conversation turn', () => {
  assert.deepEqual(openCodeToolsForPrompt({ message: 'Hi' }), { '*': false });
  assert.deepEqual(openCodeToolsForPrompt({ message: 'Read the active CQL file' }), { '*': true });
});

test('builds resume context from chat text without internal or tool payloads', () => {
  const messages = [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'Review the measure.' }] },
    { info: { role: 'user' }, parts: [{ type: 'text', text: '<cql-studio-editor-context>hidden selection</cql-studio-editor-context>' }] },
    { info: { role: 'assistant' }, parts: [{ type: 'tool', state: { output: 'secret' } }, { type: 'text', text: 'The denominator needs a guard.' }] },
  ];
  const sanitized = JSON.stringify(openCodeResumeMessages(messages));
  const transcript = openCodeResumeTranscript(messages);
  assert.match(transcript, /User: Review the measure\./);
  assert.match(transcript, /Assistant: The denominator needs a guard\./);
  assert.doesNotMatch(transcript, /hidden selection|secret/);
  assert.doesNotMatch(sanitized, /hidden selection|secret|state/);
});

test('resolves the MCP bridge beside the compiled monorepo server module', () => {
  assert.equal(
    mcpBridgeExecutable('file:///app/server/dist/opencode/workspace.js', ''),
    '/app/server/dist/opencode/mcp-bridge.js'
  );
});

test('materializes a writable draft, read-only dependencies, MCP config, and a review diff', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cql-studio-opencode-'));
  const manager = new OpenCodeWorkspaceManager(root);
  await manager.initialize();
  const workspace = await manager.create({
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'qwen3-coder:latest',
    activeLibrary: {
      id: '../Example',
      name: '../Example With Spaces',
      version: '1.0.0',
      cqlContent: activeCql,
      originalContent: activeCql.replace('42', '41'),
    },
    dependencies: [{
      id: 'Shared',
      name: 'Shared',
      version: '1.0.0',
      cqlContent: `library Shared version '1.0.0'\ndefine SharedValue: true\n`,
    }],
    toolBridge: {
      baseUrl: 'http://host.docker.internal:3003/api/opencode/tool-bridge',
      capability: 'opaque-test-capability',
    },
  });

  try {
    assert.equal(workspace.activeFile, 'libraries/Example-With-Spaces.cql');
    assert.equal(await readFile(path.join(workspace.directory, workspace.activeFile), 'utf8'), activeCql);
    assert.equal((await stat(path.join(workspace.directory, workspace.activeFile))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(workspace.directory, 'dependencies/Shared.cql'))).mode & 0o777, 0o400);
    await assert.rejects(
      writeFile(path.join(workspace.directory, 'dependencies/Shared.cql'), 'changed', 'utf8')
    );

    const manifest = JSON.parse(await readFile(path.join(workspace.directory, '.cql-studio/manifest.json'), 'utf8'));
    assert.equal(manifest.activeLibraryId, '../Example');
    assert.equal(manifest.files[workspace.activeFile].draft, true);
    assert.equal(manifest.files['dependencies/Shared.cql'].writable, false);

    const config = JSON.parse(await readFile(path.join(workspace.directory, 'opencode.json'), 'utf8'));
    assert.equal(config.model, 'ollama/qwen3-coder:latest');
    assert.equal(config.provider.ollama.npm, '@ai-sdk/openai-compatible');
    assert.equal(config.provider.ollama.name, 'Ollama (local)');
    assert.equal(config.provider.ollama.options.baseURL, 'http://host.docker.internal:11434/v1');
    assert.equal(config.provider.ollama.models['qwen3-coder:latest'].options.reasoningEffort, 'none');
    assert.equal('tool_call' in config.provider.ollama.models['qwen3-coder:latest'], false);
    assert.deepEqual(config.permission, {
      edit: 'allow',
      bash: 'deny',
      webfetch: 'deny',
      external_directory: 'deny',
      doom_loop: 'ask',
    });
    assert.equal(config.mcp['cql-studio'].environment.CQL_STUDIO_SERVER_MCP_CAPABILITY, 'opaque-test-capability');
    assert.equal(config.mcp['cql-studio'].environment.CQL_STUDIO_SERVER_MCP_ACTIVE_FILE, workspace.activeFile);
    assert.match(config.mcp['cql-studio'].command[1], /\/opencode\/mcp-bridge\.js$/);
    assert.equal(config.provider.ollama.models['qwen3-coder:latest'].variants.fast.reasoningEffort, 'none');
    assert.equal(config.provider.ollama.models['qwen3-coder:latest'].variants.thinking.reasoningEffort, 'medium');
    const commandExpectations: Record<string, RegExp> = {
      validate: /cql_validate/,
      review: /First validate[\s\S]*cql_validate/,
      dependencies: /cql_library_search and cql_library_read/,
      context: /cql_studio_context/,
      fhir: /fhir_read or fhir_search/,
      research: /searxng_search and the hardened fetch tools/,
      terminology: /vsac_search[\s\S]*valueset_expand/,
    };
    for (const [command, expected] of Object.entries(commandExpectations)) {
      assert.match(await readFile(path.join(workspace.directory, `.opencode/commands/${command}.md`), 'utf8'), expected);
    }
    for (const protectedFile of [
      'AGENTS.md',
      'opencode.json',
      '.cql-studio/manifest.json',
      '.opencode/commands/validate.md',
    ]) {
      assert.equal((await stat(path.join(workspace.directory, protectedFile))).mode & 0o777, 0o400);
    }
    assert.deepEqual(manager.references(workspace, 'Shared'), [{
      path: 'dependencies/Shared.cql',
      name: 'Shared.cql',
      writable: false,
    }]);
    assert.throws(() => manager.resolveReference(workspace, '../outside.cql'), /not allowed/);

    const edited = activeCql.replace('42', '43');
    await writeFile(path.join(workspace.directory, workspace.activeFile), edited, 'utf8');
    assert.deepEqual(await manager.diff(workspace), [{
      file: workspace.activeFile,
      libraryId: '../Example',
      before: activeCql,
      after: edited,
      additions: 1,
      deletions: 1,
    }]);

    const browserDraft = activeCql.replace('42', '44');
    await manager.syncActiveFile(workspace, browserDraft);
    assert.equal(await manager.readActiveFile(workspace), browserDraft);
    assert.deepEqual(await manager.diff(workspace), []);
    assert.equal(manager.isActiveFile(workspace, workspace.activeFile), true);
    assert.equal(manager.isActiveFile(workspace, path.join(workspace.directory, workspace.activeFile)), true);
    assert.equal(manager.isActiveFile(workspace, 'dependencies/Shared.cql'), false);
  } finally {
    await manager.remove(workspace);
  }
});

test('writes OpenAI-compatible provider settings without changing the workspace boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cql-studio-opencode-provider-'));
  const manager = new OpenCodeWorkspaceManager(root);
  await manager.initialize();
  const workspace = await manager.create({
    provider: {
      type: 'openai-compatible',
      name: 'Acme AI',
      baseUrl: 'https://api.acme.example/v1',
      model: 'acme-coder',
      apiKey: 'secret-test-key',
    },
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'unused',
    activeLibrary: { id: 'Example', name: 'Example', cqlContent: activeCql },
    dependencies: [],
  });
  try {
    const config = JSON.parse(await readFile(path.join(workspace.directory, 'opencode.json'), 'utf8'));
    assert.equal(config.model, 'acme-ai/acme-coder');
    assert.equal(config.provider['acme-ai'].npm, '@ai-sdk/openai-compatible');
    assert.equal(config.provider['acme-ai'].name, 'Acme AI');
    assert.equal(config.provider['acme-ai'].options.baseURL, 'https://api.acme.example/v1');
    assert.equal(config.provider['acme-ai'].options.apiKey, 'secret-test-key');
  } finally {
    await manager.remove(workspace);
  }
});

test('updates a provider model while restoring the protected config mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cql-studio-opencode-model-'));
  const manager = new OpenCodeWorkspaceManager(root);
  await manager.initialize();
  const workspace = await manager.create({
    provider: {
      type: 'openai',
      model: 'gpt-4o-mini',
    },
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'unused',
    activeLibrary: { id: 'Example', name: 'Example', cqlContent: activeCql },
    dependencies: [],
  });
  try {
    await manager.ensureProviderModel(workspace, { type: 'openai', model: 'gpt-4.1-mini' }, 'gpt-4.1-mini');
    const config = JSON.parse(await readFile(path.join(workspace.directory, 'opencode.json'), 'utf8'));
    assert.equal(config.provider.openai.models['gpt-4.1-mini'].name, 'gpt-4.1-mini');
    assert.equal((await stat(path.join(workspace.directory, 'opencode.json'))).mode & 0o777, 0o400);
  } finally {
    await manager.remove(workspace);
  }
});

test('stores text attachments as read-only session files and rejects unsupported binaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cql-studio-opencode-attachments-'));
  const manager = new OpenCodeWorkspaceManager(root);
  await manager.initialize();
  const workspace = await manager.create({
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'qwen3-coder:latest',
    activeLibrary: { id: 'Example', name: 'Example', cqlContent: activeCql },
    dependencies: [],
  });
  try {
    const attachment = await manager.addAttachment(workspace, {
      name: 'notes.md',
      mimeType: 'text/markdown',
      data: Buffer.from('# Notes\n\nUse the attached context.').toString('base64'),
    });
    assert.equal(attachment.converted, false);
    assert.equal(attachment.path.startsWith('attachments/'), true);
    assert.equal(await readFile(path.join(workspace.directory, attachment.path), 'utf8'), '# Notes\n\nUse the attached context.');
    assert.equal((await stat(path.join(workspace.directory, attachment.path))).mode & 0o777, 0o400);
    const uncommonText = await manager.addAttachment(workspace, {
      name: 'notes.weird-text',
      data: Buffer.from('plain UTF-8 text with an uncommon extension').toString('base64'),
    });
    assert.equal(await readFile(path.join(workspace.directory, uncommonText.path), 'utf8'), 'plain UTF-8 text with an uncommon extension');
    await assert.rejects(
      manager.addAttachment(workspace, {
        name: 'payload.exe',
        mimeType: 'application/octet-stream',
        data: Buffer.from([0, 1, 2, 3]).toString('base64'),
      }),
      /Unsupported attachment type/,
    );
    await manager.removeAttachment(workspace, attachment);
    await assert.rejects(stat(path.join(workspace.directory, attachment.path)));
  } finally {
    await manager.remove(workspace);
  }
});
