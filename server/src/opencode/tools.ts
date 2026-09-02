// Author: Preston Lee

import { MCPToolNames, type MCPTool } from '@cql-studio/core';
import { ToolExecutor } from '../mcp/tools.js';
import { CqlWorkspaceValidator, type CqlWorkspaceValidationInput } from './cql-validator.js';

type EndpointRole = 'evaluation' | 'data' | 'terminology' | 'content';

interface EndpointConfiguration {
  address?: string;
  basicAuthUsername?: string;
  basicAuthPassword?: string;
  headers?: string[];
}

interface SessionEnvironment {
  id?: string;
  name?: string;
  evaluationServer?: EndpointConfiguration;
  dataEndpoint?: EndpointConfiguration;
  terminologyEndpoint?: EndpointConfiguration;
  contentEndpoint?: EndpointConfiguration;
}

export interface OpenCodeToolContext {
  environment?: unknown;
  toolContext?: {
    vsacFhirBaseUrl?: string;
    vsacApiUsername?: string;
    vsacApiPassword?: string;
    searxngBaseUrl?: string;
  };
}

const ROLE_FIELD: Record<EndpointRole, keyof SessionEnvironment> = {
  evaluation: 'evaluationServer',
  data: 'dataEndpoint',
  terminology: 'terminologyEndpoint',
  content: 'contentEndpoint',
};

const RESOURCE_SEGMENT = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const ID_SEGMENT = /^[A-Za-z0-9\-.]{1,64}$/;
const MAX_FHIR_RESPONSE_BYTES = 2_000_000;

const fhirTools: MCPTool[] = [
  {
    name: MCPToolNames.CQL_STUDIO_CONTEXT,
    description: 'Show the active CQL Studio environment and the configured FHIR endpoint addresses. Credentials and headers are never returned.',
    allowedInPlanMode: true,
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: MCPToolNames.FHIR_READ,
    description: 'Read one FHIR resource from the active CQL Studio environment. This tool is read-only. Use content for CQL Libraries, terminology for ValueSets/CodeSystems, and data for clinical resources.',
    allowedInPlanMode: true,
    parameters: {
      type: 'object',
      properties: {
        resourceType: { type: 'string', description: 'FHIR resource type, for example Library or ValueSet.' },
        id: { type: 'string', description: 'FHIR logical id.' },
        role: { type: 'string', enum: ['evaluation', 'data', 'terminology', 'content'], description: 'Endpoint role. Defaults to content.' },
      },
      required: ['resourceType', 'id'],
    },
  },
  {
    name: MCPToolNames.FHIR_SEARCH,
    description: 'Run a bounded, read-only FHIR search against an endpoint in the active CQL Studio environment. Returns at most 20 matching entries.',
    allowedInPlanMode: true,
    parameters: {
      type: 'object',
      properties: {
        resourceType: { type: 'string', description: 'FHIR resource type to search.' },
        query: { type: 'object', description: 'FHIR search parameters as string values.', additionalProperties: { type: 'string' } },
        role: { type: 'string', enum: ['evaluation', 'data', 'terminology', 'content'], description: 'Endpoint role. Defaults to data.' },
        count: { type: 'number', minimum: 1, maximum: 20, description: 'Maximum results; defaults to 10.' },
      },
      required: ['resourceType', 'query'],
    },
  },
  {
    name: MCPToolNames.VALUESET_EXPAND,
    description: 'Expand a ValueSet by canonical URL through the active terminology endpoint. This is read-only and returns at most 100 concepts.',
    allowedInPlanMode: true,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Exact ValueSet canonical URL.' },
        filter: { type: 'string', description: 'Optional expansion text filter.' },
        count: { type: 'number', minimum: 1, maximum: 100, description: 'Maximum concepts; defaults to 25.' },
      },
      required: ['url'],
    },
  },
];

