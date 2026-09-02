// Author: Preston Lee

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) {
    await auth.refreshSession();
  }
  if (!auth.ssoEnabled()) {
    return router.createUrlTree(['/']);
  }
  if (!auth.isAuthenticated()) {
    auth.login(router.url);
    return false;
  }
  return true;
};
