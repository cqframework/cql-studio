// Author: Preston Lee

import express from 'express';
import { RateLimitError } from '../services/rate-limiter.js';
import { logger } from '../logger.js';
import { ToolExecutor } from './tools.js';

const router = express.Router();
const toolExecutor = new ToolExecutor();

/**
 * GET /tools
 * List all available MCP tools
 */
router.get('/tools', async (req, res) => {
  try {
    const tools = await toolExecutor.getAvailableTools();
    res.json(tools);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err }, 'MCP GET /tools failed');
    res.status(500).json({ error: 'Failed to get tools' });
  }
});

/**
 * POST /execute
 * Execute an MCP tool
 */
router.post('/execute', async (req, res) => {
  const method = req.body?.method;
  try {
    if (!method) {
      return res.status(400).json({ error: 'Missing method parameter' });
    }

    const params = req.body?.params ?? {};
    const result = await toolExecutor.executeTool(method, params);
    res.json({ result });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ method: method ?? '(missing)', err }, 'MCP POST /execute failed');
    if (err instanceof RateLimitError) {
      res.status(429).json({
        error: {
          code: err.code,
          message: err.message || 'Rate limit exceeded'
        }
      });
      return;
    }
    res.status(500).json({
      error: {
        code: -32000,
        message: err.message || 'Tool execution failed'
      }
    });
  }
});

export { router as mcpRouter };
