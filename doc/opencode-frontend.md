# OpenCode Integration

## Architecture

The Angular UI hosts the OpenCode IDE. The browser talks only to CQL Studio Server (`/api/opencode`); the server gateways to the isolated runner (`@cql-studio/opencode`, image `hlseven/quality-cql-studio-opencode`). Provider URLs and API keys are request data for the server — the browser never calls providers directly.

Local runner: `npm run start:opencode`. Docker stack: `npm run docker:full:up`.

## Storage

| Area | Lifetime | Contents |
| --- | --- | --- |
| CQL IDE | Tab / FHIR when saved | Open libraries and unsaved editor state |
| CQL Studio Workspace | Server DB | Access, environments, activity, FHIR refs |
| OpenCode session | Server DB (per user) | Conversation, `libraryIds`, diffs, validation, frozen `workspaceOrigin` |
| Runner workspace | Live session only | Writable `libraries/`, read-only `dependencies/` (includes + FHIRHelpers), attachments |

A session tracks all open CQL tabs as writable members and resolves their `include`s as read-only dependencies. Sessions may start with zero libraries; the agent or `/draft` can create drafts that sync into the runner. Edits return as diffs and must pass the IDE save workflow before FHIR persistence.

`PUT .../workspace` updates membership when editors open/close. Before applying an edit, the IDE activates the target tab. Writable revisions include bounded **Problems** panel diagnostics; the runner uses them for repair and runs `cql_validate`. Greetings skip Problems and CQL tools.

Attachments live until session end (text inline; PDF/DOCX → Markdown via MarkItDown). `/compact` may summarize and purge originals.

**End** archives (snapshot + remove runner files); history stays in PostgreSQL. Permanent delete: **Settings → AI** or `DELETE /api/opencode/sessions/:id`. **Resume** (`/resume`) restores conversation context and rebuilds the runner from current open editors.

## Workspace and environment

`workspaceOrigin` (Workspace ID, resource ref, role) is frozen at session **create** from the focused library — listing metadata only, not updated on focus change. Libraries may span workspaces or be personal drafts.

The active personal/shared environment is bound at creation (identity + non-secret endpoint fingerprint). If the environment changes, the UI blocks prompts, uploads, tools, edits, and saves until the session is ended and recreated.

## Credentials

Provider API keys stay in Angular memory only — never `localStorage`, settings exports, or direct provider calls. Keys are sent to the server only for model listing, session create, and resume. Environment bindings in `sessionStorage` exclude secrets (passwords, auth headers, URL credentials).

## API routes

`OpenCodeService` calls `/api/opencode/*`:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Gateway/runner status |
| `POST` | `/providers/models` | Model discovery |
| `GET/POST` | `/sessions` | List or create |
| `DELETE` | `/sessions` | Delete all owned sessions |
| `GET` | `/sessions?workspaceId=:id` | Sessions for a Workspace |
| `GET` | `/sessions/:id/state` | Session state |
| `POST` | `/sessions/:id/resume` | Resume archived session |
| `POST` | `/sessions/:id/archive` | End live session |
| `DELETE` | `/sessions/:id` | Delete session |
| `GET` | `/sessions/:id/events` | SSE stream |
| `POST` | `/sessions/:id/prompt` | Submit prompt |
| `POST/DELETE` | `/sessions/:id/attachments` | Attachments |
| `PUT` | `/sessions/:id/active-file` | Sync one editor |
| `PUT` | `/sessions/:id/workspace` | Sync membership + deps |
| `POST` | `/sessions/:id/ide-actions/:actionId` | ACK IDE draft creation |
| `GET` | `/sessions/:id/diff` | Pending changes |
| `GET/POST` | `/sessions/:id/commands` | Slash commands |
| `GET` | `/sessions/:id/files` | `@` file completion |
| `POST` | `/sessions/:id/validate` | CQL validation |
| `POST` | `/sessions/:id/model` | Switch model |
| `POST` | `/sessions/:id/abort` | Stop generation |
| `POST/DELETE` | `/sessions/:id/permissions`, `/questions` | Interactive prompts |

Wire types: `@cql-studio/core`. UI timeline/editor state: `ui/src/app/models/opencode.model.ts`.

## VSAC

`/validate-vsac` audits VSAC ValueSet declarations via read-only MCP tools — no FHIR writes. On Library save, CQL Studio imports missing ValueSets through the VSAC proxy before persisting. **Apply & save** shows **Apply, import terminology & save** when the diff contains VSAC refs. Chat mentions alone never import.

## Production checklist

1. Add production allowlist for OpenAI-compatible and private-network provider origins.
2. ~~Multi-arch runner images~~ — done (`hlseven/quality-cql-studio-opencode`).
3. Authenticated live FHIR and VSAC probes in deployment CI.
4. Resolve Prisma/config audit advisories, then rerun root production audit.
