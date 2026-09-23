// Author: Preston Lee

import express from 'express';
import { CmsContentUrlError, resolveCmsContentTarget } from './allowlist.js';

const GITHUB_USER_AGENT = 'CQL-Studio-Server';

/**
 * GET /api/cms-content?url= — fetches an allowlisted GitHub contents, raw, or CMS dependency URL.
 * A browser Authorization header is ignored. An optional server token is attached instead.
 */
export function createCmsContentProxyRouter(githubToken?: string): express.Router {
  const token = githubToken?.trim() ?? '';
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const raw = typeof req.query.url === 'string' ? req.query.url : '';
      if (!raw) {
        res.status(400).json({ error: 'Missing url query parameter' });
        return;
      }
      let target: URL;
      try {
        target = resolveCmsContentTarget(raw);
      } catch (err) {
        const message = err instanceof CmsContentUrlError ? err.message : 'URL is not allowlisted';
        res.status(400).json({ error: message });
        return;
      }

      const headers: Record<string, string> = {
        'User-Agent': GITHUB_USER_AGENT,
        Accept:
          typeof req.headers.accept === 'string' && req.headers.accept.trim() !== ''
            ? req.headers.accept
            : 'application/vnd.github+json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(target, {
        method: 'GET',
        headers,
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        res.status(502).json({ error: 'Upstream redirect refused' });
        return;
      }
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      res.status(response.status);
      res.setHeader('Content-Type', contentType);
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      next(err);
    }
  });

  router.all(/.*/, (_req, res) => {
    res.status(405).json({ error: 'Only GET is allowed' });
  });

  return router;
}
