// Author: Preston Lee

import express from 'express';

/** Hosts NLM documents for VSAC FHIR and SVS; do not widen without review. */
const ALLOWED_HOSTS = new Set(['cts.nlm.nih.gov', 'uat-cts.nlm.nih.gov', 'vsac.nlm.nih.gov']);

export const DEFAULT_VSAC_FHIR_BASE = 'https://cts.nlm.nih.gov/fhir';
const VSAC_SITE_ORIGIN = 'https://vsac.nlm.nih.gov';

const FHIR_BASE_HEADER = 'x-vsac-fhir-base-url';

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.has(hostname);
}

function normalizeFhirBase(raw: string | undefined): URL | null {
  const s = (raw?.trim() || DEFAULT_VSAC_FHIR_BASE).replace(/\/+$/, '');
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    if (!isAllowedHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

function forwardHeaders(req: express.Request): Record<string, string> {
  const out: Record<string, string> = {};
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.trim() !== '') {
    out.Authorization = auth;
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
 * Mounted at `/api/vsac/fhir`. GET /api/vsac/fhir/metadata → X-VSAC-FHIR-Base-URL + /metadata
 */
export const vsacFhirProxyRouter = express.Router();
vsacFhirProxyRouter.all(/.*/, async (req, res, next) => {
  try {
    const base = normalizeFhirBase(
      typeof req.headers[FHIR_BASE_HEADER] === 'string' ? req.headers[FHIR_BASE_HEADER] : undefined
    );
    if (!base) {
      res.status(400).json({ error: 'Invalid or missing X-VSAC-FHIR-Base-URL (https host must be allowlisted)' });
      return;
    }
    const mount = '/api/vsac/fhir';
    const stripped = req.originalUrl.split('?')[0].replace(new RegExp(`^${mount}`), '') || '/';
    const path = stripped.startsWith('/') ? stripped : `/${stripped}`;
    const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const baseStr = base.toString().replace(/\/+$/, '');
    const target = new URL(`${baseStr}${path}${search}`);

    const init: RequestInit = {
      method: req.method,
      headers: forwardHeaders(req),
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

/**
 * Mounted at `/api/vsac/site`. GET /api/vsac/site/vsac/programs → https://vsac.nlm.nih.gov/vsac/programs
 */
export const vsacSiteProxyRouter = express.Router();
vsacSiteProxyRouter.all(/.*/, async (req, res, next) => {
  try {
    const mount = '/api/vsac/site';
    const stripped = req.originalUrl.split('?')[0].replace(new RegExp(`^${mount}`), '') || '/';
    const path = stripped.startsWith('/') ? stripped : `/${stripped}`;
    const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    if (!path.startsWith('/vsac/')) {
      res.status(400).json({ error: 'Path must start with /vsac/ (NLM VSAC site only)' });
      return;
    }
    const target = new URL(`${VSAC_SITE_ORIGIN}${path}${search}`);
    if (target.origin !== VSAC_SITE_ORIGIN || !isAllowedHost(target.hostname)) {
      res.status(400).json({ error: 'Invalid VSAC site target' });
      return;
    }

    const init: RequestInit = {
      method: req.method,
      headers: forwardHeaders(req),
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
