# OpenCode Integration

## Current boundary

The Angular UI contains the OpenCode IDE experience. The monorepo `server/` package owns the authenticated gateway and delegates isolated execution to the private `opencode-runner` service defined in `docker/docker-compose.development.yml`.

The frontend always uses same-origin CQL Studio Server routes under `/api/opencode`. Provider URLs and credentials are request data for CQL Studio Server; the browser never connects OpenCode directly to a provider.

## Storage and filesystem model

The product currently has three distinct forms of storage:

| Area | Lifetime | Contents |
| --- | --- | --- |
| CQL IDE | Browser tab, backed by FHIR when saved | Open `Library` resources and unsaved CQL editor state |
| CQL Studio Workspace | Persistent server database | Access grants, shared environments, activity, and FHIR resource references |
| OpenCode session record | Persistent server database, owned by the SSO user | Conversation/state snapshot, session metadata, diffs, validation, and CQL Studio Workspace origin |
| OpenCode runner workspace | One live AI session | Writable active CQL file, read-only dependencies, and converted attachments |

An OpenCode session receives a snapshot. It does not receive browser storage or arbitrary host filesystem access. The active CQL file is writable; dependency snapshots and MCP integrations are read-only. Changes return as diffs and must pass the UI translation/save workflow before they are persisted to FHIR.

Attachments remain in the OpenCode session workspace until the session ends. Text files are stored as context directly. Formats such as PDF and DOCX are converted to Markdown by the runner-side MarkItDown integration. `/compact` may retain summarized context while allowing the runner to purge original attachment files.

The gateway snapshots live session state to PostgreSQL and lists only records owned by the authenticated user. The Workspace **Sessions** tab shows that user's OpenCode conversations associated with the selected Workspace in a read-only view. A live runner session can continue accepting prompts. After a server/runner restart or idle cleanup, its saved state remains available as a read-only archived session.

From the IDE, `/resume` lists archived sessions associated with the active CQL Library. Resuming retains the same logical session and visible conversation, but creates a fresh isolated runner filesystem from the Library's current CQL and dependencies. A bounded text-only version of the saved conversation is restored as model context. Current provider settings and in-memory credentials are used; stale files, attachments, tool outputs, capabilities, and credentials are not restored.

The IDE's **End** action archives rather than deletes: it takes a final state snapshot, removes the ephemeral runner workspace and attachment files, and retains the user-owned conversation in PostgreSQL. Permanent deletion is a separate server operation and is not exposed by the read-only Workspace Sessions view.

## Workspace and environment context

Opening a Library from a CQL Studio Workspace preserves this frontend origin context on the IDE library tab:

- Workspace ID and name
- Workspace resource-reference ID
- Effective Workspace role

The origin is sent when a session is created and retained on the server-owned session. SSO and the application database are required. The gateway resolves the authenticated user's effective Workspace role and verifies that the resource reference identifies the active Library before starting the runner session.

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
| `GET` | `/api/opencode/sessions?workspaceId=:id` | List the authenticated user's sessions for an accessible Workspace |
| `GET` | `/api/opencode/sessions/:id/state` | Read the current or persisted session state |
| `POST` | `/api/opencode/sessions/:id/resume` | Recreate an owned archived session using the active Library snapshot and current credentials |
| `POST` | `/api/opencode/sessions/:id/archive` | End the live runner workspace while retaining resumable conversation history |
| `DELETE` | `/api/opencode/sessions/:id` | Permanently delete an owned session (reserved for explicit history management) |
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

Wire-level request and response types live in `@cql-studio/core`. UI-only timeline, editor callback, and environment-binding state remains in `ui/src/app/models/opencode.model.ts`.

## Remaining production checklist

1. Add an explicit production allowlist for OpenAI-compatible and private-network provider origins.
2. Publish multi-architecture runner images alongside the server image.
3. Run authenticated live FHIR and VSAC probes in deployment CI.
4. Resolve the current production audit advisories in the Prisma/config dependency chain with compatible server upgrades, then rerun the root production audit.
