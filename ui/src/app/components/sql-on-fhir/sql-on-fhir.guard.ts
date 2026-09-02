// Author: Eugene Vestel
//
// Route guard for the experimental SQL-on-FHIR workspace (Issue #23).
// Mirrors the navigation menu gate (experimental + developer flags) so that
// direct navigation to /sql also respects the feature flag rather than only
// hiding the menu entry. Remove this guard when the feature flag is lifted.

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SettingsService } from '../../services/settings.service';

export const sqlOnFhirGuard: CanActivateFn = () => {
  const settings = inject(SettingsService).settings();
  const enabled = settings.experimental && settings.developer;
  if (enabled) {
    return true;
  }
  // Feature flag off — send the user back to the dashboard.
  return inject(Router).createUrlTree(['/']);
};
