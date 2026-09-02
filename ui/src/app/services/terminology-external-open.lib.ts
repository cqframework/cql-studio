// Author: Preston Lee

import { effect, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ToastService } from './toast.service';
import {
  TerminologyOpenResourceType,
  TerminologyOpenedResource,
  TerminologyResourceOpenerService,
} from './terminology-resource-opener.service';
import {
  TERMINOLOGY_QUERY_ID,
  TERMINOLOGY_QUERY_URL,
} from './terminology-resource-opener.deep-link';
import { terminologyHttpErrorMessage } from './terminology-ui.lib';

type OpenedResourceOfType<T extends TerminologyOpenResourceType> = Extract<
  TerminologyOpenedResource,
  { resourceType: T }
>;

export interface OpenTerminologyFromExternalRequestOptions<
  TType extends TerminologyOpenResourceType
> {
  resourceType: TType;
  id: string;
  url?: string;
  getHandledKey: () => string | null;
  setHandledKey: (key: string) => void;
  hasValidConfiguration: () => boolean;
  opener: TerminologyResourceOpenerService;
  toast: ToastService;
  onOpened: (resource: OpenedResourceOfType<TType>) => void | Promise<void>;
}

export async function openTerminologyFromExternalRequest<
  TType extends TerminologyOpenResourceType
>(opts: OpenTerminologyFromExternalRequestOptions<TType>): Promise<void> {
  const key = `${opts.resourceType}:${opts.id}\0${opts.url ?? ''}`;
  if (opts.getHandledKey() === key) {
    return;
  }
  opts.setHandledKey(key);

  if (!opts.hasValidConfiguration()) {
    opts.toast.showWarning(
      'Please configure terminology service settings first.',
      'Configuration Required'
    );
    return;
  }

  try {
    const resource = await opts.opener.fetchResource({
      resourceType: opts.resourceType,
      id: opts.id,
      url: opts.url,
    });
    if (!resource || resource.resourceType !== opts.resourceType) {
      opts.toast.showError(`${opts.resourceType} "${opts.id}" was not found.`, 'Open Failed');
      return;
    }
    await opts.onOpened(resource as OpenedResourceOfType<TType>);
  } catch (error) {
    opts.toast.showError(terminologyHttpErrorMessage(error), 'Open Failed');
  }
}

/** Call from a component constructor (injection context required). */
export function bindTerminologyTabDeepLinks(
  resourceType: TerminologyOpenResourceType,
  deps: {
    opener: TerminologyResourceOpenerService;
    route: ActivatedRoute;
    open: (id: string, url?: string) => void;
  }
): void {
  effect(() => {
    const pending = deps.opener.pending();
    if (!pending || pending.resourceType !== resourceType) {
      return;
    }
    untracked(() => {
      const request = deps.opener.consumePending(resourceType);
      if (!request) {
        return;
      }
      void deps.open(request.id, request.url);
    });
  });

  deps.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
    const id = params.get(TERMINOLOGY_QUERY_ID)?.trim();
    if (!id || deps.opener.pending()?.resourceType === resourceType) {
      return;
    }
    void deps.open(id, params.get(TERMINOLOGY_QUERY_URL) ?? undefined);
  });
}
