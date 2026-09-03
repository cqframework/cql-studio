// Author: Preston Lee

/** Path-only return targets for the Studio UI (blocks //open-redirect and absolute URLs). */
export function sanitizeReturnToPath(returnTo: string | undefined | null): string {
  if (
    typeof returnTo !== 'string' ||
    !returnTo.startsWith('/') ||
    returnTo.startsWith('//') ||
    returnTo.includes('\\') ||
    returnTo.includes('://')
  ) {
    return '/';
  }
  return returnTo;
}