const cqlTools: MCPTool[] = [
  {
    name: MCPToolNames.CQL_VALIDATE,
    description: 'Validate the current isolated workspace version of a CQL file with its dependencies, FHIR R4 model information, FHIRHelpers, and UCUM. Returns read-only structured diagnostics and never saves or edits anything.',
    allowedInPlanMode: true,
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Workspace-relative .cql file. Defaults to the active writable library.' },
      },
      required: [],
    },
  },
  {
    name: MCPToolNames.CQL_LIBRARY_SEARCH,
    description: 'Search for FHIR Library resources without modifying the server. Defaults to the content endpoint and returns bounded metadata only.',
    allowedInPlanMode: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'General Library name/title search text.' },
        name: { type: 'string', description: 'FHIR Library name search.' },
        version: { type: 'string', description: 'Exact FHIR Library version.' },
        url: { type: 'string', description: 'Exact Library canonical URL.' },
        role: { type: 'string', enum: ['content', 'evaluation'], description: 'FHIR endpoint role. Defaults to content.' },
        count: { type: 'number', minimum: 1, maximum: 20, description: 'Maximum results. Defaults to 10.' },
      },
      required: [],
    },
  },
  {
    name: MCPToolNames.CQL_LIBRARY_READ,
    description: 'Read one FHIR Library and its text/cql attachment without modifying the server. CQL content is capped at 1 MB.',
    allowedInPlanMode: true,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'FHIR Library logical id.' },
        role: { type: 'string', enum: ['content', 'evaluation'], description: 'FHIR endpoint role. Defaults to content.' },
      },
      required: ['id'],
    },
  },
];

export class OpenCodeToolExecutor {
  private readonly legacyTools = new ToolExecutor();

  private readonly validator: CqlWorkspaceValidator;

  constructor(options: { cqlAssetsDirectory?: string; cqlAssetsUrl?: string } = {}) {
    this.validator = new CqlWorkspaceValidator(options.cqlAssetsDirectory, options.cqlAssetsUrl);
  }

  async definitions(): Promise<MCPTool[]> {
    const existing = await this.legacyTools.getAvailableTools();
    const readOnlyLegacy = existing.map(tool => {
      if (!tool.name.startsWith('searxng_')) return tool;
      const properties = { ...tool.parameters.properties };
      delete properties['searxng_base_url'];
      return {
        ...tool,
        description: tool.description.replace(/Requires searxng_base_url[^.]*\.?/gi, 'The configured CQL Studio SearXNG endpoint is used.'),
        parameters: {
          ...tool.parameters,
          properties,
          required: (tool.parameters.required ?? []).filter(name => name !== 'searxng_base_url'),
        },
      };
    });
    return [...fhirTools, ...readOnlyLegacy, ...cqlTools];
  }

  async execute(name: string, rawParams: unknown, context: OpenCodeToolContext): Promise<unknown> {
    const params = this.objectParams(rawParams);
    switch (name) {
      case MCPToolNames.CQL_STUDIO_CONTEXT:
        return this.environmentSummary(context.environment);
      case MCPToolNames.FHIR_READ:
        return this.fhirRead(params, context.environment);
      case MCPToolNames.FHIR_SEARCH:
        return this.fhirSearch(params, context.environment);
      case MCPToolNames.VALUESET_EXPAND:
        return this.valuesetExpand(params, context.environment);
      case MCPToolNames.CQL_VALIDATE:
        return this.cqlValidate(params);
      case MCPToolNames.CQL_LIBRARY_SEARCH:
        return this.cqlLibrarySearch(params, context.environment);
      case MCPToolNames.CQL_LIBRARY_READ:
        return this.cqlLibraryRead(params, context.environment);
      default:
        if (!(await this.definitions()).some(tool => tool.name === name)) {
          throw new Error(`OpenCode tool is not allowed: ${name}`);
        }
        return this.legacyTools.executeTool(name, {
          ...params,
          ...(name.startsWith('searxng_') ? { searxng_base_url: context.toolContext?.searxngBaseUrl } : {}),
          ...(name === MCPToolNames.VSAC_SEARCH || name === MCPToolNames.VALIDATE_VSAC ? {
            vsac_fhir_base_url: context.toolContext?.vsacFhirBaseUrl,
            vsac_api_username: context.toolContext?.vsacApiUsername,
            vsac_api_password: context.toolContext?.vsacApiPassword,
          } : {}),
        });
    }
  }

