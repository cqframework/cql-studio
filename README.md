# CQL Studio
![Docker Image Version](https://shields.foundry.hl7.org/docker/v/hlseven/quality-cql-studio)
![Docker Pulls](https://shields.foundry.hl7.org/docker/pulls/hlseven/quality-cql-studio)

CQL Studio is an integrated web application suite and developer platform for developing, testing, and publication of Clinical Quality Language (CQL) and FHIR-based quality artifacts. It provides an advanced IDE with CodeMirror 6, AST and ELM translation, execution test harnesses, in-browser SQL on FHIR via WebAssembly (PGlite), and optional AI-assisted drafting backed by local LLMs (Ollama) and Model Context Protocol (MCP) tooling.

The codebase is organized as an npm monorepo with strict TypeScript typing:
- **`core/`** (`@cql-studio/core`) – Shared domain models, authentication/user types, team & workspace models, activity tracking, endpoint configurations, and MCP tool definitions.
- **`server/`** (`@cql-studio/server`) – Express and Node.js ESM backend, Prisma ORM, MCP tool orchestrator, Ollama & VSAC proxies, and OIDC BFF session authentication.
- **`ui/`** (`@cql-studio/ui`) – Angular 22 standalone frontend with CodeMirror 6, Bootstrap 5, and in-browser SQL on FHIR engine.
- **`docker/`** – Local Docker Compose stack providing PostgreSQL (CQL Studio DB & Authentik), Authentik (SSO/OIDC), and HAPI FHIR R4 JPA server.
- **`doc/`** – Architecture documentation, PlantUML diagrams, and SQL on FHIR guides.

The OpenCode architecture, filesystem boundaries, credential lifecycle, and gateway contract are documented in [`doc/opencode-frontend.md`](doc/opencode-frontend.md).

---

## Architecture

![deployment](doc/deployment.png)

### Components

| Component | Role |
| --- | --- |
| **CQL Studio UI** | Angular standalone frontend with CodeMirror 6 and Bootstrap styling. Provides CQL authoring, syntax highlighting, ELM inspection, measure evaluation, and in-browser SQL on FHIR execution. |
| **CQL Studio Server** | Express API with Node.js ESM and Prisma ORM. Handles user authentication via OIDC Backend-For-Frontend (BFF), team & workspace collaboration, MCP tool execution, and proxies for Ollama and VSAC. |
| **PostgreSQL** | Primary relational store for CQL Studio user accounts, teams, workspaces, access grants, activity logs, and shared environment metadata. |
| **Authentik** | OpenID Connect SSO identity provider for user authentication and team logins. |
| **HAPI FHIR JPA Server** | FHIR persistence and `$evaluate` execution server for clinical data, ValueSets, and CQL Library resources. |
| **Ollama Runner & Proxy** | Local or remote LLM execution engine with CORS-proxied endpoints for browser-safe AI code drafting and assistance. |
| **MCP Tool Orchestrator** | Tool execution engine providing web search (SearXNG), page fetching, metadata parsing, RSS feed extraction, and authoritative VSAC ValueSet discovery. |

---

## Architecture Diagrams

PlantUML sources live under [`doc/`](doc/) and can be rerendered into PNGs with `plantuml` in your PATH:

```bash
# Requires `plantuml` to be in your PATH
npm run diagram
```

---

## Prerequisites

- **Node.js+** (monorepo root for both UI and server workspace)
- **npm** (workspace support)
- **Docker & Docker Compose** (PostgreSQL, Authentik, HAPI FHIR R4)
- **PlantUML** (optional, for regenerating architectural diagrams under `doc/`)

---

## Quick Start & Local Development

### 1. Start Docker Development Services

Start the private OpenCode runner and local backing infrastructure services using the development compose file:

```bash
# OpenCode runner required by the AI tab:
docker compose -f docker/docker-compose.development.yml up -d --build opencode-runner

# Using root npm script:
npm run docker:up

# Or directly via docker compose:
docker compose -f docker/docker-compose.development.yml up -d --pull always --remove-orphans
```

### 2. Configure Environment

Copy the example environment configuration for the server:

```bash
cp server/.env.example server/.env
```

### 3. Install Dependencies & Build Core

Install all dependencies across monorepo workspaces and build the shared core package:

```bash
npm install
npm run build:core
```

### 4. Database Setup & Migrations

Run Prisma migrations on the development database:

```bash
npm run prisma:migrate
```

### 5. Start Server and UI from Source

Run both the server and UI concurrently in separate terminals:

```bash
# Terminal 1: Start the backend API & MCP Server (runs in watch mode via tsx)
npm run start:server

# Terminal 2: Start the Angular UI development server (runs on port 4200)
npm run start:ui
```

Once running, open your browser and navigate to `http://localhost:4200/`.

---

## Default Accounts & Service Endpoints

### Default Credentials (SSO Development)

| Username | Email | Password | Role / Description |
| --- | --- | --- | --- |
| `alice` | `alice@example.com` | `password` | Sample Developer User |
| `bob` | `bob@example.com` | `password` | Sample Developer User |
| `developer` | `developer@example.com` | `developer` | Standard Developer Account |
| `administrator` | `administrator@localhost` | `password` | Authentik IdP Console Bootstrap Account |

### Local Service Endpoints

| Service | Endpoint | Description |
| --- | --- | --- |
| **CQL Studio UI** | `http://localhost:4200` | Angular Authoring & IDE Web Console |
| **CQL Studio Server** | `http://localhost:3003` | REST API, BFF Auth, and MCP Server |
| **OpenCode Runner** | `http://127.0.0.1:4097` | Private local AI runtime; accessed through CQL Studio Server |
| **Authentik SSO** | `http://localhost:9000` | OIDC Identity Provider & Admin Console |
| **PostgreSQL** | `localhost:5432` | Primary PostgreSQL database (`cql_studio_development`) |
| **HAPI FHIR R4** | `http://localhost:8080/fhir` | FHIR R4 JPA Server |

---

## Environment Variables

Server configuration uses the `CQL_STUDIO_SERVER_*` prefix:

| Variable | Required | Default / Local Development Value | Description |
| --- | --- | --- | --- |
| `CQL_STUDIO_SERVER_PORT` | No | `3003` | Express HTTP server listen port |
| `CQL_STUDIO_SERVER_NODE_ENV` | No | `development` | Node environment (`development` / `production`) |
| `CQL_STUDIO_SERVER_CORS_ORIGIN` | Yes | `http://localhost:4200` | Allowed CORS origins for the webapp |
| `CQL_STUDIO_SERVER_LOG_LEVEL` | No | `info` | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`) |
| `CQL_STUDIO_SERVER_DATABASE_URL` | For SSO/Teams | `postgresql://cql_studio:password@localhost:5432/cql_studio_development` | PostgreSQL database connection URL |
| `CQL_STUDIO_SERVER_SSO_ISSUER_URL` | For SSO | `http://localhost:9000/application/o/cql-studio/` | OIDC SSO Issuer URL |
| `CQL_STUDIO_SERVER_SSO_CLIENT_ID` | For SSO | `cql-studio-development` | OIDC Client ID |
| `CQL_STUDIO_SERVER_SSO_CLIENT_SECRET` | For SSO | `cql-studio-development-secret` | OIDC Client Secret |
| `CQL_STUDIO_SERVER_SSO_REDIRECT_URL` | For SSO | `http://localhost:3003/api/auth/callback` | OIDC BFF Callback URL |
| `CQL_STUDIO_SERVER_SSO_SCOPES` | No | `openid profile email` | OIDC Scopes |
| `CQL_STUDIO_SERVER_UI_BASE_URL` | For SSO | `http://localhost:4200` | Base URL of the Angular UI |
| `CQL_STUDIO_SERVER_SESSION_SECRET` | For SSO | `cql-studio-development-session-secret` | Secret key for signing session cookies |
| `CQL_STUDIO_SERVER_OPENCODE_ENABLED` | No | `true` in development | Enables the OpenCode gateway |
| `CQL_STUDIO_SERVER_OPENCODE_ALLOW_UNAUTHENTICATED` | Production without SSO | `true` in development | Explicitly permits single-user, unauthenticated OpenCode sessions |
| `CQL_STUDIO_SERVER_OPENCODE_RUNNER_URL` | No | `http://localhost:4097` | Private runner base URL |
| `CQL_STUDIO_SERVER_OPENCODE_RUNNER_TOKEN` | Production | Development-only shared token | Gateway-to-runner credential; must be at least 32 bytes and non-default in production |
| `CQL_STUDIO_SERVER_OPENCODE_TOOL_BRIDGE_URL` | No | `http://host.docker.internal:3003/api/opencode/tool-bridge` | Gateway URL used by the runner's MCP subprocess |
| `CQL_STUDIO_SERVER_OPENCODE_SESSION_IDLE_MS` | No | `3600000` | Session idle expiration |
| `CQL_STUDIO_SERVER_OPENCODE_CLEANUP_INTERVAL_MS` | No | `60000` | Orphan session cleanup interval |
| `CQL_STUDIO_SERVER_OPENCODE_MAX_SESSIONS_PER_USER` | No | `0` | Per-user session limit; zero is unlimited |
| `CQL_STUDIO_SERVER_OPENCODE_MAX_SESSIONS_GLOBAL` | No | `0` | Global process session limit; zero is unlimited |

---

## SQL on FHIR

CQL Studio includes an experimental **CQL → SQL → MeasureReport** pipeline that runs entirely in the browser via PGlite (Postgres in WebAssembly). Open `/sql` in the webapp to explore the pipeline without requiring a backend.

See [doc/sql-on-fhir/](doc/sql-on-fhir/) for architecture details and vision.

---

## Attribution & License

Provided under the Apache 2.0 license. Copyright © 2025+ Preston Lee. All rights reserved.
