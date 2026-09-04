# OpenCode Integration

## Current boundary

The Angular UI contains the OpenCode IDE experience. The monorepo `server/` package owns the authenticated gateway. Isolated execution lives in `@cql-studio/opencode` (`opencode/`), built as `opencode/Dockerfile`. Locally, run it with `npm run start:opencode`, or pull the pre-built image via `docker/docker-compose.full.yml` (`npm run docker:full:up`). Multi-arch images publish to `hlseven/quality-cql-studio-opencode`.

The frontend always uses same-origin CQL Studio Server routes under `/api/opencode`. Provider URLs and credentials are request data for CQL Studio Server; the browser never connects OpenCode directly to a provider.

## Storage and filesystem model

The product currently has four distinct forms of storage:

| Area | Lifetime | Contents |
| --- | --- | --- |
| CQL IDE | Browser tab, backed by FHIR when saved | Open `Library` resources and unsaved CQL editor state |
| CQL Studio Workspace | Persistent server database | Access grants, shared environments, activity, and FHIR resource references |
| OpenCode session record | Persistent server database, owned by the SSO user | Conversation/state snapshot, session metadata, writable `libraryIds`, diffs, validation, and optional frozen Workspace origin |
| OpenCode runner workspace | One live AI session | Writable open CQL editors under `libraries/`, read-only resolved includes + FHIRHelpers under `dependencies/`, and converted attachments |

An OpenCode session tracks **all open CQL editor tabs** as writable members and resolves their `include`s (even when those includes are not open) as read-only dependencies. Sessions may start with zero open libraries; the agent can call `cql_library_create_draft` so the IDE opens a local draft tab that is then synced into the runner workspace. Changes return as diffs and must pass the UI translation/save workflow before they are persisted to FHIR.

Opening or closing IDE editors during a live session updates membership via `PUT /api/opencode/sessions/:id/workspace`. Before applying an OpenCode edit, the IDE activates the corresponding editor tab.

The active IDE **Problems** panel is sent as bounded, structured prompt context for any synchronized writable library revision. OpenCode uses those exact diagnostics as its initial repair targets and then runs `cql_validate` against the workspace. Lightweight conversation such as a greeting does not receive Problems context or CQL tools. Stale diagnostics are rejected if the browser revision no longer matches the runner workspace.

Every session includes the bundled FHIR R4 `FHIRHelpers` 4.0.1 source at `dependencies/FHIRHelpers.cql`. The dependency is read-only.

Attachments remain in the OpenCode session workspace until the session ends. Text files are stored as context directly. Formats such as PDF and DOCX are converted to Markdown by the runner-side MarkItDown integration. `/compact` may retain summarized context while allowing the runner to purge original attachment files.

The gateway snapshots live session state to PostgreSQL and lists only records owned by the authenticated user. The Workspace **Sessions** tab shows that user's OpenCode conversations whose frozen `workspaceOrigin` matches the selected Workspace. A live runner session can continue accepting prompts. After a server/runner restart or idle cleanup, its saved state remains available as a read-only archived session.

From the IDE, `/resume` lists the user's archived sessions (not filtered by a single Library). Resuming best-effort reopens previously tracked libraries without closing existing tabs, then rebuilds the runner workspace from the **current** open editor set and resolved includes. A bounded text-only version of the saved conversation is restored as model context.

The IDE's **End** action archives rather than deletes: it takes a final state snapshot, removes the ephemeral runner workspace and attachment files, and retains the user-owned conversation in PostgreSQL. Permanent deletion is available from **Settings → AI** (`DELETE /api/opencode/sessions`) and as a per-session server operation; it is not exposed by the read-only Workspace Sessions view.

## Workspace and environment context

Opening a Library from a CQL Studio Workspace preserves this frontend origin context on the IDE library tab:

- Workspace ID and name
- Workspace resource-reference ID
- Effective Workspace role

A single `workspaceOrigin` is frozen on the OpenCode session at **create** time from the focused open library (else the first open library that has an origin). It is listing/access metadata only and is not updated when focus changes. Membership libraries may come from other workspaces or be personal drafts.

Every OpenCode session is also bound to the active personal or shared Workspace environment at creation time. The binding contains environment identity and a fingerprint derived only from non-secret endpoint identity. If the active environment changes, the UI blocks prompts, uploads, tool answers, live edits, and saves for the old session. Ending and recreating the session is required.

## Credential handling

Provider API keys are held only in Angular memory:

