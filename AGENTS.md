# AGENTS.md

## Project Context
`cql-studio` is an integrated developer suite and web application for Clinical Quality Language (CQL), FHIR quality artifacts, and SQL on FHIR.

- **Monorepo Structure**:
  - `core/` – Shared domain models, authentication, team/workspace, and MCP tool definitions (`@cql-studio/core`)
  - `server/` – Express + Node ESM backend, Prisma ORM, MCP tool orchestrator, Ollama and VSAC proxies (`@cql-studio/server`)
  - `ui/` – Angular standalone UI with CodeMirror 6, Bootstrap 5, and PGlite (`@cql-studio/ui`)
  - `docker/` – Local stack with PostgreSQL, Authentik (SSO/OIDC), and HAPI FHIR
  - `doc/` – PlantUML diagrams and architectural documentation

- **Sibling Projects**:
  Related projects are checked out in the same parent directory (`../`):
  - `../cql-studio-website` — Project website and documentation for CQL Studio.
  - `../cql-tests-runner` — Runner and tooling for executing CQL tests.
  - `../cql-tests` — CQL test case definitions and fixtures.
  - `../cql-tests-results` — Stored or generated results from running CQL tests.
  - `../clinical_quality_language` — HL7 Clinical Quality Language specification, engine, and tooling. **DO NOT CHANGE THIS PROJECT!**
  - *Note: `cql-studio-server` has been consolidated into this monorepo under `server/`.*

---

## Tone, Voice & Communication Style
- **Direct & Technical**: Clear, high-signal, engineering-focused tone. No conversational filler, flattery, or generic commentary.
- **Action-Oriented Explanations**: When fixing bugs or presenting solutions, use structured summaries:
  1. **Root Cause** (brief, technical diagnosis)
  2. **Fix Applied** (specific files and logic updated)
  3. **Verification** (commands run and output confirmed)
- **Precise Code References**: Point to exact file paths and concise code snippets rather than broad generalities.
- **Documentation & Comments**:
  - Don't make obvious comments such as method comments that can be easily inferred from the function name.
  - Be concise and clear; avoid redundant content.
  - Avoid using emojis and unprofessional language.

---

## Coding Standards & Preferences

### General & TypeScript
- Strict typing across all packages. Avoid `any`. Prefer explicit interfaces and shared types from `@cql-studio/core`.
- When creating new `.ts` files, the first line should be `// Author: Preston Lee` followed by an empty line.
- Don't use deprecated APIs when possible.
- NEVER use `setTimeout` for addressing race conditions or state management.

### FHIR
- Use the `@types/fhir` library for FHIR types. Use FHIR R4 definitions in `"fhir/r4"` unless otherwise requested.

### Node & Express Backend
- Full ESM (`type: "module"`).
- All server environment variables must be prefixed with `CQL_STUDIO_SERVER_`.
- Clean separation between route handlers, business services, and database layers.

### Angular & UI
- Prefer modern Angular 22 idioms: standalone components, functional guards (`CanActivateFn`), functional interceptors (`HttpInterceptorFn`), and `inject()` over constructor parameter injection.
- **State & Reactivity**: Use Angular Signals (`signal()`, `computed()`, `effect()`, `toSignal()`) for state management and intra-application communication.
- **Template Conventions**: Invoke signals as functions (`mySignal()`), mutate via `.set()` or `.update()`, and use native `@if`, `@for`, `@switch` control flow blocks with strict template type-checking (never use deprecated `ngIf` or `ngFor`).
- **Layout & Styling**: Rely on Bootstrap 5 styling and Bootswatch themes with Bootstrap Icons. Avoid customizing components with custom CSS and new color schemes.
- **SCSS**:
  - Use SCSS `@use` and variable references instead of deprecated `@import` statements and CSS `var`.
  - Avoid duplicating hardcoded color values (use constants and reuse them).
  - Don't patch over specific visual problems when you can fix the underlying issue instead.
- **Testing & IDs**: Add `id` attributes to core UI and navigational controls to make tests less brittle.

### AI Architecture & MCP Tools
- Generally mimic the application architecture of the Cline extension for VS Code.
- Use popular patterns for AI integration into coding IDEs and make suggestions based on established UX paradigms.
- User chat messages should not include debug statements.
- Use popular open source libraries instead of writing custom code, if friendly to Angular web applications.
- Route model access through the OpenCode provider abstraction. Supported provider types are Ollama, OpenAI, and OpenAI-compatible APIs.
- Provider API keys must not be persisted in browser storage or exported with user settings. Keep them in memory until server-side secret storage is available.
- When working with LLM and MCP servers, always check work directly against the APIs before requesting manual testing.
- MCP tool names are referenced in code as well as prompts. Make sure changes are applied across the entire codebase.
- Never hardcode MCP tool names into AI prompt strings. Reference internal tools by static references to fields within `MCPToolNames` from `@cql-studio/core` (or static field references within individual tool type classes).

### Database & Prisma Migrations
- Backend schema lives in `server/prisma/schema.prisma`.
- **ALWAYS** use Prisma CLI to generate migrations (`npm run prisma:migrate`). Never hand-write migration files.
- Do not redirect shell/`npx` output into `migration.sql` (corrupts SQL with npm/Prisma logs).
- Ask before `migrate resolve`, reset, or other history repairs.

### Git & Runtime Rules
- Don't automatically make git commits or write git transactions without explicit permission.
- Assume `npm run start` / dev server is already running. Avoid starting redundant server processes; kill temporary server processes if started.

---

## Key Commands & Workflow
- **Build All**: `npm run build`
- **Build Core**: `npm run build:core`
- **Server Dev**: `npm run start:server` (or `npm run dev --workspace=@cql-studio/server`)
- **UI Dev**: `npm run start:ui`
- **Prisma Migrations**:
  - `npm run prisma:migrate` (or in server workspace: `cd server && npx prisma migrate dev --name <short_snake_case_name>`)
  - Apply existing: `npm run prisma:deploy` (or `cd server && npx prisma migrate deploy`)
  - Generate Client only: `npm run prisma:generate` (or `cd server && npx prisma generate`)
- **Docker Stack**: `npm run docker:up` / `npm run docker:down`
- **Diagrams**: `npm run diagram`
- **Verification**: Always run workspace typechecks or builds after editing code to ensure zero compilation regressions.
