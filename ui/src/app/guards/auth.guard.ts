// Author: Preston Lee

import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateChildFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loaded()) {
    await auth.refreshSession();
  }
  if (auth.isAuthenticated()) {
    return true;
  }

  const attempted = state.url || '/';
  if (attempted === '/' || attempted === '') {
    return router.createUrlTree(['/']);
  }
  return router.createUrlTree(['/'], { queryParams: { returnTo: attempted } });
};
