// Author: Preston Lee

import { firstValueFrom, type Observable } from 'rxjs';
import type { Bundle, ValueSet } from 'fhir/r4';
import { extractValueSets } from './elm-to-sql';
import {
  bundledValueSetsForServerPublish,
  expandValueSetsForServerPublish,
} from '../../services/sql-on-fhir/sql-on-fhir-value-set-publish.lib';

export function buildCms125ValueSetsForServer(elmJson: string, bundled: ValueSet[]): ValueSet[] {
  const parsed = JSON.parse(elmJson) as { library?: unknown };
  const wrapper = 'library' in parsed ? parsed : { library: parsed };
  const refs = extractValueSets(wrapper as Parameters<typeof extractValueSets>[0]);
  return expandValueSetsForServerPublish(refs, bundled);
}

export interface ResolveCms125BundledValueSetsDeps {
  getBundled: () => ValueSet[];
  setBundled: (valueSets: ValueSet[]) => void;
  loadCms125ValueSets: () => Observable<ValueSet[]>;
}

export async function resolveCms125BundledValueSets(
  deps: ResolveCms125BundledValueSetsDeps,
): Promise<ValueSet[]> {
  const bundled = deps.getBundled();
  if (bundled.length > 0) {
    return bundled;
  }
  const loaded = await firstValueFrom(deps.loadCms125ValueSets());
  deps.setBundled(loaded);
  return loaded;
}

export interface EnsureCms125ValueSetsOnServerDeps extends ResolveCms125BundledValueSetsDeps {
  alreadyOnServer: () => boolean;
  setOnServer: (onServer: boolean) => void;
  publishValueSetsToServer: (valueSets: ValueSet[]) => Promise<void>;
}

export async function ensureCms125ValueSetsOnServer(
  elmJson: string,
  deps: EnsureCms125ValueSetsOnServerDeps,
): Promise<void> {
  if (deps.alreadyOnServer()) {
    return;
  }
  const bundled = await resolveCms125BundledValueSets(deps);
  const toPublish = buildCms125ValueSetsForServer(elmJson, bundled);
  if (toPublish.length === 0) {
    throw new Error('No CMS125 value sets matched the translated ELM library');
  }
  await deps.publishValueSetsToServer(toPublish);
  deps.setOnServer(true);
}

export interface PublishCms125DemoToServerInitialDeps {
  publishValueSetsToServer: (valueSets: ValueSet[]) => Promise<void>;
  publishBundleToServer: (bundle: Bundle) => Promise<void>;
  setOnServer: (onServer: boolean) => void;
  setDemoLoadError: (message: string) => void;
}

export async function publishCms125DemoToServerInitial(
  bundled: ValueSet[],
  bundle: Bundle,
  deps: PublishCms125DemoToServerInitialDeps,
): Promise<void> {
  try {
    const toPublish = bundledValueSetsForServerPublish(bundled);
    await deps.publishValueSetsToServer(toPublish);
    await deps.publishBundleToServer(bundle);
    deps.setOnServer(true);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.setDemoLoadError(
      `CMS125 demo loaded locally, but upload to the FHIR server failed: ${msg}`,
    );
  }
}

export interface PublishCms125ValueSetsToServerDeps {
  getPublishToken: () => string | null;
  setPublishToken: (token: string | null) => void;
  setOnServer: (onServer: boolean) => void;
  setDemoLoadError: (message: string) => void;
  publishValueSetsToServer: (valueSets: ValueSet[]) => Promise<void>;
}

export async function publishCms125ValueSetsToServer(
  elmJson: string,
  bundled: ValueSet[],
  token: string,
  deps: PublishCms125ValueSetsToServerDeps,
): Promise<void> {
  try {
    const toPublish = buildCms125ValueSetsForServer(elmJson, bundled);
    if (toPublish.length === 0) {
      deps.setPublishToken(null);
      return;
    }
    await deps.publishValueSetsToServer(toPublish);
    deps.setOnServer(true);
  } catch (err: unknown) {
    deps.setPublishToken(null);
    const msg = err instanceof Error ? err.message : String(err);
    deps.setDemoLoadError(`CMS125 ValueSet upload failed after ELM translation: ${msg}`);
  } finally {
    if (deps.getPublishToken() !== token) {
      return;
    }
  }
}
