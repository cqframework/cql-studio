// Author: Preston Lee

import type { Request, Response, NextFunction } from 'express';
import type { User } from '@prisma/client';
import { getPrisma } from '../db/prisma.js';
import type { ServerEnv } from '../config/env.js';
import { hmacSign, hmacVerify } from './hmac.js';

export const SESSION_COOKIE = 'cql_studio_session';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

export function signSessionId(sessionId: string, secret: string): string {
  return hmacSign(sessionId, secret);
}

export function verifySessionCookie(
  cookieValue: string,
  secrets: readonly string[]
): { sessionId: string; usedPreviousSecret: boolean } | null {
  const result = hmacVerify(cookieValue, secrets);
  if (!result) {
    return null;
  }
  return { sessionId: result.payload, usedPreviousSecret: result.usedPreviousSecret };
}

/** Cookie flags for BFF sessions when the UI calls CQL_STUDIO_SERVER_BASE_URL (may be cross-origin). */
export function sessionCookieOptions(env: ServerEnv): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'none';
  path: '/';
} {
  const secure = env.nodeEnv === 'production';
  return {
    httpOnly: true,
    secure,
    // Production: SameSite=None so credentialed XHR from the Studio origin includes the cookie.
    // Dev (http localhost): Lax is enough — different ports on localhost are same-site.
    sameSite: secure ? 'none' : 'lax',
    path: '/',
  };
}

export function setSessionCookie(res: Response, sessionId: string, env: ServerEnv, expiresAt: Date): void {
  const value = signSessionId(sessionId, env.sessionSecret);
  res.cookie(SESSION_COOKIE, value, {
    ...sessionCookieOptions(env),
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, env: ServerEnv): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(env));
}

export function requireSsoConfigured(env: ServerEnv) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!env.ssoConfigured) {
      res.status(404).json({ error: 'SSO is not configured on this deployment' });
      return;
    }
    next();
  };
}

export function optionalAuth(env: ServerEnv) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!env.ssoConfigured) {
      next();
      return;
    }
    try {
      const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
      if (!raw) {
        next();
        return;
      }
      const verified = verifySessionCookie(raw, env.sessionSecrets);
      if (!verified) {
        next();
        return;
      }
      const prisma = getPrisma();
      const session = await prisma.session.findUnique({
        where: { id: verified.sessionId },
        include: { user: true },
      });
      if (!session || session.expiresAt < new Date()) {
        if (session) {
          await prisma.session.delete({ where: { id: verified.sessionId } }).catch(() => undefined);
        }
        next();
        return;
      }
      req.user = session.user;
      req.sessionId = session.id;
      // Lazy re-key: cookie verified with a previous secret → rewrite with current secret
      if (verified.usedPreviousSecret) {
        setSessionCookie(res, session.id, env, session.expiresAt);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAuth(env: ServerEnv) {
  const optional = optionalAuth(env);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await optional(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      next();
    });
  };
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}