  private cqlValidate(params: Record<string, unknown>) {
    const workspace = params['__workspace'] as CqlWorkspaceValidationInput | undefined;
    if (!workspace) throw new Error('cql_validate must be called from an active OpenCode workspace');
    return this.validator.validate(workspace);
  }

  private async cqlLibrarySearch(params: Record<string, unknown>, environment: unknown): Promise<unknown> {
    const role = this.libraryRole(params['role']);
    const count = Math.min(20, Math.max(1, Number(params['count']) || 10));
    const search = new URLSearchParams({ _count: String(count), _elements: 'id,url,name,title,version,status,publisher,date,type' });
    const query = String(params['query'] ?? '').trim();
    const name = String(params['name'] ?? '').trim();
    const version = String(params['version'] ?? '').trim();
    const canonical = String(params['url'] ?? '').trim();
    if (query) search.set('name:contains', query);
    if (name) search.set('name:contains', name);
    if (version) search.set('version', version);
    if (canonical) search.set('url', canonical);
    const bundle = await this.fhirGet(environment, role, `Library?${search}`) as Record<string, any>;
    const entries = Array.isArray(bundle['entry']) ? bundle['entry'].slice(0, count) : [];
    return {
      total: typeof bundle['total'] === 'number' ? bundle['total'] : entries.length,
      libraries: entries.map((entry: any) => {
        const library = entry?.resource ?? {};
        return {
          id: library.id,
          url: library.url,
          name: library.name,
          title: library.title,
          version: library.version,
          status: library.status,
          publisher: library.publisher,
          date: library.date,
          type: library.type,
        };
      }),
    };
  }

  private async cqlLibraryRead(params: Record<string, unknown>, environment: unknown): Promise<unknown> {
    const id = String(params['id'] ?? '');
    if (!ID_SEGMENT.test(id)) throw new Error('id must be a valid FHIR logical id');
    const library = await this.fhirGet(environment, this.libraryRole(params['role']), `Library/${id}`) as Record<string, any>;
    const attachments = Array.isArray(library['content']) ? library['content'] : [];
    const cqlAttachment = attachments.find((item: any) => item?.contentType === 'text/cql');
    let cqlContent: string | null = null;
    if (typeof cqlAttachment?.data === 'string') {
      const decoded = Buffer.from(cqlAttachment.data, 'base64');
      if (decoded.byteLength > 1_000_000) throw new Error('FHIR Library CQL attachment exceeded the 1 MB limit');
      cqlContent = decoded.toString('utf8');
    } else if (cqlAttachment?.url) {
      cqlContent = 'CQL is stored in an external attachment URL; use the hardened fetch tools if access is required.';
    }
    return {
      id: library['id'],
      url: library['url'],
      name: library['name'],
      title: library['title'],
      version: library['version'],
      status: library['status'],
      publisher: library['publisher'],
      description: library['description'],
      cqlContent,
    };
  }

  private async fhirRead(params: Record<string, unknown>, environment: unknown): Promise<unknown> {
    const resourceType = this.resourceType(params['resourceType']);
    const id = String(params['id'] ?? '');
    if (!ID_SEGMENT.test(id)) throw new Error('id must be a valid FHIR logical id');
    const role = this.role(params['role'], 'content');
    return this.fhirGet(environment, role, `${resourceType}/${id}`);
  }

