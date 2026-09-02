// Author: Preston Lee

import { readFile } from 'node:fs/promises';
import path from 'node:path';
// @ts-expect-error The package does not publish TypeScript declarations for this subpath.
import * as ucum from '@lhncbc/ucum-lhc';
import {
  CqlTranslator,
  LibraryManager,
  ModelManager,
  createLibrarySourceProvider,
  createModelInfoProvider,
  createUcumService,
  stringAsSource,
  type CqlCompilerException,
} from '@cqframework/cql/cql-to-elm';
import type { OpenCodeDiagnosticDto, OpenCodeValidationDto } from '@cql-studio/core';

export interface CqlWorkspaceValidationInput {
  activeFile: string;
  files: Array<{ path: string; content: string; writable?: boolean }>;
}

interface ValidationAssets {
  system: string;
  fhir: string;
  fhirHelpers: string;
}

export class CqlWorkspaceValidator {
  private assetsPromise: Promise<ValidationAssets> | null = null;

  constructor(
    private readonly assetsDirectory?: string,
    private readonly assetsUrl?: string
  ) {}

  async validate(input: CqlWorkspaceValidationInput): Promise<OpenCodeValidationDto> {
    if (!input?.activeFile || !Array.isArray(input.files)) throw new Error('CQL validation workspace is invalid');
    const active = input.files.find(file => file.path === input.activeFile);
    if (!active) throw new Error(`CQL validation file is not present: ${input.activeFile}`);
    if (active.content.length > 1_000_000) throw new Error('CQL file exceeded the 1 MB validation limit');

    const assets = await this.loadAssets();
    const modelManager = new ModelManager(undefined, true);
    modelManager.modelInfoLoader.registerModelInfoProvider(createModelInfoProvider(
      (id: string, system: string | null | undefined, version: string | null | undefined) => {
        if (id === 'System' && !system) return stringAsSource(assets.system);
        if (id === 'FHIR' && !system && version === '4.0.1') return stringAsSource(assets.fhir);
        return null;
      }
    ), true);

    const byLibrary = new Map<string, string>();
    for (const file of input.files) {
      if (file.content.length > 1_000_000) continue;
      const match = file.content.match(/^\s*library\s+([A-Za-z][A-Za-z0-9_]*)\s*(?:version\s+'([^']+)')?/im);
      if (!match) continue;
      byLibrary.set(`${match[1]}|${match[2] || ''}`, file.content);
      byLibrary.set(`${match[1]}|`, file.content);
    }
    byLibrary.set('FHIRHelpers|4.0.1', byLibrary.get('FHIRHelpers|4.0.1') ?? assets.fhirHelpers);

    const validateUnit = (unit: string): string | null => {
      const result = ucum.UcumLhcUtils.getInstance().validateUnitString(unit);
      return result.status === 'valid' ? null : result.msg?.[0] ?? 'Invalid UCUM unit';
    };
    const manager = new LibraryManager(
      modelManager,
      undefined,
      undefined,
      createUcumService(() => { throw new Error('Unsupported UCUM conversion'); }, validateUnit)
    );
    manager.librarySourceLoader.registerProvider(createLibrarySourceProvider(
      (id: string, _system: string | null | undefined, version: string | null | undefined) => {
        const source = byLibrary.get(`${id}|${version ?? ''}`) ?? byLibrary.get(`${id}|`);
        return source ? stringAsSource(source) : null;
      }
    ));

    let diagnostics: OpenCodeDiagnosticDto[];
    try {
      const translator = CqlTranslator.fromText(active.content, manager);
      diagnostics = [
        ...this.exceptions(translator.errors?.asJsReadonlyArrayView() ?? [], 'error', active.path),
        ...this.exceptions(translator.warnings?.asJsReadonlyArrayView() ?? [], 'warning', active.path),
        ...this.exceptions(translator.messages?.asJsReadonlyArrayView() ?? [], 'info', active.path),
      ];
    } catch (error) {
      diagnostics = [{
        severity: 'error',
        file: active.path,
        message: `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
      }];
    }
    const seen = new Set<string>();
    diagnostics = diagnostics.filter(item => {
      const key = `${item.severity}|${item.file}|${item.line}|${item.column}|${item.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      valid: !diagnostics.some(item => item.severity === 'error'),
      diagnostics,
      checkedAt: new Date().toISOString(),
    };
  }

  private exceptions(
    values: ReadonlyArray<CqlCompilerException | null | undefined>,
    severity: OpenCodeDiagnosticDto['severity'],
    file: string
  ): OpenCodeDiagnosticDto[] {
    return values.filter((value): value is CqlCompilerException => value != null).map(exception => {
      const locator = exception.locator as Record<string, unknown> | null;
      const line = typeof locator?.['x8z_1'] === 'number' ? Math.max(1, Number(locator['x8z_1'])) : undefined;
      const column = typeof locator?.['y8z_1'] === 'number' ? Math.max(0, Number(locator['y8z_1'])) : undefined;
      return { severity, file, message: exception.message || 'Unknown CQL compiler message', line, column };
    });
  }

  private loadAssets(): Promise<ValidationAssets> {
    this.assetsPromise ??= Promise.all([
      this.loadAsset('system-modelinfo.xml'),
      this.loadAsset('fhir-modelinfo-4.0.1.xml'),
      this.loadAsset('FHIRHelpers-4.0.1.cql'),
    ]).then(([system, fhir, fhirHelpers]) => ({ system, fhir, fhirHelpers }));
    return this.assetsPromise;
  }

  private async loadAsset(name: string): Promise<string> {
    if (this.assetsDirectory) {
      return readFile(path.join(this.assetsDirectory, name), 'utf8');
    }
    if (!this.assetsUrl) throw new Error('CQL validation assets are not configured');
    const response = await fetch(`${this.assetsUrl.replace(/\/+$/, '')}/${name}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Failed to load CQL validation asset ${name} (${response.status})`);
    return response.text();
  }
}
