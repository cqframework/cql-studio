// Author: Preston Lee

import { Injectable } from '@angular/core';
import type { CqlCompilerException } from '@cqframework/cql/cql-to-elm';
import {
  extractLocatorInfo as extractLocatorInfoShared,
  formatLocator as formatLocatorShared,
  type LocatorInfo
} from '@cql-studio/core';

export type { LocatorInfo };

/**
 * Angular wrapper around shared CQL locator helpers in `@cql-studio/core`.
 * Kotlin/JS TrackBack field names are mangled and change between builds; the shared
 * implementation prefers unmangled properties and TrackBack.toString().
 */
@Injectable({
  providedIn: 'root'
})
export class CqlLocatorUtilsService {
  extractLocatorInfo(exception: CqlCompilerException): LocatorInfo {
    return extractLocatorInfoShared(exception);
  }

  formatLocator(locatorInfo: LocatorInfo): string {
    return formatLocatorShared(locatorInfo);
  }
}