  private async fhirSearch(params: Record<string, unknown>, environment: unknown): Promise<unknown> {
    const resourceType = this.resourceType(params['resourceType']);
    const role = this.role(params['role'], 'data');
    const query = this.objectParams(params['query']);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]{0,80}$/.test(key)) throw new Error(`Invalid FHIR search parameter: ${key}`);
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`FHIR search parameter ${key} must be a scalar value`);
      }
      search.append(key, String(value));
    }
    const count = Math.min(20, Math.max(1, Number(params['count']) || 10));
    search.set('_count', String(count));
    const bundle = await this.fhirGet(environment, role, `${resourceType}?${search.toString()}`) as Record<string, unknown>;
    if (Array.isArray(bundle?.['entry'])) bundle['entry'] = bundle['entry'].slice(0, count);
    return bundle;
  }

  private async valuesetExpand(params: Record<string, unknown>, environment: unknown): Promise<unknown> {
    const canonical = String(params['url'] ?? '').trim();
    const parsed = new URL(canonical);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('url must be an HTTP(S) ValueSet canonical URL');
    }
    const search = new URLSearchParams({ url: canonical });
    const filter = typeof params['filter'] === 'string' ? params['filter'].trim() : '';
    if (filter) search.set('filter', filter);
    search.set('count', String(Math.min(100, Math.max(1, Number(params['count']) || 25))));
    return this.fhirGet(environment, 'terminology', `ValueSet/$expand?${search.toString()}`);
  }

  private async fhirGet(environment: unknown, role: EndpointRole, relative: string): Promise<unknown> {
    const endpoint = this.endpoint(environment, role);
    const base = new URL(endpoint.address!.replace(/\/+$/, '') + '/');
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      throw new Error(`The ${role} endpoint must use HTTP or HTTPS`);
    }
    const url = new URL(relative, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error('FHIR request escaped the configured endpoint');
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: this.endpointHeaders(endpoint),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    if (body.length > MAX_FHIR_RESPONSE_BYTES) throw new Error('FHIR response exceeded the 2 MB tool limit');
    if (!response.ok) throw new Error(`FHIR ${role} request failed (${response.status}): ${body.slice(0, 500)}`);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }

  private endpoint(environment: unknown, role: EndpointRole): EndpointConfiguration {
    const parsed = this.objectParams(environment) as SessionEnvironment;
    const endpoint = parsed[ROLE_FIELD[role]] as EndpointConfiguration | undefined;
    if (!endpoint?.address?.trim()) throw new Error(`No ${role} FHIR endpoint is configured for this session`);
    return endpoint;
  }

  private endpointHeaders(endpoint: EndpointConfiguration): Headers {
    const headers = new Headers({ Accept: 'application/fhir+json, application/json' });
    for (const raw of endpoint.headers ?? []) {
      const colon = raw.indexOf(':');
      if (colon <= 0) continue;
      const name = raw.slice(0, colon).trim();
      if (/^(host|content-length|connection)$/i.test(name)) continue;
      headers.set(name, raw.slice(colon + 1).trim());
    }
    if (endpoint.basicAuthUsername || endpoint.basicAuthPassword) {
      const token = Buffer.from(`${endpoint.basicAuthUsername ?? ''}:${endpoint.basicAuthPassword ?? ''}`).toString('base64');
      headers.set('Authorization', `Basic ${token}`);
    }
    return headers;
  }

  private environmentSummary(environment: unknown): Record<string, unknown> {
    const parsed = this.objectParams(environment) as SessionEnvironment;
    const address = (endpoint?: EndpointConfiguration): string | null => endpoint?.address?.trim() || null;
    return {
      id: parsed.id,
      name: parsed.name,
      endpoints: {
        evaluation: address(parsed.evaluationServer),
        data: address(parsed.dataEndpoint),
        terminology: address(parsed.terminologyEndpoint),
        content: address(parsed.contentEndpoint),
      },
    };
  }

  private objectParams(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
  }

  private resourceType(value: unknown): string {
    const resourceType = String(value ?? '');
    if (!RESOURCE_SEGMENT.test(resourceType)) throw new Error('resourceType is invalid');
    return resourceType;
  }

  private role(value: unknown, fallback: EndpointRole): EndpointRole {
    const role = value == null || value === '' ? fallback : String(value);
    if (!(role in ROLE_FIELD)) throw new Error(`Unknown endpoint role: ${role}`);
    return role as EndpointRole;
  }

  private libraryRole(value: unknown): 'content' | 'evaluation' {
    const role = value == null || value === '' ? 'content' : String(value);
    if (role !== 'content' && role !== 'evaluation') throw new Error('Library endpoint role must be content or evaluation');
    return role;
  }
}
