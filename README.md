# CQL Studio
![Docker Image Version](https://shields.foundry.hl7.org/docker/v/hlseven/quality-cql-studio)
![Docker Pulls](https://shields.foundry.hl7.org/docker/pulls/hlseven/quality-cql-studio)

A integrated web application suite for developing, testing, and publication of CQL (Clinical Quality Language) and FHIR-based artifacts using classical IDE concepts and optional AI-assisted drafting, as well as full support of official CQL _engine_ compatibility test cases, runner services, and results analysis.

See [CQL Studio Website](https://cqlstudio.com) for screenshots and product information.


## Quick Start with Docker

**This is just the UI component of CQL Studio. If you want to use the full distribution, you will likely want a fully configured, downloadable bundle such as distributed through [HL7 Foundry](https://foundry.hl7.org/products/fb509f14-5bc1-491b-a145-fab078a901c0)**.

The easiest way to run this application is using Docker:

### Build and Run with Docker

```bash
# Build the Docker image
docker build -t hlseven/quality-cql-studio:latest .

# Alternatively, build images for multiple architectures if supported by your build environment
docker buildx build --platform linux/arm64,linux/amd64 -t hlseven/quality-cql-studio:latest .

# Run the container
docker run -p 4200:80 hlseven/quality-cql-studio
```

Once the container is running, open your browser and navigate to `http://localhost:4200/`.


## Running from Source Code

### Prerequisites

- Current stable version of Node.js
- npm (comes with Node.js)

### Development Server

To start a local development server, run:

```bash
# Install dependencies
npm install

# Start the development server
npm run start
```

For a local HAPI FHIR R4 server and Authentik IdP used with SSO development:
```bash
docker compose -f docker-compose.development.yml up -d
```

## OpenCode assistant

The IDE's OpenCode tab uses the official TypeScript SDK through a dedicated runner container. Start the runner together with the normal CQL Studio Server process:

```bash
docker compose -f docker-compose.development.yml up -d --build opencode-runner

# In ../cql-studio-server
npm run build
npm start
```

In Settings, enable the AI assistant and configure:

- CQL Studio Server Base URL (development default `http://localhost:3003`)
- Provider (Ollama, OpenAI, or OpenAI-compatible)
- Provider URL and API key where applicable, then **Load models** and choose a model

The OpenCode composer can attach text/source files, CSV/TSV, Markdown, PDF, and DOCX context. Attachments are retained for the lifetime of the session and appear as read-only files to OpenCode. PDF and DOCX files are converted to bounded Markdown in the runner with MarkItDown; originals are not exposed. Removing a session or successfully running `/compact` purges the attachment files. A session accepts at most 20 files and each upload is limited to 10 MB (converted text is limited to 4 MB).

Starting OpenCode snapshots the active library's current editor text, including unsaved changes. Before every prompt or model-backed slash command, the browser re-synchronizes the active draft and its user-edit revision into the isolated workspace. Open CQL libraries referenced through `include` are copied into the session as read-only dependencies. OpenCode cannot directly save a FHIR Library: it proposes a filesystem diff, the user reviews it in the tab, and **Apply & save** returns the accepted text to the editor's existing translate-and-save workflow.

Inside the tab, type `/` to discover browser, OpenCode, and CQL workflow commands, including `/validate`, `/review`, `/explain`, `/dependencies`, `/library`, and `/valueset`. Type `@` to attach the active CQL file or a read-only dependency as an SDK file part. Tool calls, reasoning (opt-in), retries, validation, repair attempts, permission prompts, and OpenCode questions are visible in the activity stream. Sessions reconnect with event replay and can be reattached after a browser reload.

Highlighted CQL is attached as structured context to the next prompt. `Cmd+I` on macOS or `Ctrl+I` elsewhere opens a focused inline-edit prompt for the selection (or current line). The **Live edits** switch can mirror OpenCode's workspace writes into CodeMirror as unsaved, highlighted changes; revision conflicts pause mirroring and leave the diff for review. Live edits never invoke FHIR persistence. Optional inline code prediction is enabled separately in Settings, uses the configured Ollama model through the existing server proxy, and supports **Tab** to accept or **Escape** to dismiss.

Run the deterministic end-to-end workflow with:

```bash
npm run test:e2e -- tests/opencode-integration.spec.ts
```

FHIR/VSAC connection settings are sent only to CQL Studio Server for the lifetime of the session. They are not placed in the runner workspace. See the server README for the filesystem layout, private runner configuration, API endpoints, and MCP tool boundary.

## Docker Details

This application uses a multi-stage Docker build:

1. **Builder Stage**: Uses Node to install dependencies and build the Angular application
2. **Runtime Stage**: Uses Nginx to serve the built application

The Docker setup includes:
- `Dockerfile`: Multi-stage build configuration
- `nginx.conf`: Nginx configuration for serving the Angular app
- `entrypoint.sh`: Runtime configuration script

### Docker Environment Variables

The application supports runtime configuration through environment variables. The `entrypoint.sh` script processes `configuration.template.js` to generate the final configuration at runtime.

#### Available Environment Variables

- **CQL_STUDIO_RUNNER_BASE_URL**: Specifies the base URL for the CQL Tests Runner service. This URL is used to communicate with the runner backend for executing CQL tests and retrieving results. Defaults to `http://localhost:3000`.

- **CQL_STUDIO_FHIR_BASE_URL**: Specifies the base URL for the FHIR server. This URL is used for FHIR resource operations and data retrieval. Defaults to `http://localhost:8080/fhir`.

Team collaboration (SSO, Teams, Workspaces) is configured on **cql-studio-server**. The UI calls that server via `CQL_STUDIO_SERVER_BASE_URL` (same as other Studio APIs). See the server README for `CQL_STUDIO_SERVER_SSO_*` / `CQL_STUDIO_SERVER_DATABASE_URL`.

### Including other CQL libraries

To `include` another library from the CQL IDE, the dependency must be **saved** as a FHIR `Library` on the configured FHIR server. The included library's CQL `library` name and `version` must match the FHIR resource `name` and `version` fields.

IDE translation discovers CQl includes from ELM (stored on FHIR and from compiler output), not by parsing CQL text. Execution uses the same saved libraries on the FHIR server.


## SQL on FHIR

CQL Studio includes an experimental **CQL → SQL → MeasureReport** pipeline that runs entirely in the browser via PGlite (Postgres in WebAssembly). Open `/sql` and click **Load CMS125 demo** to see it in action — no FHIR server or backend required.

See [doc/sql-on-fhir/](doc/sql-on-fhir/) for the vision behind the feature (originally presented at the December 2025 SQL-on-FHIR Analytics Conference), the architecture, the roadmap, and the demo walkthrough.


## Attribution & License

Copyright © 2025+ Preston Lee. All rights reserved. Provided under the Apache 2.0 license.
