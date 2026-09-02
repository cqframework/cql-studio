# OpenCode Frontend Integration

## Current boundary

The Angular UI contains the OpenCode IDE experience, while the monorepo `server/` package does not yet expose the OpenCode gateway or manage the runner container. Until the server phase is complete, the UI can target the existing standalone gateway through the Server Base URL override in Settings.

The frontend always uses same-origin CQL Studio Server routes under `/api/opencode`. Provider URLs and credentials are request data for CQL Studio Server; the browser never connects OpenCode directly to a provider.

## Storage and filesystem model

The product currently has three distinct forms of storage:

| Area | Lifetime | Contents |
| --- | --- | --- |
| CQL IDE | Browser tab, backed by FHIR when saved | Open `Library` resources and unsaved CQL editor state |
| CQL Studio Workspace | Persistent server database | Access grants, shared environments, activity, and FHIR resource references |
| OpenCode session workspace | One server-managed AI session | Writable active CQL file, read-only dependencies, converted attachments, and OpenCode session metadata |

An OpenCode session receives a snapshot. It does not receive browser storage or arbitrary host filesystem access. The active CQL file is writable; dependency snapshots and MCP integrations are read-only. Changes return as diffs and must pass the UI translation/save workflow before they are persisted to FHIR.

Attachments remain in the OpenCode session workspace until the session ends. Text files are stored as context directly. Formats such as PDF and DOCX are converted to Markdown by the runner-side MarkItDown integration. `/compact` may retain summarized context while allowing the runner to purge original attachment files.

## Workspace and environment context

Opening a Library from a CQL Studio Workspace preserves this frontend origin context on the IDE library tab:

- Workspace ID and name
- Workspace resource-reference ID
- Effective Workspace role

This is intentionally frontend-only until the server supports Workspace-owned OpenCode sessions. It prevents the origin information from being discarded during navigation and provides the future server handoff point.

Every OpenCode session is also bound to the active personal or shared Workspace environment at creation time. The binding contains environment identity and a fingerprint derived only from non-secret endpoint identity. If the active environment changes, the UI blocks prompts, uploads, tool answers, live edits, and saves for the old session. Ending and recreating the session is required.

## Credential handling

Provider API keys are held only in Angular memory:

- They are not written to `localStorage` or `sessionStorage`.
- They are not included in settings exports.
- Legacy persisted keys are absorbed into memory once and removed from stored settings.
- Reloading the page clears them.

The browser sends a key to CQL Studio Server only when listing provider models or creating a session. Persistent encrypted server-side provider credentials are deferred to the server phase.

Environment bindings stored in `sessionStorage` do not include endpoint usernames, passwords, authorization values, URL credentials, query strings, or fragments.

## Frontend gateway contract

`OpenCodeService` currently consumes these CQL Studio Server routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/opencode/health` | Gateway and runner availability |
| `POST` | `/api/opencode/providers/models` | Provider model discovery |
| `GET/POST` | `/api/opencode/sessions` | List or create owned sessions |
| `GET/DELETE` | `/api/opencode/sessions/:id/state` and `/api/opencode/sessions/:id` | Restore or end a session |
| `GET` | `/api/opencode/sessions/:id/events` | Ordered server-sent event stream |
| `POST` | `/api/opencode/sessions/:id/prompt` | Submit a prompt and editor context |
| `POST/DELETE` | `/api/opencode/sessions/:id/attachments` | Manage session documents |
| `PUT` | `/api/opencode/sessions/:id/active-file` | Synchronize the current editor revision |
| `GET` | `/api/opencode/sessions/:id/diff` | Read pending filesystem changes |
| `GET/POST` | `/api/opencode/sessions/:id/commands` | Discover and execute slash commands |
| `GET` | `/api/opencode/sessions/:id/files` | Complete `@` file references |
| `POST` | `/api/opencode/sessions/:id/validate` | Validate the session CQL snapshot |
| `POST` | `/api/opencode/sessions/:id/model` | Switch provider/model |
| `POST` | `/api/opencode/sessions/:id/abort` | Stop active generation |
| `POST/DELETE` | `/api/opencode/sessions/:id/permissions` and `/questions` | Resolve interactive OpenCode requests |

The exact request and response types live in `ui/src/app/models/opencode.model.ts` until they can move into `@cql-studio/core` with the server implementation.

## Server-phase checklist

1. Move the OpenCode contracts and tool-name references into `@cql-studio/core`.
2. Port the gateway, runtime, workspace, validation, MCP bridge, logging, and error modules into `server/`.
3. Register authenticated `/api/opencode` routes with per-user session ownership and limits.
4. Add the runner image and ephemeral workspace volume to `docker/docker-compose.development.yml` without sibling-repository paths.
5. Materialize authorized CQL Studio Workspace resource references into session snapshots without granting arbitrary filesystem access.
6. Persist the Workspace ID and resource-reference ID on server-owned sessions.
7. Add session expiry, orphan-directory cleanup, attachment limits, structured logs, and secure provider capabilities.
8. Run live Ollama, FHIR, VSAC, MCP, document-conversion, and browser integration tests through the monorepo server.
9. Resolve the current production audit advisories in the Prisma/config dependency chain with compatible server upgrades, then rerun the root production audit.