- They are not written to `localStorage` or `sessionStorage`.
- They are not included in settings exports.
- Legacy persisted keys are absorbed into memory once and removed from stored settings.
- Reloading the page clears them.

The browser sends a key to CQL Studio Server only when listing provider models, creating a session, or resuming an archived session. The gateway retains session tool context in memory and sends the runner only an opaque, random MCP capability.

Environment bindings stored in `sessionStorage` do not include endpoint usernames, passwords, authorization values, URL credentials, query strings, or fragments.

## Frontend gateway contract

`OpenCodeService` currently consumes these CQL Studio Server routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/opencode/health` | Gateway and runner availability |
| `POST` | `/api/opencode/providers/models` | Provider model discovery |
| `GET/POST` | `/api/opencode/sessions` | List or create owned sessions |
| `DELETE` | `/api/opencode/sessions` | Permanently delete all sessions owned by the authenticated user |
| `GET` | `/api/opencode/sessions?workspaceId=:id` | List the authenticated user's sessions for an accessible Workspace |
| `GET` | `/api/opencode/sessions/:id/state` | Read the current or persisted session state |
| `POST` | `/api/opencode/sessions/:id/resume` | Recreate an owned archived session using the current open-library snapshot and credentials |
| `POST` | `/api/opencode/sessions/:id/archive` | End the live runner workspace while retaining resumable conversation history |
| `DELETE` | `/api/opencode/sessions/:id` | Permanently delete an owned session |
| `GET` | `/api/opencode/sessions/:id/events` | Ordered server-sent event stream (includes `cql.ide.create_draft`) |
| `POST` | `/api/opencode/sessions/:id/prompt` | Submit a prompt and editor context |
| `POST/DELETE` | `/api/opencode/sessions/:id/attachments` | Manage session documents |
| `PUT` | `/api/opencode/sessions/:id/active-file` | Synchronize one editor revision |
| `PUT` | `/api/opencode/sessions/:id/workspace` | Synchronize writable membership + dependencies |
| `POST` | `/api/opencode/sessions/:id/ide-actions/:actionId` | ACK IDE-side draft creation for MCP tools |
| `GET` | `/api/opencode/sessions/:id/diff` | Read pending filesystem changes |
| `GET/POST` | `/api/opencode/sessions/:id/commands` | Discover and execute slash commands |
| `GET` | `/api/opencode/sessions/:id/files` | Complete `@` file references |
| `POST` | `/api/opencode/sessions/:id/validate` | Validate the session CQL snapshot |
| `POST` | `/api/opencode/sessions/:id/model` | Switch provider/model |
| `POST` | `/api/opencode/sessions/:id/abort` | Stop active generation |
| `POST/DELETE` | `/api/opencode/sessions/:id/permissions` and `/questions` | Resolve interactive OpenCode requests |

Wire-level request and response types live in `@cql-studio/core`. UI-only timeline, editor callback, and environment-binding state remains in `ui/src/app/models/opencode.model.ts`.

## VSAC validation and terminology import

The project-local `validate-vsac` OpenCode skill and `/validate-vsac` command audit an exact canonical URL/OID, or all VSAC ValueSet declarations in the active CQL file. The skill uses only read-only MCP tools: authoritative VSAC validation/discovery plus bounded reads and expansion checks against the configured terminology endpoint. It never writes a FHIR resource.

FHIR writes remain a deliberate CQL Studio action. When the user saves CQL containing VSAC ValueSet declarations, CQL Studio searches the active terminology endpoint by exact canonical URL and verifies that each existing resource can expand. Missing or unusable resources are fetched and expanded through the existing authenticated VSAC proxy, then imported to the configured writable terminology endpoint before the Library is saved. **Apply & save** identifies this explicitly as **Apply, import terminology & save** when the AI diff contains VSAC references. Failed validation, expansion, or import blocks the Library save; merely mentioning a VSAC URL in chat never imports it.

## Remaining production checklist

1. Add an explicit production allowlist for OpenAI-compatible and private-network provider origins.
2. ~~Publish multi-architecture runner images alongside the server image.~~ Done via Drone (`opencode-amd64` / `opencode-arm64` / `opencode-manifest`) to `hlseven/quality-cql-studio-opencode`.
3. Run authenticated live FHIR and VSAC probes in deployment CI.
4. Resolve the current production audit advisories in the Prisma/config dependency chain with compatible server upgrades, then rerun the root production audit.
