// Author: Preston Lee

import express from 'express';

export interface AllowlistedFhirProxyOptions {
  /** Express mount path, e.g. `/api/vsac/fhir`. */
  mountPath: string;
  allowedHosts: ReadonlySet<string>;
  defaultBaseUrl: string;
  /** Incoming request header name (lowercase), e.g. `x-vsac-fhir-base-url`. */
  baseUrlHeaderName: string;
  /** Forward client Authorization to upstream (VSAC Basic auth). Default false. */
  forwardAuthorization?: boolean;
  /** Label used in 400 error messages. */
  label?: string;
}

function normalizeFhirBase(
  raw: string | undefined,
  defaultBaseUrl: string,
  allowedHosts: ReadonlySet<string>
): URL | null {
  const s = (raw?.trim() || defaultBaseUrl).replace(/\/+$/, '');
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    if (!allowedHosts.has(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

function pickForwardHeaders(
  req: express.Request,
  forwardAuthorization: boolean
): Record<string, string> {
  const out: Record<string, string> = {};
  if (forwardAuthorization) {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.trim() !== '') {
      out.Authorization = auth;
    }
  }
  const accept = req.headers.accept;
  if (typeof accept === 'string' && accept.trim() !== '') {
    out.Accept = accept;
  }
  const ct = req.headers['content-type'];
  if (typeof ct === 'string' && ct.trim() !== '') {
    out['Content-Type'] = ct;
  }
  return out;
}

/**
 * Creates an Express router that proxies FHIR HTTP to an allowlisted HTTPS base URL.
 */
export function createAllowlistedFhirProxyRouter(options: AllowlistedFhirProxyOptions): express.Router {
  const {
    mountPath,
    allowedHosts,
    defaultBaseUrl,
    baseUrlHeaderName,
    forwardAuthorization = false,
    label = 'FHIR'
  } = options;
  const displayHeader = baseUrlHeaderName
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('-');
  const errorMessage = `Invalid or missing ${displayHeader} (https host must be allowlisted)`;

  const router = express.Router();
  router.all(/.*/, async (req, res, next) => {
    try {
      const headerVal = req.headers[baseUrlHeaderName];
      const base = normalizeFhirBase(
        typeof headerVal === 'string' ? headerVal : undefined,
        defaultBaseUrl,
        allowedHosts
      );
      if (!base) {
        res.status(400).json({ error: errorMessage });
        return;
      }
      const stripped = req.originalUrl.split('?')[0].replace(new RegExp(`^${mountPath}`), '') || '/';
      const path = stripped.startsWith('/') ? stripped : `/${stripped}`;
      const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const baseStr = base.toString().replace(/\/+$/, '');
      const target = new URL(`${baseStr}${path}${search}`);

      const init: RequestInit = {
        method: req.method,
        headers: pickForwardHeaders(req, forwardAuthorization),
        redirect: 'manual'
      };
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null) {
        init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }

      const response = await fetch(target, init);
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      res.status(response.status);
      res.setHeader('Content-Type', contentType);
      const buf = Buffer.from(await response.arrayBuffer());
      res.send(buf);
    } catch (err) {
      next(err);
    }
  });
  void label;
  return router;
}
