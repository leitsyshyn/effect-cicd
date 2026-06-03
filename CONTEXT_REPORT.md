# Context Report: Repository Structure, Build, Packaging, and Runtime Entrypoints

## 1. Scope

- **Owned area:** Top-level repository layout, workspace configuration, build tooling, packaging (Docker), CLI/service/dashboard entrypoints, environment config, test and dev scripts, module boundaries.
- **Explicit exclusions:** DSL, Engine, CLI, Dashboard, GitHub, persistence, and executor internals except as package/responsibility boundaries.
- **Related areas / handoff edges:** `src/cli/`, `src/service/`, `src/dashboard/`, `src/runtime/`, `packages/dsl/`. Each owns its own build-time or runtime entrypoint script at root.

## 2. Implementation status

| Capability / responsibility   | Status               | Evidence                                                                                          | Notes                                                                                                                                                                                                                |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager & workspace   | IMPLEMENTED          | `package.json:2-61`, root dir. Bun only, no `pnpm-workspace.yaml`.                                | Single-project Bun workspace; no monorepo tool.                                                                                                                                                                      |
| TypeScript toolchain          | IMPLEMENTED          | `tsconfig.json:1-35`                                                                              | strict, NodeNext, Effect language-service, bun types, path aliases `@/*` and `@effect-cicd/dsl`.                                                                                                                     |
| Build tools                   | IMPLEMENTED          | `bunfig.toml:1-2`, `CLAUDE.md:40-41`                                                              | No separate bundler. Bun serves as runtime & bundler (`Bun.serve() static routes`, `bun-plugin-tailwind`).                                                                                                           |
| Test framework                | IMPLEMENTED          | `vitest.config.ts:1-7`, `package.json:12-13`                                                      | vitest 4 via Bun runner. 23 test files in `tests/`.                                                                                                                                                                  |
| CLI entrypoint                | IMPLEMENTED          | `index.ts:1-8` → `src/cli/index.ts:455` (`cliProgram`), `src/cli/local.ts:22` (`localCliProgram`) | CLI is an Effect `Command.run` program.                                                                                                                                                                              |
| Service entrypoint            | IMPLEMENTED          | `server.ts:1-8` → `src/service/server.ts:105` (`startServiceServer`), `:352` (`serviceProgram`)   | Engine service with HTTP API.                                                                                                                                                                                        |
| Dashboard entrypoint          | IMPLEMENTED          | `dashboard.ts:1-8` → `src/dashboard/server.ts:10` (`dashboardProgram`)                            | Separate Bun process; proxy to engine.                                                                                                                                                                               |
| Local CLI (embedded service)  | IMPLEMENTED          | `index.local.ts:1-6` → `src/cli/local.ts:22-37` (`runWithLocalService`)                           | Boots engine service in-process, runs CLI, shuts down.                                                                                                                                                               |
| Docker self-hosted packaging  | IMPLEMENTED          | `Dockerfile:1-18`                                                                                 | Multi-stage, `oven/bun:latest`, `ENTRYPOINT ["bun", "run", "server.ts"]`.                                                                                                                                            |
| Docker Compose (full)         | IMPLEMENTED          | `compose.yml:1-84`                                                                                | Postgres 16 + MinIO + app service with healthchecks.                                                                                                                                                                 |
| Docker Compose (infra only)   | IMPLEMENTED          | `compose.demo.yml:1-64`                                                                           | Postgres 16 + MinIO + minio-init bucket creation.                                                                                                                                                                    |
| Environment config            | IMPLEMENTED          | `.env` (gitignored), `.env.demo:1-37`, `src/runtime/config.ts:1-303`                              | 6 config service classes reading env vars via Effect Config.                                                                                                                                                         |
| Root scripts (`package.json`) | IMPLEMENTED          | `package.json:7-23`                                                                               | 10 scripts covering cli, local, server, dashboard, infra, smee, typecheck, test.                                                                                                                                     |
| Bundled DSL package           | IMPLEMENTED          | `packages/dsl/package.json:1-12`                                                                  | `@effect-cicd/dsl`, exports `./src/index.ts`.                                                                                                                                                                        |
| Dashboard UI bundling         | IMPLEMENTED          | `dashboard.html:1-13`, `bunfig.toml`, `components.json:1-21`                                      | shadcn/ui components, Tailwind v4, Bun HTML imports.                                                                                                                                                                 |
| engine/stores/ sub-packages   | IMPLEMENTED          | `src/engine/stores/`                                                                              | state-store, event-log, artifact-store, artifact-gc.                                                                                                                                                                 |
| docs for architecture         | DOCUMENTED_NOT_FOUND | `docs/rfcs/0001-system-architecture.md:1-154`, `docs/adrs/0004-deployment-topology.md:1-152`      | Docs describe 3-layer DSL/Engine/Interface, single-node topology, embedded executor. Code matches.                                                                                                                   |
| Self-hosting docs             | DOCUMENTED_NOT_FOUND | `docs/self-hosting.md:1-108`                                                                      | Config table, migration, backup, monitoring. Code matches most; `/readyz` endpoint exists in `src/service/server.ts:192-193` but `/metrics` is implemented only as Option. `/readyz` and `/metrics` endpoints exist. |
| coursework-summary-uk.md      | DOCUMENTED_NOT_FOUND | `docs/coursework-summary-uk.md:1-135`                                                             | Ukrainian report. Code matches described architecture.                                                                                                                                                               |

## 3. Main source locations

| Path                           | Role in this area                           | Important symbols / entrypoints                                                                                                             |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                 | Root project manifest                       | scripts, dependencies (effect v4, react 19, shadcn, tailwind, vitest)                                                                       |
| `tsconfig.json`                | TypeScript config                           | path aliases `@/*` and `@effect-cicd/dsl`, Effect language-service plugin                                                                   |
| `bunfig.toml`                  | Bun config                                  | Tailwind CSS plugin for `Bun.serve()` static routes                                                                                         |
| `vitest.config.ts`             | Test config                                 | includes `tests/**/*.test.{ts,tsx}`                                                                                                         |
| `index.ts`                     | **CLI entrypoint**                          | imports `appProgram` from `src/cli/index.ts`                                                                                                |
| `index.local.ts`               | **Local CLI entrypoint** (embedded service) | imports `localCliProgram` from `src/cli/local.ts`                                                                                           |
| `server.ts`                    | **Service entrypoint**                      | imports `serviceProgram` from `src/service/server.ts`                                                                                       |
| `dashboard.ts`                 | **Dashboard entrypoint**                    | imports `dashboardProgram` from `src/dashboard/server.ts`                                                                                   |
| `Dockerfile`                   | Container build                             | multi-stage, installs deps, `bun run server.ts`                                                                                             |
| `compose.yml`                  | Full self-hosted stack                      | app + postgres + minio + minio-init                                                                                                         |
| `compose.demo.yml`             | Local dev infra                             | postgres + minio + minio-init                                                                                                               |
| `.env.demo`                    | Environment template                        | all config keys documented                                                                                                                  |
| `src/cli/index.ts`             | CLI command tree                            | `cli`, `appProgram`, `makeAppLayer`, `makeAppLayerForBaseUrl`, 20+ subcommands                                                              |
| `src/cli/local.ts`             | Local embedded runner                       | `runWithLocalService`, `localCliProgram`, `LocalServiceHandle`                                                                              |
| `src/service/server.ts`        | HTTP engine service                         | `makeServiceLayer`, `startServiceServer`, `serviceProgram`, 30+ route handlers, `Bun.serve()`                                               |
| `src/dashboard/server.ts`      | Dashboard HTTP proxy                        | `makeDashboardLayer`, `dashboardProgram`, proxy routes to engine                                                                            |
| `src/dashboard/dashboard.html` | Dashboard HTML entry                        | shadcn React SPA via `<script type="module" src="./main.tsx">`                                                                              |
| `src/runtime/config.ts`        | Config service classes                      | `PostgresConfig`, `ObjectStorageConfig`, `EngineServiceConfig`, `SchedulerConfig`, etc.                                                     |
| `src/runtime/layers.ts`        | Engine layer composition                    | `makeDurableStorageLayer`, `makeServiceEngineLayer`, `makeInMemoryEngineLayer`, `makeInMemoryServiceEngineLayer`                            |
| `src/runtime/storage.ts`       | Postgres + S3 storage                       | `sqlClientLayer`, `storageMigrationLayer` (10 migrations), `ObjectStorageClient`                                                            |
| `packages/dsl/package.json`    | DSL package                                 | `exports: "."` → `./src/index.ts`, `"@effect-cicd/dsl"` alias in tsconfig                                                                   |
| `packages/dsl/src/public.ts`   | DSL public API                              | `Workflow`, `Job`, `Trigger`, `Condition`, `Command`, `Input`, `Output`, `Artifact`, `Report`, `Retry`, `Timeout`, `Cancellation`, `Secret` |

## 4. Actual responsibilities found in code

- **Single-package repo (not monorepo)** — no `pnpm-workspace.yaml`; `packages/dsl/` is bundled via tsconfig path alias, not workspace protocol.
- **Two independent workspace packages**: root project (`effect-cicd`) and `@effect-cicd/dsl` under `packages/dsl/`.
- **Four runtime entrypoints**: CLI (`index.ts`), local CLI (`index.local.ts`), service (`server.ts`), dashboard (`dashboard.ts`).
- **All entrypoints use `@effect/platform-bun`** (`BunRuntime.runMain`, `BunServices.layer`) — the runtime is Bun, not Node.js.
- **Three deployment modes**: CLI‑only (remote engine), local (embedded engine → CLI), self‑hosted (persistent engine service + optional dashboard).
- **Engine service** (`server.ts`) serves HTTP API on port 3000 via `Bun.serve()` with HMR-incompatible patterns.
- **Dashboard** (`dashboard.ts`) serves React SPA on port 3001, proxies API calls to engine service.
- **All persistent storage** is external: Postgres (state, events, secrets), MinIO/S3 (artifacts, logs).
- **No in‑memory fallback for production.** In‑memory layers exist only in tests (`src/runtime/layers.ts:80-137`).
- **Auto‑migrations** run on service startup via `PgMigrator` (`src/runtime/storage.ts:194-456`).

## 5. Core data structures, types, services, and APIs

| Name                      | Kind                | Location                         | Purpose                                                  | Upstream / downstream connections            |
| ------------------------- | ------------------- | -------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `package.json` scripts    | config              | `package.json:7-23`              | Map `bun run <script>` to entrypoints                    | All entrypoints reference `src/` files       |
| `EngineServiceConfig`     | service class       | `src/runtime/config.ts:196-219`  | Holds `baseUrl` and `port` from env                      | Used by CLI client, service, dashboard       |
| `PostgresConfig`          | service class       | `src/runtime/config.ts:5-64`     | Postgres connection from `POSTGRES_URL` etc.             | `sqlClientLayer` → `PgClient`                |
| `ObjectStorageConfig`     | service class       | `src/runtime/config.ts:66-109`   | S3/MinIO config                                          | `ObjectStorageClient.layer` → `Bun.S3Client` |
| `StorageRuntimeConfig`    | service class       | `src/runtime/config.ts:146-169`  | `RUN_RECOVERY_ON_STARTUP`, `RUN_STORAGE_TESTS`           | used by `startServiceServer`                 |
| `GitHubAppConfig`         | service class       | `src/runtime/config.ts:243-279`  | GitHub App auth/webhook config                           | GitHub integration                           |
| `SchedulerConfig`         | service class       | `src/runtime/config.ts:171-194`  | `MAX_CONCURRENT_RUNS`, `MAX_CONCURRENT_RUNS_PER_PROJECT` | orchestrator                                 |
| `makeDurableStorageLayer` | layer factory       | `src/runtime/layers.ts:21-44`    | Assembles Postgres + S3 layers                           | `makeServiceEngineLayer`                     |
| `makeServiceEngineLayer`  | layer factory       | `src/runtime/layers.ts:46-78`    | Engine with durable storage + container executor         | `src/service/server.ts:50`                   |
| `makeInMemoryEngineLayer` | layer factory       | `src/runtime/layers.ts:80-137`   | Engine with in‑memory stores + test executor             | tests, not for production                    |
| `Dockerfile`              | build artifact      | `Dockerfile:1-18`                | Self‑hosted container image                              | exposes 3000, `ENTRYPOINT server.ts`         |
| `compose.yml`             | deployment manifest | `compose.yml:1-84`               | Full self‑hosted stack                                   | builds `Dockerfile`, 4 services              |
| `storageMigrationLayer`   | migration runner    | `src/runtime/storage.ts:194-456` | Auto‑run SQL migrations on startup                       | 10 numbered migrations                       |

## 6. Main runtime flows

### Flow A: CLI startup (remote mode)

1. `index.ts` calls `BunRuntime.runMain(appProgram.pipe(Effect.provide(appLayer)))`
2. `makeAppLayer()` in `src/cli/index.ts:38-54` assembles clients: `engineServiceClientLayer` (HTTP to engine), `gitHubIntegrationClientLayer`, `SecretsClient.layer`, plus DSL loader/materializer
3. `appProgram` wraps `Command.run(cli, ...)` with `EngineUnavailable` catch — run `cli` parses args and dispatches to validate/plan/run/runs bindings/secrets subcommands

Evidence:

- `index.ts:1-8` — CLI entrypoint
- `src/cli/index.ts:38-54` — `makeAppLayer` builds remote client layer
- `src/cli/index.ts:450-463` — `cli` command + `appProgram`

### Flow B: Local embedded mode

1. `index.local.ts:1-6` calls `localCliProgram.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)`
2. `localCliProgram` (`src/cli/local.ts:22-37`) calls `runWithLocalService(startServiceServer, ...)`
3. `startServiceServer` boots the engine + HTTP server on a random port
4. CLI runs against that embedded service URL, then shuts it down

Evidence:

- `src/cli/local.ts:22-37` — `runWithLocalService` pattern with `Effect.acquireUseRelease`
- `src/service/server.ts:105-350` — `startServiceServer` booting `Bun.serve()`

### Flow C: Self‑hosted service startup

1. `server.ts:1-8` calls `serviceProgram.pipe(Effect.provide(serviceLayer), BunRuntime.runMain)`
2. `makeServiceLayer()` (`src/service/server.ts:50-103`) composes engine + GitHub layers
3. `startServiceServer` (`:105-350`) runs startup recovery, starts GitHub Check Run watcher, artifact GC, then `Bun.serve()` with all HTTP routes → `Effect.never`

Evidence:

- `src/service/server.ts:50-103` — `makeServiceLayer` composition
- `src/service/server.ts:105-350` — full server bootstrap including `Bun.serve()` routes
- `src/runtime/layers.ts:46-78` — `makeServiceEngineLayer` composition

### Flow D: Dashboard startup

1. `dashboard.ts:1-8` calls `dashboardProgram.pipe(Effect.provide(dashboardLayer), BunRuntime.runMain)`
2. `dashboardProgram` (`src/dashboard/server.ts:10-120`) reads `EngineServiceConfig`, creates proxy handlers, starts `Bun.serve()` on port 3001 with React SPA routes

Evidence:

- `src/dashboard/server.ts:10-120` — full `dashboardProgram`
- Serves `dashboard.html` at `/` which imports `main.tsx` via module script

### Flow E: Docker Compose deployment

1. `docker compose up --build` builds `Dockerfile` and starts `compose.yml` services
2. `Dockerfile` multi-stage builds, copies source, sets `ENTRYPOINT ["bun", "run", "server.ts"]`
3. `compose.yml` exposes port 3000, healthchecks on `/healthz`, depends on Postgres + MinIO + minio-init

Evidence:

- `Dockerfile:1-18` — full build
- `compose.yml:1-84` — service definitions

## 7. User-visible behavior / report-relevant behavior

- **CLI invocation:** `bun run index.ts <command> [args]` or `bun run cli ...`
- **Local mode:** `bun run local run <workflow> --workspace <path>` boots embedded service transparently
- **Self‑hosted start:** `bun run server` starts persistent HTTP service on `:3000`
- **Dashboard:** `bun run dashboard` (or `bun run dashboard:dev` for HMR) starts on `:3001`
- **Infra:** `bun run infra:up` / `infra:down` / `infra:logs` for Postgres + MinIO
- **Health/readiness endpoints:** `GET /healthz`, `GET /readyz`, `GET /metrics`, `GET /version`
- **API routes defined in code:** 30+ REST routes under `/api/` in `src/service/server.ts:188-324`
- **Environment variables documented:** 30+ config keys in `.env.demo`, `docs/self-hosting.md`, and `src/runtime/config.ts`
- **Inputs accepted:** CLI args and flags, HTTP request bodies (JSON), environment variables
- **Outputs produced:** Structured CLI output, JSON API responses, SSE streams (`/api/runs/stream`, `/api/runs/:runId/stream`), Prometheus metrics text
- **Errors/diagnostics:** Domain error → JSON with `_tag` and `message`, HTTP status codes (400, 401, 404, 502, 503)

## 8. Dependencies and integrations

| Dependency / integration    | Used for                | Location                                            | Notes                                                       |
| --------------------------- | ----------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Bun (runtime)               | All execution           | `index.ts`, `server.ts`, `dashboard.ts`, Dockerfile | Runtime runtime, bundler, test runner                       |
| `effect` v4                 | Core framework          | `package.json:50`                                   | All Effect services, Schema, Stream, Config, Layer, Context |
| `@effect/platform-bun`      | Bun runtime adapter     | `package.json:34`                                   | `BunRuntime.runMain`, `BunServices.layer`                   |
| `@effect/sql-pg`            | Postgres                | `package.json:35`                                   | `PgClient`, `PgMigrator` — state store, event log, secrets  |
| `@effect/language-service`  | IDE / compiler          | `package.json:25`                                   | TypeScript plugin (`tsconfig.json:29-31`)                   |
| `@effect/vitest`            | Test integration        | `package.json:27`                                   | Effect-aware vitest                                         |
| `vitest`                    | Test runner             | `package.json:31`                                   | via Bun runner                                              |
| `react` 19 / `react-dom` 19 | Dashboard UI            | `package.json:52-53`                                | SPA                                                         |
| `react-router-dom` 7        | Dashboard routing       | `package.json:55`                                   |                                                             |
| `@tanstack/react-query` 5   | Dashboard data fetching | `package.json:46`                                   |                                                             |
| `tailwindcss` 4             | Dashboard CSS           | `package.json:58`                                   | via `bun-plugin-tailwind`                                   |
| `shadcn` 4                  | UI components           | `package.json:56`                                   | shadcn/ui registry                                          |
| `lucide-react`              | Dashboard icons         | `package.json:51`                                   |                                                             |
| Postgres 16                 | Persistent storage      | `compose.yml:26-41`                                 | External dependency                                         |
| MinIO / S3                  | Artifact storage        | `compose.yml:43-59`                                 | S3-compatible                                               |
| Docker                      | Container execution     | `src/engine/executor.ts` (implied)                  | `LocalContainerExecutor`                                    |
| `typescript` 5              | Type checking           | `package.json:30`                                   | `tsc --noEmit`                                              |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                          | Actual code evidence                                                                                                    | Classification                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| "Local CLI should embed the Engine in-process" (ADR 0004 Q1)         | `index.local.ts:1-6` → `src/cli/local.ts:22-37` — embedded engine server with HTTP loop                                 | IMPLEMENTED                                      |
| "Single-node deployment topology for prototype" (ADR 0004)           | `compose.yml` + `Dockerfile` = single node service                                                                      | IMPLEMENTED                                      |
| "Engine may be packaged in same process as dashboard/CLI" (ADR 0004) | Not implemented for dashboard; dashboard is a separate Bun process                                                      | PARTIAL — CLI can embed engine, dashboard cannot |
| "workspace is `@effect-cicd`" (RFC 0001)                             | No pnpm-workspace; single root `package.json` + `packages/dsl/package.json` with tsconfig alias — no workspace protocol | DIFFERENT (simpler)                              |
| "Postgres + MinIO required for self-hosted" (docs/self-hosting.md)   | `compose.yml` provides both; service fails without them (no in-memory production fallback)                              | IMPLEMENTED                                      |
| "Migrations run automatically on startup" (docs/self-hosting.md)     | `src/runtime/storage.ts:194-456` `storageMigrationLayer` via `PgMigrator`                                               | IMPLEMENTED                                      |
| "Dashboard is an Interface-layer client" (README)                    | `src/dashboard/server.ts` proxies all API calls to engine; no direct storage access                                     | IMPLEMENTED                                      |
| "CLI is Engine-backed, not direct Postgres reader" (README)          | `makeAppLayer` provides HTTP clients, not storage layers                                                                | IMPLEMENTED                                      |
| "Hosted mode path preserved" (ADR 0004)                              | No code references to hosted mode, multi-node, or workers                                                               | NOT FOUND (deferred by doc)                      |
| "Metrics endpoint at /metrics" (docs/self-hosting.md)                | `src/service/server.ts:195-200` — implemented as Option                                                                 | IMPLEMENTED                                      |
| "readyz endpoint" (docs/self-hosting.md)                             | `src/service/server.ts:192-193` — checks Postgres + S3                                                                  | IMPLEMENTED                                      |
| "dashboard starts on port 3001" (README)                             | `src/dashboard/server.ts:14` — `DASHBOARD_PORT` env var defaults to 3001                                                | IMPLEMENTED                                      |
| "All three layers (DSL, Engine, Interface) documented" (RFC 0001)    | Code has `src/dsl/`, `src/engine/`, `src/dashboard/` + `src/cli/`                                                       | IMPLEMENTED                                      |
| "Proto single-node, not worker-based" (ADR 0001)                     | Only `LocalContainerExecutor` in `src/engine/executor.ts`                                                               | IMPLEMENTED                                      |

## 10. Limitations, shortcuts, and incomplete areas

- **No monorepo tool.** `packages/dsl/` uses a tsconfig path alias, not pnpm workspaces or npm workspaces. Not a workspace-proper package.
- **No production build step.** `index.ts`, `server.ts`, `dashboard.ts` are run directly via `bun run` — no bundling/compilation for production (Bun runs TS directly).
- **Docker uses full source copy.** `Dockerfile:14` (`COPY . .`) includes all source, docs, examples, tests. No `.dockerignore` was found (`.gitignore` exists but doesn't exclude tests from build).
- **Dashboard is separate process.** It cannot embed the engine like CLI can. This asymmetrical architecture is not documented in ADRs but is a real packaging choice.
- **No typecheck in test or CI scripts.** `bun run typecheck` uses `tsc --noEmit`; `bun run test` uses vitest via Bun; no `test:typecheck` or combined command.
- **Environment `.env` is gitignored** correctly; `.env.demo` is the template — but `SECRETS_MASTER_KEY` in `.env.demo` has `replace-with-base64-32-byte-key` placeholder, so users must edit it.
- **`gitignored` `.effect-cicd/`** directory is for GitHub snapshot cache (`src/runtime/config.ts:232`); this could be surprising for new operators.
- **`RUN_DOCKER_TESTS=1`** test mode is mentioned in README but no explicit script for it in `package.json`.
- **Heathcheck endpoint** (`/healthz`) returns plain "ok", not JSON. `/readyz` returns JSON. Inconsistent response format.
- **No graceful shutdown for dashboard.** `dashboard.ts` uses `Effect.never` with no signal handlers. Service has `SIGTERM`/`SIGINT` handlers (`:345-346`).

## 11. What the final coursework report should say

- **Safe claims:**
  - The repo is a single-project Bun application with four standalone entrypoints for different operational modes.
  - The code is 100% TypeScript, typed via Effect's strict service pattern, and follows a 3‑layer DSL–Engine–Interface architecture.
  - The only package boundary is `@effect-cicd/dsl`, which is resolved via tsconfig alias, not a workspace protocol.
  - `Dockerfile` packages the engine service; Docker Compose bundles Postgres + MinIO for self-hosted operation.
  - The architecture matches the documented ADR 0004 single-node topology with an embedded container executor.
  - Four `BunRuntime.runMain` entrypoints exist: CLI (`index.ts`), local CLI (`index.local.ts`), service (`server.ts`), dashboard (`dashboard.ts`).
- **Claims to avoid:**
  - "Monorepo" — it's a single-project repo, not a monorepo.
  - "Fully tested in CI" — no CI config files are present in the repo.
  - "Production-ready" — version 0.1.0, prototype, no CI pipeline, no release tooling.
- **Suggested figures/tables/screenshots:**
  - **Figure 1:** Directory tree showing top-level + `src/` + `packages/` layout (annotated by layer).
  - **Table 1:** Entrypoints and what each owns (CLI, local CLI, service, dashboard).
  - **Table 2:** `package.json` scripts with their effect (short description).
  - **Table 3:** Technology stack: Bun, Effect v4, React 19, Tailwind 4, Postgres, MinIO.
  - **Figure 2:** Deployment topology diagram — single node, two Compose configurations, three runtime modes.
- **Suggested appendix material:**
  - Full `package.json` dependency list (annotated by category: runtime, dev, dashboard).
  - Config table from `docs/self-hosting.md` (already neatly formatted).
  - Migration list from `src/runtime/storage.ts` (10 migrations with purpose).

## 12. Open questions for report writer

- Dashboard+service asymmetry: is the dashboard's separate-process architecture worth noting as a divergence from the "shared model" principle?
- Should the report count the `@effect-solutions` dev tooling (`effect-solutions list`, `~/.local/share/effect-solutions/`) as part of the development environment docs?
- The `smee` script in `package.json:21` references an existing sme.io channel (`D5fIyuSgmdy8hij`) — is this relevant for the report?
- `bun run prepare` calls `effect-language-service patch` — should this be mentioned as a build step?

# Context Report: DSL Authoring Layer and Normalized Workflow Definition

## 1. Scope

- **Owned area**: TypeScript workflow authoring API, authored declarations (`AuthoredWorkflow`, `AuthoredUnit`), materialization into `NormalizedWorkflowDefinition`, workflow module loading, DSL-side validation.
- **Explicit exclusions**: Planner execution-plan derivation, Orchestrator runtime semantics, Executor command/container execution, UI rendering.
- **Related areas / handoff edges**: Output `NormalizedWorkflowDefinition` → Engine `Planner` (`src/engine/planner.ts`); workflow file loading → `WorkflowModuleLoader` consumed by CLI (`src/cli/index.ts:471-474`) and GitHub integration (`src/github/integration.ts:490`).

## 2. Implementation status

| Capability / responsibility                                           | Status          | Evidence                                                           | Notes                                                                                                     |
| --------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Public DSL API (Workflow/Job builders)                                | IMPLEMENTED     | `src/dsl/public.ts:224-384`, `packages/dsl/src/public.ts:220-380`  | Two near-identical implementations                                                                        |
| AuthoredWorkflow types                                                | IMPLEMENTED     | `src/dsl/authored-workflow.ts:155-166`                             | Flat declaration interface                                                                                |
| AuthoredUnit types                                                    | IMPLEMENTED     | `src/dsl/authored-workflow.ts:140-153`                             | Execution-unit declaration                                                                                |
| Authored types for triggers, conditions, policies, artifacts, reports | IMPLEMENTED     | `src/dsl/authored-workflow.ts:20-138`                              | 6 condition types, 3 policy types, 2 trigger types                                                        |
| NormalizedWorkflowDefinition schema                                   | IMPLEMENTED     | `src/domain/workflow-definition.ts:222-237`                        | Schema-declared class with all categories                                                                 |
| Lower workflow (WorkflowDsl → AuthoredWorkflow)                       | IMPLEMENTED     | `src/dsl/public.ts:162-184`                                        | Strips live builder objects                                                                               |
| Materialization (AuthoredWorkflow → NormalizedWorkflowDefinition)     | IMPLEMENTED     | `src/dsl/materializer.ts:64-149`                                   | Effect-based service with validation                                                                      |
| DSL-side validation                                                   | PARTIAL         | `src/dsl/materializer.ts:73-133`                                   | Missing: no warnings/diagnostics array, no cycle detection, no DAG validation, no input source validation |
| Dependency declaration model                                          | IMPLEMENTED     | `public.ts:303-308` (Job.dependsOn), `materializer.ts:106-133`     | String IDs → explicit `DependencyDeclaration`                                                             |
| Reusable fragment/composition                                         | PARTIAL         | `tests/dsl-materializer.test.ts:181-199`                           | Only TypeScript function composition; no formal fragment system                                           |
| Static expansion / matrix                                             | STUB            | Not found in any source file under `src/dsl/`                      | SDD describes it; no code exists                                                                          |
| DSL diagnostics (warnings)                                            | NOT IMPLEMENTED | `src/dsl/materializer.ts`                                          | Only errors via `DslMaterializationFailed`                                                                |
| Source metadata capture in public API                                 | PARTIAL         | `authored-workflow.ts:5-10`                                        | Type exists but `Job.source()`/`Workflow.source()` not exposed in public builder API                      |
| Trigger declarations                                                  | IMPLEMENTED     | `src/dsl/public.ts:386-392`, `workflow-definition.ts:92-107`       | Manual + GitHub push; defaults to Manual                                                                  |
| Condition declarations                                                | IMPLEMENTED     | `src/dsl/public.ts:394-407`, `workflow-definition.ts:147-198`      | 6 condition types, unit-level only                                                                        |
| Retry/timeout/cancellation policy declarations                        | IMPLEMENTED     | `src/dsl/public.ts:460-490`, `workflow-definition.ts:122-145`      | All 3 policy types                                                                                        |
| Artifact/report declarations                                          | IMPLEMENTED     | `src/dsl/public.ts:441-458`                                        | Artifact: file kind; Report: file-backed                                                                  |
| Workflow input/output declaration                                     | IMPLEMENTED     | `src/dsl/public.ts:417-438`                                        | Input from workflow/unit-output, output file                                                              |
| Workflow module loading                                               | IMPLEMENTED     | `src/dsl/loader.ts:72-108`                                         | Loads default → named `workflow` export; auto-symlinks `@effect-cicd/dsl`                                 |
| Workflow-level conditions                                             | NOT IMPLEMENTED | `authored-workflow.ts:155-166`                                     | No `conditions` field on `AuthoredWorkflow`                                                               |
| Example workflows                                                     | IMPLEMENTED     | `src/dsl/examples/sample-workflow.ts`, `examples/demo-workflow.ts` | Functional examples using the public DSL                                                                  |
| Builder-only DSL package (`@effect-cicd/dsl`)                         | IMPLEMENTED     | `packages/dsl/`                                                    | Published separately for user workflows                                                                   |

## 3. Main source locations

| Path                                                                         | Role in this area            | Important symbols / entrypoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/dsl/public.ts` (and `packages/dsl/src/public.ts`)                       | Public builder API           | `Workflow.make/named/metadata/on/job/input/output/artifact/report`, `Job.make/named/image/exec/run/dependsOn/when/input/output/artifact/report/retry/timeout/cancel/env/secret/workingDirectory/metadata`, `Trigger.manual/githubPush`, `Condition.event/manual/githubPush/branch/ref/tag/inputEquals/upstreamStatus`, `Command.shell/argv`, `Input.make/fromWorkflow/fromJob`, `Output.file/fromJob`, `Artifact.file`, `Report.file`, `Retry.times`, `Timeout.seconds/minutes`, `Cancellation.bestEffort/failFast`, `Secret.ref`, `lowerWorkflowAuthoring`, `isWorkflowDsl`, `isWorkflowAuthoring` |
| `src/dsl/authored-workflow.ts` (and `packages/dsl/src/authored-workflow.ts`) | Authored declaration types   | `AuthoredWorkflow`, `AuthoredUnit`, `AuthoredContainerCommand`, `AuthoredTrigger`, `AuthoredCondition`, `AuthoredPolicy`, `AuthoredArtifactDeclaration`, `AuthoredReportDeclaration`, `AuthoredOutputDeclaration`, `AuthoredUnitInputDeclaration`, `AuthoredSourceMetadata`                                                                                                                                                                                                                                                                                                                         |
| `src/dsl/materializer.ts`                                                    | Materialization service      | `DslMaterializer`, `materialize`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/dsl/loader.ts`                                                          | Workflow module loader       | `WorkflowModuleLoader`, `loadWorkflowModule`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/domain/workflow-definition.ts`                                          | Normalized definition schema | `NormalizedWorkflowDefinition`, `UnitDeclaration`, `DependencyDeclaration`, `ContainerCommandDeclaration`, `RetryPolicyDeclaration`, `TimeoutPolicyDeclaration`, `CancellationPolicyDeclaration`, `ConditionDeclaration`, `ArtifactDeclaration`, `ReportDeclaration`, `SourceMetadata`, `TriggerDeclaration`                                                                                                                                                                                                                                                                                        |
| `src/domain/errors.ts`                                                       | Error types                  | `DslMaterializationFailed` (line 5-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/domain/ids.ts`                                                          | Branded IDs                  | `WorkflowId`, `UnitId` (lines 3-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/domain/secrets.ts`                                                      | Secret reference             | `SecretRef`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/dsl/index.ts`                                                           | Unified export barrel        | Re-exports all DSL modules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/dsl/builders.ts` (and `packages/dsl/src/builders.ts`)                   | Identity/helper functions    | `workflow`, `unit`, `containerCommand`, `artifact`, `trigger`, `input`, `output`, `report`, `condition`, `retry`, `timeout`, `cancellation`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 4. Actual responsibilities found in code

- Provide a TypeScript-native declaration builder API (`WorkflowDsl`/`JobDsl`) that uses an immutable state-object pattern with `pipe` modifiers.
- Provide a raw-object interface (`AuthoredWorkflow`/`AuthoredUnit`) as a lower-level authoring alternative.
- Lower live builder objects into raw declaration objects (`lowerWorkflowAuthoring`).
- Materialize raw declarations into an Effect Schema-validated `NormalizedWorkflowDefinition`.
- Default to `ManualTrigger` when no triggers are declared.
- Resolve `dependsOn` string IDs into explicit `DependencyDeclaration(from, to)` edges.
- Validate: non-empty ids/names, at least one unit, no duplicate unit-ids, non-empty command env names, non-empty artifact/report/input/output names/paths, supported condition/policy tags, valid dependency targets (no self-dependency, no missing targets), no duplicate dependencies.
- Load workflow modules from disk, auto-symlinking `@effect-cicd/dsl` into the user's `node_modules`.
- Support two trigger kinds (`ManualTrigger`, `GitHubPushTrigger`), six condition kinds (trigger event/branch/ref/tag, input equality, upstream status), three policy kinds (retry, timeout, cancellation).
- Support secret env references via `SecretRef`.

## 5. Core data structures, types, services, and APIs

| Name                           | Kind                           | Location                         | Purpose                                | Upstream / downstream connections                        |
| ------------------------------ | ------------------------------ | -------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| `WorkflowDsl`                  | Interface (branded `Pipeable`) | `public.ts:65-67`                | Live builder object for workflow       | Lowered by `lowerWorkflowAuthoring` → `AuthoredWorkflow` |
| `JobDsl`                       | Interface (branded `Pipeable`) | `public.ts:61-63`                | Live builder object for job            | Lowered by `lowerJob` → `AuthoredUnit`                   |
| `AuthoredWorkflow`             | Interface                      | `authored-workflow.ts:155-166`   | Raw declaration of a workflow root     | Input to `DslMaterializer.materialize`                   |
| `AuthoredUnit`                 | Interface                      | `authored-workflow.ts:140-153`   | Raw declaration of an execution unit   | Materialized into `UnitDeclaration`                      |
| `AuthoredContainerCommand`     | Interface                      | `authored-workflow.ts:71-77`     | Container execution payload            | Materialized into `ContainerCommandDeclaration`          |
| `DslMaterializer`              | Effect Service                 | `materializer.ts:51-56`          | Service: materialize to normalized def | Produces `NormalizedWorkflowDefinition` → `Planner`      |
| `WorkflowModuleLoader`         | Effect Service                 | `loader.ts:53-70`                | Service: load workflow from file       | Produces `WorkflowAuthoring` → `DslMaterializer`         |
| `NormalizedWorkflowDefinition` | Schema class                   | `workflow-definition.ts:222-237` | Engine-facing normalized definition    | Input to `Planner.plan` / `Planner.validate`             |
| `UnitDeclaration`              | Schema class                   | `workflow-definition.ts:208-220` | Normalized unit declaration            | Consumed by Planner → `PlanUnit`                         |
| `DependencyDeclaration`        | Schema class                   | `workflow-definition.ts:85-90`   | Explicit dependency edge (from→to)     | Consumed by Planner → `PlanDependency`                   |
| `DslMaterializationFailed`     | Tagged error                   | `errors.ts:5-10`                 | Materialization failure                | Caught by CLI/server consumers                           |

## 6. Main runtime flows

### Flow A: Workflow authoring and materialization

1. User writes `Workflow.make("id").pipe(Workflow.job(Job.make("job:1").pipe(...)))` in a TypeScript file.
2. At load time, `WorkflowModuleLoader.load` imports the file, extracts `default` or `workflow` named export, validates it's a `WorkflowAuthoring`.
3. If the exported value is a `WorkflowDsl`, `lowerWorkflowAuthoring` converts it to an `AuthoredWorkflow` by iterating jobs, calling `lowerJob` on each to produce `AuthoredUnit`.
4. `DslMaterializer.materialize` receives the `AuthoredWorkflow`, validates it, resolves `dependsOn` strings to `DependencyDeclaration` edges, and converts all fields to Schema-declared types.
5. Returns a `NormalizedWorkflowDefinition` with `schemaVersion: "0.1.0"`.
6. The `NormalizedWorkflowDefinition` is passed to `Planner.plan` which validates and produces `ExecutionPlan`.

Evidence:

- `src/dsl/public.ts:64-149` — `materialize` function showing the lowering+validation+conversion flow
- `src/dsl/public.ts:162-184` — `lowerWorkflowAuthoring` strips builder state
- `src/dsl/loader.ts:72-108` — module loading with named/default export resolution
- `src/dsl/materializer.ts:64-149` — validation passes and `NormalizedWorkflowDefinition` construction
- `tests/dsl-materializer.test.ts:202-229` — end-to-end test: DSL → materialize → Planner.plan

### Flow B: CLI invocation

1. CLI command (`validate`, `plan`, `run`) parses args with `effect/unstable/cli`.
2. `loadAndMaterializeWorkflow` calls `WorkflowModuleLoader.load` then `DslMaterializer.materialize`.
3. Materialized definition is passed to `Engine.validate`, `Engine.plan`, or `Engine.startDefinition`.

Evidence:

- `src/cli/index.ts:467-474` — `loadAndMaterializeWorkflow` function
- `src/cli/index.ts:125-167` — `validateCommand`, `planCommand`, `runCommand`
- `src/engine/interface.ts:60-62` — `Engine.validate` and `Engine.plan` accept `NormalizedWorkflowDefinition`

## 7. User-visible behavior / report-relevant behavior

- **CLI commands**: `validate <module>`, `plan <module>`, `run <module>`; all follow load→materialize→engine pipeline.
- **Inputs accepted**: A TypeScript module exporting `default` or named `workflow` export, which is a `WorkflowAuthoring` (either `WorkflowDsl` builder or raw `AuthoredWorkflow` object).
- **Outputs produced**: `NormalizedWorkflowDefinition` with validated structure, explicit dependency edges, and schema version `"0.1.0"`.
- **Errors/diagnostics surfaced**: `DslMaterializationFailed` with descriptive messages: "Duplicate unit id", "Dependency target does not reference an existing unit", "Unit X cannot depend on itself", "must declare an image/command", etc. No warnings or non-fatal diagnostics.
- **Test-visible behavior**: Materialization is deterministic (same input → same `NormalizedWorkflowDefinition`); test at `dsl-materializer.test.ts:181-199` verifies this.

## 8. Dependencies and integrations

| Dependency / integration               | Used for                                        | Location                             | Notes                                                                                             |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `effect` (v4 beta)                     | Effect system, Schema, Context, Layer, Pipeable | `package.json` (root + packages/dsl) | Core framework. Schema used for `NormalizedWorkflowDefinition`, all domain types, and error types |
| `effect/unstable/cli`                  | CLI argument/flag parsing                       | `src/cli/index.ts:3`                 | CLI command definitions                                                                           |
| `Bun.resolveSync`, `Bun.pathToFileURL` | Module resolution                               | `src/dsl/loader.ts:121,133`          | Bun-specific APIs                                                                                 |
| `node:fs` (symlinkSync, existsSync)    | Auto-symlink `@effect-cicd/dsl`                 | `src/dsl/loader.ts:161-179`          | Ensures user projects can import from `@effect-cicd/dsl`                                          |
| `@effect-cicd/dsl` (npm package)       | Separate publishable package                    | `packages/dsl/`                      | Duplicated source; symlink target for user workflows                                              |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                           | Actual code evidence                                                                                       | Classification                                          |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Reusable fragment and composition model (SDD §4)                                      | Only plain TypeScript functions composing `JobDsl`; no formal fragment system, no fragment origin metadata | PARTIAL                                                 |
| Static expansion / matrix expansion (SDD §4, ADR §"Static expansion where supported") | No expansion code exists in `src/dsl/` or `packages/dsl/`                                                  | NOT IMPLEMENTED                                         |
| DSL-side diagnostics with warnings vs errors (SDD §5)                                 | Only `DslMaterializationFailed` error; no diagnostic severity model, no warning emission                   | NOT IMPLEMENTED                                         |
| Source metadata capture for all declaration locations (SDD §4)                        | `AuthoredSourceMetadata` type exists but `Job.source()` / `Workflow.source()` not exposed in public API    | PARTIAL                                                 |
| Workflow-level condition declarations (SDD §"Runtime Conditions")                     | `AuthoredWorkflow` has no `conditions` field; conditions are unit-level only                               | DIFFERENT (but matches `docs/workflow-semantics.md:85`) |
| Workflow-level policy declarations                                                    | Not present on `AuthoredWorkflow` or `NormalizedWorkflowDefinition`                                        | NOT IMPLEMENTED                                         |
| Cycle detection in DSL validation                                                     | Not in `materializer.ts`; cycle detection exists only in `Planner` (`planner.ts:248-289`)                  | DIFFERENT (moved to Engine)                             |
| Version/compatibility metadata on normalized def                                      | Schema version `"0.1.0"` hardcoded in `materializer.ts:62`                                                 | PARTIAL (present but minimal)                           |

## 10. Limitations, shortcuts, and incomplete areas

- **Two source-of-truth**: `packages/dsl/` and `src/dsl/` are near-identical copies. The `packages/dsl/` version is auto-symlinked into user projects but lacks `loader.ts` and `materializer.ts`.
- **No formal fragment/reuse model**: Only plain TypeScript functions returning `JobDsl`. No fragment identity, no fragment origin metadata.
- **No static expansion**: Matrix-like workflows must be authored manually with TypeScript loops (no code enforcement).
- **No DSL-level DAG validation**: Cycle detection is in the Planner only. Duplicate edges are caught but not cycles.
- **No DSL-side input source validation**: Validating that `Input.fromWorkflow` references an existing workflow input is left to the Planner.
- **No warnings at materialization**: All validation failures are hard errors; no `warn` or `info` diagnostics.
- **No `Job.source()`/`Workflow.source()` public API**: Source metadata can only be set via the raw `AuthoredWorkflow`/`AuthoredUnit` interfaces.
- **No workflow-level conditions**: Only unit-level conditions are supported (documented as V1 choice).
- **`lowerWorkflowAuthoring` throws on missing image/command**: Uses `throw` instead of `Effect.fail` when image or command is missing (materializer wraps this in `Effect.try` so it's caught, but it's a code smell).
- **Only 2 trigger types**: Manual and GitHub push. No webhook, scheduled, or other triggers.
- **Schema version is hardcoded**: `"0.1.0"` is a literal string in `materializer.ts:62`.

## 11. What the final coursework report should say

- **Safe claims**:
  - The DSL is implemented as a TypeScript declaration-builder API with `Workflow` and `Job` modifier-chain pattern.
  - The boundary between DSL and Engine is the Schema-typed `NormalizedWorkflowDefinition`.
  - Materialization is a synchronous (Effect-based) transformation with validation: id/name checks, duplicate detection, command completeness, dependency target validation.
  - Dependency edges are explicit `(from, to)` pairs derived from `dependsOn` strings.
  - Two trigger kinds, six condition kinds, three policy kinds are supported.
  - The DSL is a static-declaration system: no runtime graph mutation, no live builder objects cross into the Engine.
  - Workflow modules are loaded dynamically via `Bun` and auto-resolve the `@effect-cicd/dsl` package.

- **Claims to avoid**:
  - Do not claim "reusable fragment system" — only plain TypeScript function composition exists.
  - Do not claim "static expansion" — no code implements it.
  - Do not claim "DSL diagnostics with severity model" — only hard errors exist.
  - Do not claim "source metadata is fully captured" — the type exists but is not exposed in the public builder API.

- **Suggested figures/tables/screenshots**:
  - Table comparing intended DSL capabilities (from SDD) vs implemented.
  - Figure showing the materialization pipeline: `WorkflowDsl → lowerWorkflowAuthoring → AuthoredWorkflow → validate → NormalizedWorkflowDefinition`.
  - Screenshot or code block of the example workflow (`examples/demo-workflow.ts` or `src/dsl/examples/sample-workflow.ts`).
  - Diagram showing the `NormalizedWorkflowDefinition` schema structure.

- **Suggested appendix material**:
  - Full source listing of `src/dsl/public.ts` (the public API surface).
  - Full source listing of `src/domain/workflow-definition.ts` (the normalized schema).
  - Test output from `dsl-materializer.test.ts`.

## 12. Open questions for report writer

- Does the report need to address the two-copy problem (`src/dsl/` vs `packages/dsl/`)?
- Should the missing cycle-detection-in-DSL be noted as a conscious design choice or a gap?
- The workflow-level condition and policy absence — is this intentional V1 scoping or a missing feature?
- The test suite only covers happy-path materialization + a few error cases; should the report note the limited test coverage for validation?

# Context Report: Planner and Execution Plan Derivation

## 1. Scope

- **Owned area**: Validating normalized workflow definitions, canonicalizing structure, deriving explicit execution plans, producing diagnostics.
- **Explicit exclusions**: DSL materialization internals, runtime scheduling/readiness, command/container execution, dashboard graph rendering, plan persistence/snapshotting (not implemented).
- **Related areas / handoff edges**: DSL materializer → `NormalizedWorkflowDefinition` → Planner → `ExecutionPlan` → Orchestrator. Engine facade delegates to Planner via `Engine.validate()` and `Engine.plan()`. Dashboard reads plan diagnostics from `ExecutionPlan.diagnostics` via collectDiagnostics().

## 2. Implementation status

| Capability / responsibility                                   | Status         | Evidence                                                                      | Notes                                                                                                                                                              |
| ------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accept normalized workflow definition                         | IMPLEMENTED    | `src/engine/planner.ts:48` — `plan(definition: NormalizedWorkflowDefinition)` | Accepts via Planner service method                                                                                                                                 |
| Validate schema version                                       | IMPLEMENTED    | `src/engine/planner.ts:68-71`                                                 | Checks `schemaVersion === "0.1.0"` (hardcoded string)                                                                                                              |
| Validate workflow name non-empty                              | IMPLEMENTED    | `src/engine/planner.ts:73-75`                                                 |                                                                                                                                                                    |
| Validate at least one unit                                    | IMPLEMENTED    | `src/engine/planner.ts:77-79`                                                 |                                                                                                                                                                    |
| Validate triggers                                             | IMPLEMENTED    | `src/engine/planner.ts:424-465`                                               | Duplicate manual/github-push, non-empty branches/refs/tags                                                                                                         |
| Validate unit ID uniqueness                                   | IMPLEMENTED    | `src/engine/planner.ts:117-119`                                               |                                                                                                                                                                    |
| Validate workflow input uniqueness                            | IMPLEMENTED    | `src/engine/planner.ts:92-94`                                                 |                                                                                                                                                                    |
| Validate workflow output uniqueness                           | IMPLEMENTED    | `src/engine/planner.ts:104-107`                                               |                                                                                                                                                                    |
| Validate unit input uniqueness                                | IMPLEMENTED    | `src/engine/planner.ts:133-136`                                               |                                                                                                                                                                    |
| Validate unit output uniqueness                               | IMPLEMENTED    | `src/engine/planner.ts:145-150`                                               |                                                                                                                                                                    |
| Validate report uniqueness                                    | IMPLEMENTED    | `src/engine/planner.ts:167-170`                                               |                                                                                                                                                                    |
| Validate workspace-relative paths (outputs/reports/artifacts) | IMPLEMENTED    | `src/engine/planner.ts:154-156, 174-177, 187-190`                             | Rejects absolute paths and `../` escape                                                                                                                            |
| Validate dependency reference integrity                       | IMPLEMENTED    | `src/engine/planner.ts:195-200`                                               |                                                                                                                                                                    |
| Validate self-dependency                                      | IMPLEMENTED    | `src/engine/planner.ts:203-205`                                               |                                                                                                                                                                    |
| Validate duplicate dependency                                 | IMPLEMENTED    | `src/engine/planner.ts:207-211`                                               |                                                                                                                                                                    |
| DAG cycle detection (DFS)                                     | IMPLEMENTED    | `src/engine/planner.ts:248-289`                                               | Recursive DFS with visiting/visited sets                                                                                                                           |
| Validate input source resolution                              | IMPLEMENTED    | `src/engine/planner.ts:370-398`                                               | Checks workflow input exists, output exists on referenced unit, explicit dependency edge exists                                                                    |
| Validate workflow output source                               | IMPLEMENTED    | `src/engine/planner.ts:400-422`                                               |                                                                                                                                                                    |
| Validate conditions                                           | IMPLEMENTED    | `src/engine/planner.ts:467-498`                                               | Trigger event/branch/ref/tag, workflow input ref, upstream status                                                                                                  |
| Derive explicit execution plan                                | IMPLEMENTED    | `src/engine/planner.ts:291-339`                                               | Creates `ExecutionPlan` with sorted units/dependencies                                                                                                             |
| Deterministic canonical ordering                              | IMPLEMENTED    | `src/engine/planner.ts:291, 500-510`                                          | Units and dependencies sorted by string compare                                                                                                                    |
| Convert payload declarations                                  | IMPLEMENTED    | `src/engine/planner.ts:341-368`                                               | ContainerCommand → ContainerCommandDescriptor; policy declarations → PlanPolicy variants                                                                           |
| Preserve source metadata                                      | IMPLEMENTED    | `src/engine/planner.ts:312-338`                                               | Passes through from definition                                                                                                                                     |
| Preserve secret references                                    | IMPLEMENTED    | `src/engine/planner.ts:347`                                                   | Env includes `SecretRef` values                                                                                                                                    |
| Preserve inputs/outputs/artifacts/reports/conditions/policies | IMPLEMENTED    | `src/engine/planner.ts:315-326`                                               | Passed through to `PlanUnit`                                                                                                                                       |
| Produce diagnostics                                           | IMPLEMENTED    | `src/engine/planner.ts:337-338`                                               | `diagnostics: []` always empty array — no planner-level diagnostics are actually generated                                                                         |
| PlanningFailed error type                                     | PARTIAL        | `src/engine/planner.ts:33-35`                                                 | Type is declared in `plan()` return signature but never emitted — `plan()` delegates to `validate()` and calls `createPlan()` which never returns `PlanningFailed` |
| Plan persistence / snapshotting                               | NOT_APPLICABLE | No plan storage or snapshot hooks exist                                       | Plan is embedded in `WorkflowRunState.execution.plan` at run creation time                                                                                         |
| DSL-layer validation vs Planner validation separation         | IMPLEMENTED    | `src/dsl/materializer.ts` vs `src/engine/planner.ts`                          | Materializer checks basic shape; Planner checks graph and reference integrity                                                                                      |
| Dependency on final DSL syntax                                | STUB           | `src/engine/planner.ts` receives normalized definition only                   | Planner depends on `NormalizedWorkflowDefinition` schema, not DSL syntax                                                                                           |
| Plan diagnostics exposed via Engine/Interface                 | IMPLEMENTED    | `src/dashboard/reads.ts:314-317`                                              | `collectDiagnostics()` reads plan.diagnostics and unit.diagnostics                                                                                                 |
| In-plan condition representation                              | IMPLEMENTED    | `src/domain/execution-plan.ts:81`                                             | Conditions from definition are copied into plan                                                                                                                    |
| Input validation linking to explicit dependency               | IMPLEMENTED    | `src/engine/planner.ts:395-397`                                               | Input referencing another unit's output requires explicit dependency edge                                                                                          |
| Workspace path validation                                     | IMPLEMENTED    | `src/engine/planner.ts:514-521`                                               | Rejects `/`-prefixed and `../` paths                                                                                                                               |
| Schema for ExecutionPlan                                      | IMPLEMENTED    | `src/domain/execution-plan.ts:87-99`                                          | Full Effect Schema class                                                                                                                                           |
| Schema for NormalizedWorkflowDefinition                       | IMPLEMENTED    | `src/domain/workflow-definition.ts:222-237`                                   | Full Effect Schema class                                                                                                                                           |
| Test coverage of Planner                                      | IMPLEMENTED    | `tests/planner.test.ts` (413 lines)                                           | 14 tests covering validation, planning, ordering, errors                                                                                                           |

## 3. Main source locations

| Path                                | Role in this area                                              | Important symbols / entrypoints                                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/planner.ts`             | Central planner implementation                                 | `Planner` (service class), `validate()`, `plan()`, `validateDefinition()`, `hasCycle()`, `createPlan()`, `validateInputSource()`, `validateCondition()`, `validateTriggers()`, `validateWorkflowOutputSource()`, `isWorkspaceRelativePath()`                         |
| `src/domain/execution-plan.ts`      | Execution plan schema & types                                  | `ExecutionPlan`, `PlanUnit`, `PlanDependency`, `PlanRetryPolicy`, `PlanTimeoutPolicy`, `PlanCancellationPolicy`, `ContainerCommandDescriptor`, `PayloadDescriptor`, `PlanningDiagnostic`                                                                             |
| `src/domain/workflow-definition.ts` | Normalized workflow definition schema (Planner input)          | `NormalizedWorkflowDefinition`, `UnitDeclaration`, `DependencyDeclaration`, `UnitInputDeclaration`, `OutputDeclaration`, `ArtifactDeclaration`, `ReportDeclaration`, `ConditionDeclaration` union, `PolicyDeclaration` union, `PayloadDeclaration`, `SourceMetadata` |
| `src/domain/errors.ts`              | Domain error types                                             | `WorkflowDefinitionInvalid`, `PlanningFailed` (declared but never emitted), `DslMaterializationFailed`                                                                                                                                                               |
| `src/engine/interface.ts`           | Engine facade delegating to Planner                            | `Engine.validate()`, `Engine.plan()`, `Engine.startDefinition()` (plan+run)                                                                                                                                                                                          |
| `src/engine/orchestrator.ts`        | Consumes ExecutionPlan at run creation                         | `createRun()`, `startRun()` (embeds plan in `WorkflowRunState.execution.plan`), `decidePendingUnit()`, `getReadyUnitIds()`                                                                                                                                           |
| `src/engine/run-controller.ts`      | Submits runs with plans                                        | `submitRun(plan)`, `retryRun()` (reuses prior run's plan)                                                                                                                                                                                                            |
| `src/domain/runtime-state.ts`       | Runtime state embeds ExecutionPlan                             | `WorkflowRunState.execution.plan: ExecutionPlan`                                                                                                                                                                                                                     |
| `src/domain/ids.ts`                 | Identity types used in plans                                   | `PlanId`, `UnitId`, `WorkflowId` (branded strings)                                                                                                                                                                                                                   |
| `src/dsl/materializer.ts`           | Materializes authored workflow to NormalizedWorkflowDefinition | `DslMaterializer.materialize()`                                                                                                                                                                                                                                      |
| `src/dsl/public.ts`                 | Public DSL surface with Job/Workflow builders                  | `Workflow`, `Job`, `Trigger`, `Condition`, `Command`, `Input`, `Output`, `Artifact`, `Report`, `Retry`, `Timeout`, `Cancellation`, `Secret`                                                                                                                          |
| `src/dashboard/reads.ts`            | Reads plan diagnostics for dashboard                           | `collectDiagnostics()`, `mapPlanningDiagnostic()`                                                                                                                                                                                                                    |
| `tests/planner.test.ts`             | Planner unit tests                                             | 14 test cases                                                                                                                                                                                                                                                        |
| `tests/dsl-materializer.test.ts`    | DSL materializer tests (overlaps validation boundary)          | Effects-based tests                                                                                                                                                                                                                                                  |
| `tests/engine-interface.test.ts`    | Engine integration tests                                       | Tests validate/plan/startDefinition flows                                                                                                                                                                                                                            |

## 4. Actual responsibilities found in code

- Accept `NormalizedWorkflowDefinition` as input via `Planner.validate()` and `Planner.plan()`.
- Validate the definition against Engine-level rules: schema version, non-empty fields, uniqueness constraints, dependency reference integrity, DAG acyclicity (DFS), input source resolution, condition reference integrity, workspace-relative path constraints.
- Derive `ExecutionPlan` with deterministic canonical ordering (sorting by UnitId string comparison).
- Convert `PayloadDeclaration` (tagged union) → `PayloadDescriptor` (currently only `ContainerCommandDescriptor`).
- Convert `PolicyDeclaration` → `PlanPolicy` variants (`PlanRetryPolicy`, `PlanTimeoutPolicy`, `PlanCancellationPolicy`).
- Pass through inputs, outputs, artifacts, reports, conditions, source metadata from definition to plan.
- Set default log expectations (`["stdout"]`) per unit.
- Preserve `SecretRef` in environment without resolving.
- Produce `PlanningDiagnostic` arrays (always empty — not actually populated).
- Delegate validation failure reporting via `WorkflowDefinitionInvalid` error.
- Return `ExecutionPlan` for Orchestrator consumption.

## 5. Core data structures, types, services, and APIs

| Name                           | Kind                  | Location                                | Purpose                                                  | Upstream / downstream connections                                                                                   |
| ------------------------------ | --------------------- | --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `NormalizedWorkflowDefinition` | Schema class (input)  | `src/domain/workflow-definition.ts:222` | Engine-facing representation of workflow intent from DSL | Produced by `DslMaterializer`; consumed by `Planner.validate()` and `Planner.plan()`                                |
| `ExecutionPlan`                | Schema class (output) | `src/domain/execution-plan.ts:87`       | Explicit executable plan for Orchestrator                | Produced by `Planner.plan()`; consumed by `Orchestrator.createRun()`, embedded in `WorkflowRunState.execution.plan` |
| `PlanUnit`                     | Schema class          | `src/domain/execution-plan.ts:71`       | Canonical execution-unit descriptor in plan              | Converter from `UnitDeclaration`; consumed by Orchestrator for dispatch                                             |
| `PlanDependency`               | Schema class          | `src/domain/execution-plan.ts:66`       | Dependency edge in plan                                  | Derived from `DependencyDeclaration`                                                                                |
| `ContainerCommandDescriptor`   | Schema class          | `src/domain/execution-plan.ts:28`       | Container execution payload                              | Converted from `ContainerCommandDeclaration`                                                                        |
| `PlanRetryPolicy`              | Schema class          | `src/domain/execution-plan.ts:41`       | Converted retry policy                                   | From `RetryPolicyDeclaration`                                                                                       |
| `PlanTimeoutPolicy`            | Schema class          | `src/domain/execution-plan.ts:49`       | Converted timeout policy                                 | From `TimeoutPolicyDeclaration`                                                                                     |
| `PlanCancellationPolicy`       | Schema class          | `src/domain/execution-plan.ts:56`       | Converted cancellation policy                            | From `CancellationPolicyDeclaration`                                                                                |
| `PlanningDiagnostic`           | Schema class          | `src/domain/execution-plan.ts:21`       | Diagnostic message on plan/unit                          | Collected by dashboard reads; always empty currently                                                                |
| `WorkflowDefinitionInvalid`    | Error (tagged)        | `src/domain/errors.ts:12`               | Validation failure error                                 | Returned by `Planner.validate()` and `Planner.plan()`                                                               |
| `PlanningFailed`               | Error (tagged)        | `src/domain/errors.ts:20`               | Declared but never emitted                               | In `plan()` return type signature but never constructed                                                             |
| `Planner`                      | Context.Service       | `src/engine/planner.ts:29`              | Engine subsystem — validates and plans                   | Depends on no other services; consumed by `Engine` facade                                                           |
| `Engine`                       | Context.Service       | `src/engine/interface.ts:22`            | Engine facade                                            | Delegates `validate()` and `plan()` to `Planner`                                                                    |

## 6. Main runtime flows

### Flow A: Validate normalized workflow definition

1. Engine facade calls `Planner.validate(definition)`.
2. `validateDefinition()` runs sequentially: schema version check → name non-empty → units non-empty → trigger validation → workflow input/output uniqueness → per-unit validation (inputs, outputs, reports, artifacts) → dependency integrity → cycle detection → input source validation → condition validation → workflow output source validation.
3. On first failure, returns `WorkflowDefinitionInvalid` error with message string.

Evidence:

- `src/engine/planner.ts:41-46` — validate() wraps validateDefinition()
- `src/engine/planner.ts:68-244` — validateDefinition() body with all checks

### Flow B: Derive execution plan

1. Engine facade calls `Planner.plan(definition)`.
2. `plan()` calls `validate(definition)` first (reuses validation flow).
3. On success, `createPlan(definition)` is called.
4. `createPlan()` sorts dependencies and units into deterministic order, builds per-unit dependency lists, creates `PlanUnit` array from sorted `UnitDeclaration` array, creates `PlanDependency` from sorted `DependencyDeclaration`, sets default log expectation `["stdout"]`, sets empty diagnostics arrays.
5. Returns `ExecutionPlan` with `planId`, `workflowId`, `units`, `dependencies`, `diagnostics`, pass-through fields (triggers, inputs, outputs, metadata).

Evidence:

- `src/engine/planner.ts:48-51` — plan() calls validate then createPlan
- `src/engine/planner.ts:291-339` — createPlan() body

### Flow C: Plan consumption at run creation (documented but not Planner-owned)

1. Orchestrator receives `ExecutionPlan` from Engine (which got it from Planner).
2. `createRun()` wraps the plan into `RunExecutionContext` and persists it inside `WorkflowRunState.execution.plan`.
3. Orchestrator reads plan units for readiness evaluation, dependency satisfaction, dispatch.

Evidence:

- `src/engine/orchestrator.ts:216-243` — createRun stores plan in execution context
- `src/engine/orchestrator.ts:930-971` — createInitialRun embeds plan in WorkflowRunState
- `src/domain/runtime-state.ts:72-77` — RunExecutionContext has `plan: ExecutionPlan`

## 7. User-visible behavior / report-relevant behavior

- **CLI/API entrypoints**: `Engine.validate(definition)` and `Engine.plan(definition)` are the Engine interface operations. These are called by `Engine.startDefinition()` and `Engine.submitDefinition()` (validate + plan + run pipeline).
- **Inputs accepted**: `NormalizedWorkflowDefinition` with `schemaVersion: "0.1.0"`, at least one unit, consistent dependency graph, valid path references, non-empty names.
- **Outputs produced**: `ExecutionPlan` — a complete static DAG with canonical unit identities, sorted dependencies, payload descriptors, policies, conditions, inputs/outputs/artifacts/reports metadata.
- **Errors surfaced**: `WorkflowDefinitionInvalid` with a `message` string describing the first validation failure encountered. Error tags include specific failure descriptions (e.g. "Dependency graph contains a cycle").
- **Diagnostics**: `PlanningDiagnostic` arrays exist on plan and units but are always empty — there is no code path that populates them. The `PlanningFailed` error is declared but never emitted.

## 8. Dependencies and integrations

| Dependency / integration           | Used for                                   | Location                                                    | Notes                                                     |
| ---------------------------------- | ------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------- |
| `effect` (Context, Effect, Schema) | Service definition, error handling, schema | `src/engine/planner.ts:1`, `src/domain/execution-plan.ts:1` | Planner is an Effect Service; all types use Effect Schema |
| `NormalizedWorkflowDefinition`     | Input type for planner                     | `src/domain/workflow-definition.ts:222`                     | Shared schema between DSL materializer and Planner        |
| `ExecutionPlan`                    | Output type from planner                   | `src/domain/execution-plan.ts:87`                           | Consumed by Orchestrator and stored in runtime state      |
| Engine facade                      | Delegates to Planner                       | `src/engine/interface.ts:60-62`                             | `Engine.validate` and `Engine.plan` call Planner directly |
| Dashboard reads                    | Collects plan diagnostics                  | `src/dashboard/reads.ts:314-317`                            | Reads plan.diagnostics and unit.diagnostics               |
| `node:path` (normalize)            | Workspace path validation                  | `src/engine/planner.ts:3`                                   | Only Node.js dependency in planner                        |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                                                            | Actual code evidence                                                                                                                 | Classification                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Planner validates static DAG constraints, dependency references, unit identity                                         | Fully implemented in `validateDefinition()`                                                                                          | **IMPLEMENTED**                                            |
| Planner produces `PlanningFailed` error for non-validation planning failures                                           | `PlanningFailed` is declared in `errors.ts:20` and in `plan()` return signature (`planner.ts:35`) but `createPlan()` never throws it | **PARTIAL** (type never constructed)                       |
| Planner populates diagnostics on plan/unit level                                                                       | `diagnostics: []` hardcoded in createPlan() (`planner.ts:337,338`) — always empty                                                    | **PARTIAL** (structure exists, never populated)            |
| Planner "canonicalizes Engine-facing workflow structure where needed for deterministic planning"                       | Only sorting is done; no deeper canonicalization                                                                                     | **IMPLEMENTED** (lightweight form)                         |
| Planner "validates declared inputs, outputs, artifacts, reports, runtime conditions, and supported execution policies" | Implemented for all except it doesn't validate policy shapes                                                                         | **PARTIAL** (no policy-shape validation beyond conversion) |
| Planner preserves source and declaration metadata for inspection                                                       | Source metadata is passed through but planner never enriches or validates it                                                         | **IMPLEMENTED**                                            |
| Workflow graph must be complete before planning                                                                        | Static DAG with all units and edges before planning — verified                                                                       | **IMPLEMENTED**                                            |
| Engine must preserve enough current state, event history, plan data, artifact metadata, and log references             | ExecutionPlan is embedded in runtime state via `RunExecutionContext.plan`                                                            | **IMPLEMENTED**                                            |
| DSL must not produce execution plans directly                                                                          | DSL produces NormalizedWorkflowDefinition only                                                                                       | **IMPLEMENTED**                                            |
| Planner may emit planning diagnostics for warnings/non-fatal issues                                                    | `PlanningDiagnostic` struct exists but never populated; any issue → immediate fail                                                   | **PARTIAL** (no warning path, only fail)                   |
| Planner must be testable independently from Orchestrator                                                               | Yes, `planner.test.ts` tests Planner in isolation with `Planner.layer`                                                               | **IMPLEMENTED**                                            |

## 10. Limitations, shortcuts, and incomplete areas

1. **`PlanningDiagnostic` is never populated.** Both `plan.units[].diagnostics` and `plan.diagnostics` are hardcoded to `[]`. The diagnostic infrastructure exists (tagged severity, message, optional unitId, optional source) but nothing writes to it. Any non-fatal issue cannot be reported through diagnostics.
2. **`PlanningFailed` error is dead code.** The type is in the `plan()` return signature (`Effect<ExecutionPlan, WorkflowDefinitionInvalid | PlanningFailed>`) but no code path ever produces it. If `validate()` passes, `createPlan()` always succeeds.
3. **Schema version is hardcoded string `"0.1.0"`.** The supported schema version is a constant rather than read from config or version negotiation.
4. **No policy-shape validation**. Policies are converted via `switch` but there's no validation that the declaration values are reasonable (e.g., `maxAttempts: 0` would pass initial validation but `PositiveInt` schema would catch it at decode time).
5. **Validation stops at first error.** Because `validateDefinition()` returns `string | undefined` (first error only), there is no error accumulation. Users see one error at a time.
6. **No warning diagnostic path.** Any violation is a hard failure; there's no mechanism for soft warnings (e.g., "deprecated trigger type").
7. **No planned workflow visualization data.** The plan has no metadata for layout, grouping, or display hints that a dashboard or CLI could use for graph rendering.
8. **Plan identity is derived from workflow ID.** `PlanId.make(\`plan:${definition.workflowId}\`)` uses workflow identity, not a unique plan hash/version — if the same workflow is planned with different options, the plan ID would conflict.
9. **No plan versioning / hash.** Plans have no content hash or version distinct from the workflow identity.
10. **Cycle detection is O(V+E) DFS** but performs full recursion without explicit stack; deep graphs could stack-overflow.

## 11. What the final coursework report should say

### Safe claims

- Planner is a distinct, independently testable Effect service that validates normalized workflow definitions and produces explicit execution plans.
- The Planner validates: schema version, empty names, duplicate IDs, missing units, dependency graph integrity (including cycle detection via DFS), input/output reference integrity, workspace path safety, and condition reference validity.
- The Planner produces a complete static DAG (`ExecutionPlan`) with deterministic canonical ordering before any execution starts.
- The Planner does not depend on final DSL syntax — it receives a `NormalizedWorkflowDefinition` schema class.
- The Planner does not own any runtime behavior (no dispatch, no execution, no state mutation).
- The plan is embedded in runtime state at run creation and accessed by the Orchestrator for readiness evaluation and dispatch.
- The plan preserves source metadata, secret references (unresolved), policies, conditions, inputs/outputs, artifacts, reports, and log expectations.

### Claims to avoid

- Do not claim that the Planner produces rich "diagnostics" — the diagnostic infrastructure exists but is always empty.
- Do not claim that `PlanningFailed` is a meaningful error path — it is declared but never used.
- Do not claim that the Planner "canonicalizes" meaningfully beyond sorting — there is no structural normalization.
- Do not claim plan persistence or plan versioning exists — plans are ephemeral objects embedded in run state.
- Do not claim the Planner accumulates errors — validation fails on the first violation.

### Suggested figures/tables/screenshots

- **Flow diagram**: DSL materializer → Planner → ExecutionPlan → Orchestrator (with validation gates).
- **Validation table**: Table of all checks performed by `validateDefinition()` with line references.
- **ExecutionPlan schema**: Visual breakdown of the `ExecutionPlan` → `PlanUnit` → `PlanDependency` structure.
- **Cycle detection**: Short annotated code block showing DFS approach.
- **Test coverage**: Table of test case names and what they cover.

### Suggested appendix material

- Full `NormalizedWorkflowDefinition` schema definition.
- Full `ExecutionPlan` schema definition.
- Full planner test suite output.
- Comparison table of Planner vs DslMaterializer validation boundaries.

## 12. Open questions for report writer

- Should the report note that `PlanningFailed` is dead code, or just describe `PlanningDiagnostic` as not-populated?
- The report writer may want to interview whether the empty `PlanningDiagnostic` arrays are intentional (future use) or accidental.
- The hardcoded `schemaVersion: "0.1.0"` — is versioning expected to evolve or is this a stable prototype constant?
- The cycle detection uses recursion — should depth limits be documented as a known risk?

# Context Report: Orchestrator, Run Lifecycle, Scheduler, and Admission Control

## 1. Scope

- Owned area:
- Explicit exclusions:
- Related areas / handoff edges:

## 2. Implementation status

| Capability / responsibility               |      Status | Evidence                                                                                                           | Notes                                                                                                                        |
| ----------------------------------------- | ----------: | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Run creation from plan                    | IMPLEMENTED | `src/engine/orchestrator.ts:216` `createRun`                                                                       | Creates initial queued run via `createInitialRun`, persists atomically                                                       |
| Run state machine                         | IMPLEMENTED | `src/domain/runtime-state.ts:12` `WorkflowRunStatus`                                                               | 8 states: queued, running, succeeded, failed, timed_out, canceling, canceled, interrupted                                    |
| Unit state machine                        | IMPLEMENTED | `src/domain/runtime-state.ts:24` `ExecutionUnitStatus`                                                             | 10 states: pending, ready, running, succeeded, failed, timed_out, skipped, canceling, canceled, interrupted                  |
| Attempt model                             | IMPLEMENTED | `src/domain/runtime-state.ts:38` `AttemptStatus`                                                                   | 7 states: created, running, succeeded, failed, timed_out, canceled, interrupted                                              |
| DAG readiness / dependency satisfaction   | IMPLEMENTED | `src/engine/orchestrator.ts:1495` `getReadyUnitIds`, `:1620` `decidePendingUnit`                                   | Evaluates dependency graph, conditions, upstream status conditions                                                           |
| Executor dispatch                         | IMPLEMENTED | `src/engine/orchestrator.ts:288` `executeReadyUnit`                                                                | Builds dispatch request, resolves secrets, calls Executor.execute                                                            |
| Executor result application               | IMPLEMENTED | `src/engine/orchestrator.ts:391-565`                                                                               | Maps outcome -> succeeded/failed/timed_out unit+attempt states                                                               |
| Retry with backoff                        | IMPLEMENTED | `src/engine/orchestrator.ts:1532-1590`                                                                             | `PlanRetryPolicy`, exponential backoff, jitter (none/full/half), max cap, scheduled retry via `activateScheduledRetry`       |
| Cancellation (best-effort + fail-fast)    | IMPLEMENTED | `src/engine/orchestrator.ts:794-834`                                                                               | `cancelRun` sets `canceling` (best-effort) or directly `canceled` (fail-fast); `finalizeCancellationState` does the work     |
| Resume/recovery after restart             | IMPLEMENTED | `src/engine/orchestrator.ts:836-879`                                                                               | `recoverIncompleteRuns` transitions running->interrupted, canceling->canceled; `resumeIncompleteRuns` re-enters advance loop |
| Scheduler (queued -> running)             | IMPLEMENTED | `src/engine/run-controller.ts:67-116`                                                                              | `scheduleQueuedRuns` with re-entrancy guard, `scheduleOnce` does admission                                                   |
| Global concurrency limits                 | IMPLEMENTED | `src/engine/run-controller.ts:91`                                                                                  | `schedulerConfig.maxConcurrentRuns` enforced                                                                                 |
| Per-project concurrency limits            | IMPLEMENTED | `src/engine/run-controller.ts:107`                                                                                 | `schedulerConfig.maxConcurrentRunsPerProject` enforced                                                                       |
| Fairness (oldest first, per-project caps) | IMPLEMENTED | `src/engine/run-controller.ts:101-114`                                                                             | Queued runs ordered by `createdAt`, scan in order, skip projects at cap                                                      |
| Durable queue (survives restart)          | IMPLEMENTED | `src/engine/stores/state-store.ts:320-329` (PostgreSQL), `src/engine/run-controller.ts:171-185` `recoverOnStartup` | Queued runs stored in `workflow_runs` with status='queued'; scheduler re-admits on startup                                   |
| Subscription / run-update stream          | IMPLEMENTED | `src/engine/run-updates.ts`                                                                                        | `RunUpdates` service with in-memory `PubSub`; optional via `serviceOption`                                                   |
| Metrics integration                       |     PARTIAL | `src/engine/orchestrator.ts:104-110`                                                                               | Optional via `Effect.serviceOption(Metrics)`, increments `runs_total`, `units_total`, `runs_active`                          |
| Interrupted-unit restart policy           | IMPLEMENTED | `src/engine/orchestrator.ts:1391-1438` `recoverRun`                                                                | Running attempts -> interrupted; non-terminal units reset to pending; succeeded/failed/skipped/canceled preserved            |
| Run cancellation during active execution  | IMPLEMENTED | `src/engine/run-controller.ts:129-140`                                                                             | Calls `orchestrator.cancelRun`, then `Fiber.interrupt`, then `finalizeCancellation`                                          |
| `retryRun` operation                      | IMPLEMENTED | `src/engine/run-controller.ts:142-169`                                                                             | Creates a new run via `orchestrator.createRun` with `retriedFromRunId`, preserves inputValues/workspacePath                  |
| Dead code / unused function               |       FOUND | `src/engine/orchestrator.ts:1556` `createRetrySchedule`                                                            | Defined but never called; `computeRetryDelayMillis` inlines its own logic                                                    |
| `RunInterrupted` event                    |     DEFINED | `src/domain/events.ts:166`                                                                                         | Event class exists but not emitted anywhere in source                                                                        |

## 3. Main source locations

| Path                                  | Role in this area                                                                           | Important symbols / entrypoints                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/orchestrator.ts`          | Run lifecycle orchestration, DAG eval, dispatch, result application, cancellation, recovery | `Orchestrator` service, `startRun`, `createRun`, `advanceRun`, `cancelRun`, `finalizeCancellation`, `recoverIncompleteRuns`, `resumeIncompleteRuns`, `executeReadyUnit`, `advanceWithRun`, `finalizeTerminalRun`, `finalizeCancellationState`, `decidePendingUnit`, `getReadyUnitIds` |
| `src/engine/run-controller.ts`        | Scheduler, admission, retryRun, cancelRun (with fiber interrupt), startup recovery          | `RunController` service, `submitRun`, `cancelRun`, `retryRun`, `recoverOnStartup`, `ensureRunActive`, `scheduleQueuedRuns`, `scheduleOnce`                                                                                                                                            |
| `src/engine/run-updates.ts`           | In-memory pub/sub for run state change notifications                                        | `RunUpdates` service, `RunUpdate` schema, `publish`, `stream`                                                                                                                                                                                                                         |
| `src/engine/interface.ts`             | Engine facade composing Planner/Orchestrator/RunController                                  | `Engine` service, `startRun`, `submitRun`, `cancelRun`, `retryRun`, `listRuns`, `inspectRun`, `streamRuns`                                                                                                                                                                            |
| `src/domain/runtime-state.ts`         | All run/unit/attempt state schemas                                                          | `WorkflowRunStatus`, `ExecutionUnitStatus`, `AttemptStatus`, `WorkflowRunState`, `ExecutionUnitState`, `ExecutionAttemptState`                                                                                                                                                        |
| `src/domain/execution-plan.ts`        | Plan schemas used by orchestrator                                                           | `ExecutionPlan`, `PlanUnit`, `PlanDependency`, `PlanRetryPolicy`, `PlanTimeoutPolicy`, `PlanCancellationPolicy`                                                                                                                                                                       |
| `src/domain/events.ts`                | All milestone event types                                                                   | 23 event classes from `RunCreated` to `RunInterrupted`                                                                                                                                                                                                                                |
| `src/domain/errors.ts`                | Domain error types                                                                          | `RunNotFound`, `RunControlRejected`, `StoreUnavailable`, `WorkflowInputsInvalid`, `UnitNotFound`                                                                                                                                                                                      |
| `src/engine/stores/state-store.ts`    | Durable run state persistence                                                               | `StateStore`, `createRun`, `updateRun`, `getRun`, `listQueuedRuns`, `listActiveRuns`, `listIncompleteRuns`                                                                                                                                                                            |
| `src/engine/stores/event-log.ts`      | Append-only event persistence                                                               | `EventLog`, `append`, `readRunEvents`                                                                                                                                                                                                                                                 |
| `src/engine/stores/artifact-store.ts` | Artifact/log payload persistence                                                            | `ArtifactStore`, `registerArtifact`, `registerLog`                                                                                                                                                                                                                                    |
| `src/runtime/config.ts`               | Scheduler config                                                                            | `SchedulerConfig` (`maxConcurrentRuns`, `maxConcurrentRunsPerProject`)                                                                                                                                                                                                                |
| `tests/orchestrator.test.ts`          | Orchestrator + RunController + cancellation tests                                           | 23 test cases                                                                                                                                                                                                                                                                         |
| `tests/project-scheduler.test.ts`     | Scheduler admission + concurrency tests                                                     | 5 test cases                                                                                                                                                                                                                                                                          |
| `tests/engine-interface.test.ts`      | Engine-level lifecycle tests including cancel                                               | 12 test cases                                                                                                                                                                                                                                                                         |

## 4. Actual responsibilities found in code

- Create workflow runs from execution plans, initializing all unit states as `pending` and run status as `queued`
- Evaluate DAG readiness: dependency satisfaction, runtime conditions (trigger event/branch/ref/tag, workflow input equals, upstream status), skip decisions
- Dispatch ready units to Executor: build `DispatchRequest` with resolved secrets, inputs, env, workspace, policies; handle secret/input resolution failures as synthetic executor failures
- Receive `ExecutorResult` and transition unit+attempt state: succeed, fail with retry scheduling, fail terminal, time out
- Finalize terminal runs: determine overall outcome (succeeded/failed/timed_out), persist, emit events
- Schedule delayed retries: sleep until `nextRetryAt`, activate unit back to `pending`
- Cancel runs: best-effort (set `canceling`, fiber can be interrupted) or fail-fast (immediate `canceled`), record `AttemptCanceled`/`UnitCanceled` events
- Recover after restart: read incomplete runs from StateStore, transition running attempts to `interrupted`, non-terminal units back to `pending`, canceling runs to `canceled`, then re-enter advance loop
- Retry a completed/failed/canceled run: create a new run from the same plan preserving inputs, linked via `retriedFromRunId`
- Schedule queued runs with admission control: oldest-first, global max + per-project max, re-entrancy guard, survives restart
- Track event sequences per run (in-memory, lazily loaded from EventLog)
- Register logs, artifacts, and reports through ArtifactStore
- Publish run state updates through optional `RunUpdates` pub/sub for SSE/dashboard

## 5. Core data structures, types, services, and APIs

| Name                    | Kind              | Location                          | Purpose                                                                  | Upstream / downstream connections                                                             |
| ----------------------- | ----------------- | --------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `Orchestrator`          | Service (Context) | `src/engine/orchestrator.ts:70`   | Run lifecycle, readiness, dispatch, result application, cancel, recovery | Consumes `StateStore`/`EventLog`/`ArtifactStore`/`Executor`/`SecretStore`/`StorageTransactor` |
| `RunController`         | Service (Context) | `src/engine/run-controller.ts:12` | Submit + schedule + admission + retry + cancel-with-interrupt            | Consumes `Orchestrator`/`StateStore`/`SchedulerConfig`                                        |
| `WorkflowRunState`      | Schema class      | `src/domain/runtime-state.ts:116` | Complete run state persisted in StateStore                               | References `ExecutionPlan`, holds `ExecutionUnitState[]`                                      |
| `ExecutionUnitState`    | Schema class      | `src/domain/runtime-state.ts:96`  | State for one execution unit                                             | Contains `ExecutionAttemptState[]`, references outputs/artifacts/logs                         |
| `ExecutionAttemptState` | Schema class      | `src/domain/runtime-state.ts:79`  | State for one dispatch attempt                                           | Tracks outcome, failure, resolved inputs, artifacts, logs                                     |
| `DispatchRequest`       | Schema class      | `src/engine/executor.ts:27`       | What the Orchestrator sends to Executor                                  | Contains resolved env, workspace, inputs, policies, correlation                               |
| `ExecutorResult`        | Schema class      | `src/engine/executor.ts:53`       | What Executor returns to Orchestrator                                    | Contains outcome, logs, artifacts, outputs, failure, timing                                   |
| `SchedulerConfig`       | Service (Context) | `src/runtime/config.ts:171`       | Concurrency limits                                                       | `MAX_CONCURRENT_RUNS` (default 1), `MAX_CONCURRENT_RUNS_PER_PROJECT` (default 1)              |
| `RunUpdates`            | Service (Context) | `src/engine/run-updates.ts:15`    | In-memory pub/sub for run state changes                                  | Optional; Engine.streamRuns/streamRun consume it                                              |

## 6. Main runtime flows

### Flow A: Create + Advance Run (direct)

1. `Engine.startRun(plan, options)` -> `Orchestrator.startRun(plan, options)` -> `Orchestrator.createRun(plan, options)` creates a `WorkflowRunState` with status `queued`, persists via `StateStore.createRun`, appends `RunCreated` event
2. `Orchestrator.activateRun(run)` transitions status from `queued` to `running`, persists, appends `RunStarted`
3. `Orchestrator.advanceWithRun(run)` loops: checks for `canceling`, calls `evaluatePendingUnits` (skip decision), checks `allUnitsTerminal`, calls `getReadyUnitIds` -> `decidePendingUnit`, dispatches with `executeReadyUnit`
4. `executeReadyUnit`: sets unit `ready`, creates `AttemptStarted`, builds `DispatchRequest` (resolves secrets/inputs), calls `Executor.execute`, receives `ExecutorResult`
5. Maps result to unit/attempt state transitions (succeeded/failed/timed_out with retry logic), persists via `StateStore.updateRun`, appends events
6. When `allUnitsTerminal`, calls `finalizeTerminalRun` -> determines outcome, persists final state, appends `RunSucceeded`/`RunFailed`/`RunTimedOut`

Evidence:

- `src/engine/orchestrator.ts:776` `startRun` -> `createRun` -> `activateRun` -> `advanceWithRun`
- `src/engine/orchestrator.ts:245` `advanceWithRun` while-loop
- `src/engine/orchestrator.ts:288` `executeReadyUnit`
- `src/engine/orchestrator.ts:612` `finalizeTerminalRun`

### Flow B: Submit + Schedule (queued)

1. `Engine.submitRun(plan, options)` -> `RunController.submitRun(plan, options)` -> `Orchestrator.createRun(plan, options)` creates run as `queued`
2. `RunController.submitRun` calls `scheduleQueuedRuns()`
3. `scheduleQueuedRuns` has re-entrancy guard (`scheduling` flag, `scheduleRequested`), calls `scheduleOnce`
4. `scheduleOnce` reads `listQueuedRuns` and `listActiveRuns` from StateStore, computes available global slots, iterates queued runs in `createdAt` order
5. For each queued run, checks `availableGlobalSlots > 0` and per-project cap, calls `ensureRunActive(runId)` if admitted
6. `ensureRunActive` forks `Orchestrator.advanceRun(runId)` as a detached fiber, stores fiber in `activeRuns` map
7. `advanceRun` reads run from StateStore, activates it if queued (-> running), then calls `advanceWithRun`
8. When the fiber completes, it is removed from `activeRuns` and `scheduleQueuedRuns` is triggered again via `Effect.ensuring`

Evidence:

- `src/engine/run-controller.ts:118` `submitRun`
- `src/engine/run-controller.ts:67` `scheduleQueuedRuns`
- `src/engine/run-controller.ts:87` `scheduleOnce`
- `src/engine/run-controller.ts:37` `ensureRunActive`

### Flow C: Cancel Run

1. `RunController.cancelRun(runId, reason)` -> `Orchestrator.cancelRun(runId, reason)`
2. If plan has `PlanCancellationPolicy` with mode `fail-fast` -> immediately calls `finalizeCancellationState(run)` which sets all pending/running units to `canceled`, run status to `canceled`, persists, appends `AttemptCanceled`/`UnitCanceled`/`RunCanceled`
3. Otherwise (best-effort or no policy) -> sets run status to `canceling`, persists, appends `RunCancellationRequested`
4. `RunController.cancelRun` then checks if there's an active fiber; if not, calls `orchestrator.finalizeCancellation`; if there is, calls `Fiber.interrupt(active)` then `orchestrator.inspectRun`
5. On `Fiber.interrupt`, the `executeReadyUnit` function has `Effect.onInterrupt` which calls `finalizeCancellationState`

Evidence:

- `src/engine/orchestrator.ts:794` `cancelRun`
- `src/engine/orchestrator.ts:653` `finalizeCancellationState`
- `src/engine/orchestrator.ts:828` `finalizeCancellation`
- `src/engine/run-controller.ts:129` `cancelRun`

### Flow D: Recovery after restart

1. `RunController.recoverOnStartup()` -> `Orchestrator.recoverIncompleteRuns()`
2. `recoverIncompleteRuns` reads `StateStore.listIncompleteRuns()`
3. For queued runs: leaves as-is
4. For canceling runs: calls `finalizeCancellationState` to finalize as canceled
5. For running runs: calls `recoverRun(run, now)` which transitions running attempts to `interrupted`, non-terminal units back to `pending`
6. Persists recovered state, appends `RunResumed` event
7. `RunController.recoverOnStartup` then calls `ensureRunActive` for each recovered running run, then calls `scheduleQueuedRuns`

Evidence:

- `src/engine/orchestrator.ts:836` `recoverIncompleteRuns`
- `src/engine/orchestrator.ts:870` `resumeIncompleteRuns`
- `src/engine/orchestrator.ts:1391` `recoverRun`
- `src/engine/run-controller.ts:171` `recoverOnStartup`

## 7. User-visible behavior / report-relevant behavior

- CLI/API/UI/runtime behavior:
  - `submitRun` returns immediately with a `queued` run; scheduler later activates it
  - `startRun` blocks until the run reaches terminal state
  - `cancelRun` returns `canceling` state for best-effort runs, `canceled` for fail-fast runs
  - `retryRun` creates a new run with the same plan and inputs; rejects if current run is still active
  - `advanceRun` is idempotent for terminal runs; for queued runs it activates then advances
  - `inspectRun` returns current `WorkflowRunState` at any point
  - Recovery is automatic on startup (`recoverOnStartup`); queued runs remain queued; previously-running runs are resumed with running attempts set to `interrupted`
- Inputs accepted: `ExecutionPlan` + optional `RunStartOptions` (workspacePath, inputValues)
- Outputs produced: `WorkflowRunState` with status, units, progress, outputs, artifacts, logs, reports
- Errors/diagnostics surfaced: `RunNotFound`, `StoreUnavailable`, `WorkflowInputsInvalid`, `RunControlRejected` (retry of active run)

## 8. Dependencies and integrations

| Dependency / integration | Used for                            | Location                              | Notes                                                                     |
| ------------------------ | ----------------------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| `StateStore`             | Persist/read run/unit/attempt state | `src/engine/stores/state-store.ts`    | Memory + PostgreSQL implementations                                       |
| `EventLog`               | Append/read milestone events        | `src/engine/stores/event-log.ts`      | Memory + PostgreSQL implementations                                       |
| `ArtifactStore`          | Register artifacts, logs, reports   | `src/engine/stores/artifact-store.ts` | Memory + S3 implementations                                               |
| `Executor`               | Dispatch and execute units          | `src/engine/executor.ts`              | Test impl + `LocalContainerExecutor`                                      |
| `SecretStore`            | Resolve secrets for dispatch env    | `src/secrets/store.ts`                |                                                                           |
| `StorageTransactor`      | Atomic DB transactions              | `src/runtime/storage.ts`              | Memory (passthrough) + Postgres (SQL transaction)                         |
| `SchedulerConfig`        | Concurrency limits                  | `src/runtime/config.ts:171`           | Env-configurable `MAX_CONCURRENT_RUNS`, `MAX_CONCURRENT_RUNS_PER_PROJECT` |
| `RunUpdates` (optional)  | Real-time run state notifications   | `src/engine/run-updates.ts`           | In-memory PubSub, consumed by SSE endpoint                                |
| `Metrics` (optional)     | Prometheus counters/gauges          | `src/runtime/metrics.ts`              | Increments `runs_total`, `units_total`, `runs_active`                     |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                             | Actual code evidence                                                                                               | Classification                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Executor should not own workflow semantics                                              | IMPLEMENTED — Executor only runs isolated units and returns results                                                | IMPLEMENTED                     |
| State Store is operational source of truth                                              | IMPLEMENTED — Orchestrator reads/writes StateStore for all decisions                                               | IMPLEMENTED                     |
| Recovery resumes from current state, not event replay                                   | IMPLEMENTED — `recoverIncompleteRuns` reads StateStore directly                                                    | IMPLEMENTED                     |
| Orchestrator must not manage container lifecycle                                        | IMPLEMENTED — container mechanics all in `LocalContainerExecutor`                                                  | IMPLEMENTED                     |
| Scheduler lives inside RunController (per SDD)                                          | IMPLEMENTED — `RunController` has `scheduleQueuedRuns`                                                             | IMPLEMENTED                     |
| Queue state survives process restarts                                                   | IMPLEMENTED — queued runs in `workflow_runs` with status='queued'; `recoverOnStartup` re-admits                    | IMPLEMENTED                     |
| Global MAX_CONCURRENT_RUNS=1, per-project=1 defaults                                    | IMPLEMENTED — `SchedulerConfig.layer` defaults both to 1                                                           | IMPLEMENTED                     |
| Fair scheduling: oldest queued first, per-project caps                                  | IMPLEMENTED — `scheduleOnce` iterates `listQueuedRuns` (ordered by `createdAt`), checks per-project counts         | IMPLEMENTED                     |
| RunInterrupted event defined                                                            | IMPLEMENTED in event schema — class `RunInterrupted` exists in `src/domain/events.ts:166`                          | IMPLEMENTED (but never emitted) |
| (SDD 0001) Orchestrator should coordinate State Store, Event Log, Artifact Store writes | IMPLEMENTED — Orchestrator calls persistence in `storageTransactor.run` for atomicity across StateStore + EventLog | IMPLEMENTED                     |
| (ADR 0002) Artifact/log payloads not in current state                                   | IMPLEMENTED — only metadata/references in `WorkflowRunState`, payloads in ArtifactStore                            | IMPLEMENTED                     |
| (ADR 0001) Executor must not mutate authoritative runtime state                         | IMPLEMENTED — Executor only returns results                                                                        | IMPLEMENTED                     |
| (ADR 0001) Retry and cancellation should be implemented                                 | IMPLEMENTED — both fully implemented                                                                               | IMPLEMENTED                     |
| `RunInterrupted` event should be emitted on recovery                                    | NOT_EMITTED — `RunInterrupted` event class exists but recovery emits `RunResumed` instead                          | PARTIAL                         |

## 10. Limitations, shortcuts, and incomplete areas

- **`createRetrySchedule` (`src/engine/orchestrator.ts:1556`) is dead code**: defined using Effect `Schedule` but never called; `computeRetryDelayMillis` inlines its own arithmetic-based retry delay computation. This is unused implementation.
- **`RunInterrupted` event never emitted**: the event class exists in `src/domain/events.ts:166` but `Orchestrator.recoverIncompleteRuns` emits `RunResumed` instead. Either the event is unused or recovery should emit `RunInterrupted` for interrupted attempts.
- **In-memory event sequence tracking**: `eventSequences` Map in Orchestrator (`src/engine/orchestrator.ts:112`) is in-memory only. If the service restarts, sequence numbers are lazily reloaded from the EventLog, which is correct but could cause issues if events were appended concurrently during a crash.
- **No distributed worker support**: as designed — single-node only.
- **No runtime graph mutation**: as designed — static DAG only.
- **Metrics are optional**: `Effect.serviceOption(Metrics)` means metrics silently no-op if not provided.
- **`RunUpdates` (SSE pub/sub) is in-memory only**: uses `PubSub.unbounded`, no persistence or backpressure for long-lived streams.
- **No explicit `UnitCancellationPolicy` at unit level**: cancellation policy is per-plan-unit via `PlanCancellationPolicy`, but the only check is `cancelRun` scanning all units for a fail-fast policy. There's no per-unit granular cancellation while running.
- **Container cancellation is via fiber interrupt only**: when a run is canceled while an executor is running, `Fiber.interrupt` triggers `Effect.onInterrupt` in `executeReadyUnit` which calls `finalizeCancellationState`. There's no explicit Docker container kill (e.g., `docker kill`) — the fiber interrupt will cancel the Effect but the Docker process may continue until the child process handle is cleaned up by scope disposal.

## 11. What the final coursework report should say

- Safe claims:
  - "The Orchestrator fully implements workflow-run lifecycle management including queuing, DAG readiness evaluation, dispatch, retry with exponential backoff and jitter, best-effort and fail-fast cancellation, and resume-based recovery after restart."
  - "A distinct RunController provides scheduler and admission control with configurable global and per-project concurrency limits and oldest-run-first fairness."
  - "The DAG execution engine evaluates dependency satisfaction, runtime conditions (trigger event/branch/ref/tag, workflow input equality, upstream status), and automatic unit skipping."
  - "Retry supports configurable maxAttempts, exponential backoff, half/full jitter, and max delay caps; retried units are scheduled via `Effect.sleep` and re-activated."
  - "Cancellation supports two modes: best-effort (sets `canceling` status, allows graceful fiber interrupt) and fail-fast (immediately transitions all pending/running units to `canceled`)."
  - "Recovery is resume-based, not replay-based: on restart, running attempts become `interrupted`, non-terminal units reset to `pending`, canceling runs finalize as `canceled`, and the orchestrator re-enters the advance loop."
  - "The orchestrator does not manage container lifecycle — it delegates all execution to the Executor and receives normalized results."
  - "Queue state is durable (stored in Postgres `workflow_runs`), survives process restarts, and is re-admitted by the scheduler on startup."
  - "All state mutations are coordinated through atomic transactions across StateStore and EventLog."
  - "22 milestone event types are defined and emitted for timeline inspection."
- Claims to avoid:
  - Do not claim distributed scheduling — it is explicitly single-node.
  - Do not claim runtime DAG mutation — graphs are static.
  - Do not claim durable execution (replay-based) — recovery is resume-based.
  - Do not claim multi-node worker pools or remote dispatch.
  - Do not claim `RunInterrupted` is emitted — it exists in schema but is not emitted anywhere.
- Suggested figures/tables/screenshots:
  - State machine diagrams for `WorkflowRunStatus`, `ExecutionUnitStatus`, `AttemptStatus` (all clearly defined in `src/domain/runtime-state.ts`)
  - Sequence diagram of one execution-unit lifecycle (pending -> ready -> running -> succeeded/failed/timed_out with retry loop)
  - Architecture diagram showing Orchestrator -> Executor boundary and Orchestrator writing StateStore + EventLog + ArtifactStore
  - Table of all 22 event types with when each is emitted
  - Retry flow diagram showing the `failed` -> `RetryScheduled` -> `Effect.sleep` -> `activateScheduledRetry` -> `pending` loop
  - Cancellation flow for best-effort vs fail-fast modes
  - Recovery flow: restart -> `listIncompleteRuns` -> running attempts become `interrupted` -> `RunResumed` -> re-enter advance loop
  - Scheduler admission decision tree: listQueuedRuns -> global slots check -> per-project cap check -> `ensureRunActive`
- Suggested appendix material:
  - Full source listing of `WorkflowRunStatus`/`ExecutionUnitStatus`/`AttemptStatus` literal definitions
  - Event log event class definitions with fields
  - Test cases demonstrating retry, cancellation, skip-conditions, resume, and scheduled retry after restart

## 12. Open questions for report writer

1. Should `createRetrySchedule` (dead code) be noted as a refactoring opportunity in the coursework report, or is it acceptable dead code for a prototype?
2. `RunInterrupted` event exists in the schema but is never emitted — is this intentional (reserved for future use) or an oversight? The report should note this.
3. The `RunUpdates` pub/sub is entirely in-memory — is this sufficient for the prototype scope or should it be noted as a limitation?
4. Container cancellation relies on Effect fiber interrupt rather than explicit Docker container kill — is this detail relevant for the report's evaluation of cancellation completeness?
5. Are the default concurrency limits (1 global, 1 per-project) sufficiently conservative for a single-node self-hosted deployment, or should the report recommend higher defaults?

# Context Report: Executor, Container Execution, Workspace Preparation, and Result Capture

## 1. Scope

- **Owned area:** Single-unit isolated execution, workspace mounting, env injection, log/output/artifact capture, normalized result production
- **Explicit exclusions:** Graph interpretation, dependency evaluation, retry/cancellation policy decisions, final workflow outcome, state mutation, artifact store internals except registration handoff
- **Related areas / handoff edges:** Orchestrator (dispatch → result), ArtifactStore (log/artifact registration after result), Planner (produces `PayloadDescriptor` consumed by executor)

## 2. Implementation status

| Capability / responsibility                         |               Status | Evidence                                   | Notes                                                                                                                   |
| --------------------------------------------------- | -------------------: | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------ | --------- | -------- | ------------ |
| Executor service boundary (single `execute` method) |          IMPLEMENTED | `src/engine/executor.ts:89-94`             | `Executor extends Context.Service` with `execute: (request: DispatchRequest) => Effect<ExecutorResult, ExecutorFailed>` |
| Concrete executor implementation                    |          IMPLEMENTED | `src/engine/executor.ts:133-168`           | `LocalContainerExecutor` — Docker-based                                                                                 |
| Container execution default                         |          IMPLEMENTED | `src/engine/executor.ts:173`               | Spawns `docker run --rm ...` via `ChildProcess.make("docker", ...)`                                                     |
| Host execution support                              | DOCUMENTED_NOT_FOUND | —                                          | No host-mode executor; only `LocalContainerExecutor` exists                                                             |
| Abstract/generic execution framework                | DOCUMENTED_NOT_FOUND | —                                          | `PayloadDescriptor` is single-variant union `ContainerCommandDescriptor` only                                           |
| Workspace volume mounting                           |          IMPLEMENTED | `src/engine/executor.ts:220-240`           | `--volume hostPath:mountPath` bind mount in `dockerArgs()`                                                              |
| Workspace path validation                           |          IMPLEMENTED | `src/engine/executor.ts:658-672`           | `resolveWorkspaceHostPath` prevents path-escape                                                                         |
| Working directory resolution                        |          IMPLEMENTED | `src/engine/executor.ts:591-612`           | Relative to workspace mount if workspace present                                                                        |
| Env variable injection                              |          IMPLEMENTED | `src/engine/executor.ts:562-575`           | `augmentEnvWithInputs` adds `EFFECT_CICD_INPUTS_JSON` + per-input vars                                                  |
| Secret env masking                                  |              PARTIAL | `src/engine/orchestrator.ts:1125-1156`     | Secret redaction done in orchestrator's `registerLogs`, not in executor                                                 |
| Log capture (stdout/stderr)                         |          IMPLEMENTED | `src/engine/executor.ts:245-269`           | Full string capture via `Stream.decodeText + Stream.mkString`                                                           |
| Stdout/stderr separation                            |          IMPLEMENTED | `src/engine/executor.ts:245-253`           | Separate `RegisteredLog` entries per stream                                                                             |
| Output collection from workspace                    |          IMPLEMENTED | `src/engine/executor.ts:349-403`           | Text/JSON parsing, 64KB size limit                                                                                      |
| Artifact collection from workspace                  |          IMPLEMENTED | `src/engine/executor.ts:271-347`           | Reads via `Bun.file`, base64 in result, missing-artifact recording                                                      |
| Report collection from workspace                    |          IMPLEMENTED | `src/engine/executor.ts:419-509`           | Similar pattern to artifacts                                                                                            |
| Normalized executor result type                     |          IMPLEMENTED | `src/engine/executor.ts:53-68`             | `ExecutorResult` with outcome, exitCode, failure, outputs, reports, artifacts, logs, timestamps, diagnostics            |
| Executor outcome classification                     |          IMPLEMENTED | `src/engine/executor.ts:50-51`             | `ExecutorOutcome`: `succeeded                                                                                           | failed | timed_out | canceled | interrupted` |
| Exit code capture                                   |          IMPLEMENTED | `src/engine/executor.ts:177-181`           | `handle.exitCode` cast to number                                                                                        |
| Failure summary                                     |          IMPLEMENTED | `src/engine/executor.ts:45-48, 614-626`    | `ExecutorFailureSummary` with message + optional code                                                                   |
| Timing metadata                                     |          IMPLEMENTED | `src/engine/executor.ts:171, 180, 214-215` | `startedAt`/`finishedAt` via `Clock.currentTimeMillis`                                                                  |
| Timeout within executor                             |                 STUB | `src/engine/executor.ts:177-179`           | No timeout mechanism inside executor; orchestrator wraps with `Effect.timeout` at `src/engine/orchestrator.ts:989-1022` |
| Cancellation within executor                        |                 STUB | `src/engine/executor.ts:179`               | `Effect.onInterrupt(() => handle.kill())` only — passive, no active cancel signal                                       |
| Canceled/interrupted outcome production             |              PARTIAL | `src/engine/executor.ts:196-217`           | Docker executor only produces `succeeded` or `failed`; other outcomes come from test layer or orchestrator              |
| Docker infra failure detection                      |          IMPLEMENTED | `src/engine/executor.ts:633-646`           | Exit 125 + docker daemon unreachable regex patterns                                                                     |
| Executor tests (mock layer)                         |          IMPLEMENTED | `tests/executor.test.ts:20-43, 300-328`    | `Executor.testLayer` with configurable results                                                                          |
| Executor tests (docker lifecycle)                   |          IMPLEMENTED | `tests/executor.test.ts:45-248`            | Mocked ChildProcessSpawner for env, exit code, artifact tests                                                           |
| Executor tests (real docker)                        |              PARTIAL | `tests/executor.test.ts:226-248`           | Guarded by `dockerIntegrationEnabled`; disabled by default                                                              |

## 3. Main source locations

| Path                                | Role in this area                   | Important symbols / entrypoints                                                                                                                                                                                                                               |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/executor.ts`            | Executor service + Docker impl      | `Executor`, `LocalContainerExecutor`, `DispatchRequest`, `ExecutorResult`, `ExecutorFailureSummary`, `ExecutorOutcome`, `executeDockerRequest`, `dockerArgs`, `collectArtifacts`, `collectOutputs`, `collectReports`, `buildLogs`, `resolveWorkspaceHostPath` |
| `src/engine/orchestrator.ts`        | Consumer of executor results        | `executeDispatch` (timeout wrapping), `buildDispatchRequest`, `executorFailureResult`, `secretResolutionFailureResult`, `inputResolutionFailureResult`                                                                                                        |
| `src/domain/execution-plan.ts`      | Payload type consumed by executor   | `ContainerCommandDescriptor`, `PayloadDescriptor`, `PlanPolicy`                                                                                                                                                                                               |
| `src/domain/errors.ts`              | Error type returned by executor     | `ExecutorFailed` (tagged error)                                                                                                                                                                                                                               |
| `src/domain/artifacts.ts`           | Log/artifact types returned         | `RegisteredLog`, `RegisteredArtifact`, `ArtifactMetadata`, `LogMetadata`                                                                                                                                                                                      |
| `src/domain/reports.ts`             | Report types returned               | `ProducedReport`, `ReportSummary`                                                                                                                                                                                                                             |
| `src/domain/runtime-state.ts`       | State types after result processing | `ExecutionAttemptState`, `ExecutionUnitState`, `FailureSummary`, `OutputValueSummary`                                                                                                                                                                         |
| `src/domain/workflow-definition.ts` | Declaration types consumed          | `ContainerCommandDeclaration`, `OutputDeclaration`, `ReportDeclaration`, `ArtifactDeclaration`                                                                                                                                                                |
| `src/runtime/layers.ts`             | Executor wiring                     | `LocalContainerExecutor.layer`, `Executor.testLayer` in `makeInMemoryEngineLayer`                                                                                                                                                                             |
| `tests/executor.test.ts`            | Executor tests                      | Test cases for mock layer, Docker env, artifacts, exit codes, infrastructure failures                                                                                                                                                                         |

## 4. Actual responsibilities found in code

- **Executor service** — single method `execute(DispatchRequest)` returning `Effect<ExecutorResult, ExecutorFailed>`
- **Workspace preparation** — validates host path, mounts via docker `--volume`, resolves working directory relative to mount
- **Container execution** — spawns `docker run --rm` with args: `--env`, `--volume`, `--workdir`, `<image>`, `<command...>`
- **Log capture** — reads stdout/stderr streams to full strings via `Stream.decodeText + Stream.mkString`, builds `RegisteredLog` entries with metadata
- **Output collection** — reads declared output files from workspace, parses text or JSON, enforces 64KB limit
- **Artifact collection** — reads declared artifact files from workspace, records as `RegisteredArtifact` with base64 payload, records missing status if file absent
- **Report collection** — reads declared report files from workspace, wraps as `ProducedReport` with nested `RegisteredArtifact`
- **Failure reporting** — exit code → `ExecutorOutcome`, stderr/stdout → `ExecutorFailureSummary`, docker infra failures (exit 125, daemon unreachable) → `ExecutorFailed` error
- **Path security** — path escape prevention in `resolveWorkspaceHostPath`
- **Input injection** — augments container env with `EFFECT_CICD_INPUTS_JSON` and per-input `EFFECT_CICD_INPUT_<NAME>` vars
- **Test layer** — `Executor.testLayer` returns configurable `ExecutorResult` per unitId, records dispatched requests for assertions

## 5. Core data structures, types, services, and APIs

| Name                         | Kind            | Location                             | Purpose                                                                                                                   | Upstream / downstream connections                           |
| ---------------------------- | --------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------- | ------------------------------------------------------ | ------------ | ---------------------------- |
| `DispatchRequest`            | Schema class    | `src/engine/executor.ts:27-43`       | Full dispatch payload: IDs, payloadDescriptor, env, workspace, inputs, outputs, reports, artifacts, policies, correlation | Produced by Orchestrator's `buildDispatchRequest`           |
| `ExecutorResult`             | Schema class    | `src/engine/executor.ts:53-68`       | Normalized execution result: outcome, exitCode, failure, outputs, reports, artifacts, logs, timestamps, diagnostics       | Consumed by Orchestrator's `executeDispatch` / `advanceRun` |
| `ExecutorOutcome`            | Literal union   | `src/engine/executor.ts:50-51`       | `succeeded                                                                                                                | failed                                                      | timed_out               | canceled                                               | interrupted` | Used in result outcome field |
| `ExecutorFailureSummary`     | Schema class    | `src/engine/executor.ts:45-48`       | Failure message + optional code                                                                                           | Converted to `FailureSummary` by orchestrator               |
| `ExecutorFailed`             | TaggedError     | `src/domain/errors.ts:74-79`         | Infrastructure failure error (not unit failure)                                                                           | Caught by orchestrator → `executorFailureResult`            |
| `Executor`                   | Context.Service | `src/engine/executor.ts:89-94`       | Service with single `execute` method                                                                                      | Wired as layer; consumed by `Orchestrator`                  |
| `LocalContainerExecutor`     | Static class    | `src/engine/executor.ts:133-168`     | Docker-based executor layer                                                                                               | `LocalContainerExecutor.layer` provides `Executor`          |
| `DispatchWorkspace`          | Schema class    | `src/engine/executor.ts:22-25`       | `hostPath` + `mountPath` for volume bind                                                                                  | Created by `buildDispatchRequest`                           |
| `DispatchInput`              | Schema class    | `src/engine/executor.ts:17-20`       | `name` + `value` for resolved inputs                                                                                      | Created by `resolveUnitInputs`                              |
| `ContainerCommandDescriptor` | Schema class    | `src/domain/execution-plan.ts:28-36` | `image`, `command`, `env`, `workingDirectory`                                                                             | Single variant of `PayloadDescriptor`                       |
| `RegisteredLog`              | Schema class    | `src/domain/artifacts.ts:47-50`      | `LogMetadata` + string `content`                                                                                          | Returned in `ExecutorResult.logs`                           |
| `RegisteredArtifact`         | Schema class    | `src/domain/artifacts.ts:41-45`      | `ArtifactMetadata` + optional `payloadBase64` + `contentType`                                                             | Returned in `ExecutorResult.artifacts`                      |
| `ProducedReport`             | Schema class    | `src/domain/reports.ts:16-23`        | Report metadata + nested `RegisteredArtifact`                                                                             | Returned in `ExecutorResult.reports`                        |
| `PlanPolicy`                 | Schema union    | `src/domain/execution-plan.ts:63-64` | `PlanRetryPolicy                                                                                                          | PlanTimeoutPolicy                                           | PlanCancellationPolicy` | Passed through to executor for orchestration-layer use |

## 6. Main runtime flows

### Flow A: Unit execution via LocalContainerExecutor

1. Orchestrator calls `buildDispatchRequest` → resolves secrets, resolves unit inputs, creates `DispatchRequest` with workspace `hostPath`/`mountPath`
2. Orchestrator calls `executeDispatch` → wraps executor call with `Effect.timeout` if `PlanTimeoutPolicy` is set
3. Executor's `LocalContainerExecutor.execute` checks workspace requirement (outputs/reports need workspace), delegates to `executeDockerRequest`
4. `executeDockerRequest`: records `startedAt`, augments env with input vars, spawns `docker run --rm --env... --volume... --workdir... <image> <command>`
5. Reads stdout + stderr + exitCode concurrently; on interrupt kills child process
6. Checks for docker infrastructure failure (exit 125, daemon unreachable patterns) → returns `ExecutorFailed` error
7. On normal exit: exit code 0 → collects outputs, reports, artifacts from workspace; builds logs; returns `ExecutorResult` with `outcome: "succeeded"`
8. Non-zero exit → builds failure summary with `outcome: "failed"`, `code: "exit:<N>"`, diagnostics text

**Evidence:**

- `src/engine/executor.ts:170-218` — `executeDockerRequest` main flow
- `src/engine/executor.ts:220-240` — `dockerArgs` construction
- `src/engine/executor.ts:562-575` — env augmentation
- `src/engine/orchestrator.ts:989-1022` — timeout wrapping

### Flow B: Test executor (deterministic mock)

1. `Executor.testLayer` creates a mock `execute` function
2. Reads `resultsByUnitId[request.unitId]` config, or falls back to default `"succeeded"` with exit 0
3. Returns pre-configured `ExecutorResult` with optional custom `execute` function
4. Records dispatch requests in `options.requests` array for test assertions

**Evidence:**

- `src/engine/executor.ts:95-131` — `Executor.testLayer`
- `tests/executor.test.ts:20-248` — 6 test cases exercising both mock and docker flows

## 7. User-visible behavior / report-relevant behavior

- **CLI/API/UI/runtime behavior:** Executor is fully internal; no direct user access
- **Inputs accepted:** `DispatchRequest` containing IDs, container image+command, resolved env, workspace paths, declared inputs/outputs/reports/artifacts, policies, correlation map
- **Outputs produced:** `ExecutorResult` with outcome, exitCode, failure, outputs dict, reports list, artifacts list (base64 payloads), logs (full content), timestamps, diagnostics
- **Errors/diagnostics surfaced:** `ExecutorFailed` (infrastructure errors), failure summary in result (unit errors), diagnostics array, docker infra failure patterns (exit 125, `cannot connect to docker daemon`)

## 8. Dependencies and integrations

| Dependency / integration                                   | Used for                                            | Location                               | Notes                                |
| ---------------------------------------------------------- | --------------------------------------------------- | -------------------------------------- | ------------------------------------ |
| `effect/unstable/process/ChildProcess`                     | Spawning `docker` CLI                               | `src/engine/executor.ts:3-4`           | Effect-managed child process         |
| `effect/unstable/process/ChildProcessSpawner`              | Child process spawning abstraction                  | `src/engine/executor.ts:4, 137`        | Injected as service                  |
| Docker CLI (`docker run --rm`)                             | Container execution                                 | `src/engine/executor.ts:173, 220-240`  | Single command `docker` with args    |
| `Bun.file`                                                 | Reading artifact/output/report files from workspace | `src/engine/executor.ts:283, 357, 431` | Used after container finishes        |
| `node:path`                                                | Path resolution & security                          | `src/engine/executor.ts:5, 658-672`    | `resolve()` for workspace paths      |
| `@effect/platform-node-shared` (`NodeChildProcessSpawner`) | Real docker child process in live tests             | `tests/executor.test.ts:1, 331-335`    | Production layer uses same mechanism |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                                           | Actual code evidence                                                                                 | Classification |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------- |
| Executor "runs execution units in isolated containerized environments"                                | `LocalContainerExecutor` runs `docker run --rm`                                                      | IMPLEMENTED    |
| Containerized execution is the default substrate                                                      | Only substrate; `PayloadDescriptor` is single-variant union                                          | IMPLEMENTED    |
| Executor captures "execution-local failure information"                                               | Exit code → `ExecutorFailureSummary` with message + code                                             | IMPLEMENTED    |
| Executor captures "execution-local logs"                                                              | Full stdout/stderr string capture → `RegisteredLog`                                                  | IMPLEMENTED    |
| Executor "collects declared outputs"                                                                  | `collectOutputs` with text/JSON decoding, 64KB limit                                                 | IMPLEMENTED    |
| Executor "collects artifact metadata"                                                                 | `collectArtifacts` reads files → `RegisteredArtifact` with base64                                    | IMPLEMENTED    |
| Executor does not own graph interpretation                                                            | No graph logic in executor.ts                                                                        | IMPLEMENTED    |
| Executor does not mutate authoritative runtime state directly                                         | Returns result; state mutations happen in Orchestrator                                               | IMPLEMENTED    |
| Executor does not own retry policy                                                                    | No retry logic; policies passed through but not interpreted                                          | IMPLEMENTED    |
| Executor does not own cancellation policy except "carrying out execution-local cancellation requests" | `onInterrupt(() => handle.kill())` only; no active cancellation mechanism                            | PARTIAL        |
| Executor "provides enough result metadata for Orchestrator to apply workflow semantics"               | Complete result type with outcome, exitCode, failure, outputs, logs, artifacts, reports, timestamps  | IMPLEMENTED    |
| "Container-specific mechanics must remain inside Executor"                                            | All Docker args in `dockerArgs` inside executor.ts                                                   | IMPLEMENTED    |
| Executor supports timeout outcomes                                                                    | No timeout logic inside executor; `Effect.timeout` applied by orchestrator                           | DIFFERENT      |
| Executor supports canceled/interrupted outcomes                                                       | Docker executor only produces `succeeded`/`failed`                                                   | DIFFERENT      |
| "Artifact/log payloads through the Engine's artifact/log storage boundary"                            | Payloads embedded in `ExecutorResult` as base64; storage handoff occurs after result in orchestrator | DIFFERENT      |
| No host execution                                                                                     | No host-mode executor class exists                                                                   | IMPLEMENTED    |

## 10. Limitations, shortcuts, and incomplete areas

- **Only Docker container execution:** No abstract execution framework, no host execution, no other container runtimes (Podman, containerd). Adding a new runtime requires implementing the entire `Executor` service from scratch.
- **No execution-local timeout:** Timeout is applied by Orchestrator wrapping the executor call with `Effect.timeout`. The executor cannot self-terminate after timeout. The child process is not killed by timeout (only by fiber interruption).
- **No execution-local cancellation mechanism:** `onInterrupt(() => handle.kill())` only fires when the Effect fiber is externally interrupted. No active cancellation signal. `PlanCancellationPolicy` is passed through to executor but never read.
- **Limited outcome range from docker executor:** Only returns `"succeeded"` or `"failed"`. `"timed_out"`, `"canceled"`, `"interrupted"` outcomes are produced only by the orchestrator or test layer.
- **Artifact payloads embedded in result:** Artifacts are base64-encoded in `ExecutorResult` rather than streamed/handled off to ArtifactStore. The orchestrator then re-registers them. This limits payload size (memory pressure).
- **Log payloads embedded in result:** Full log strings in `ExecutorResult.logs[].content`. Same memory concern for large logs.
- **Secret masking done post-execution:** Redaction happens in orchestrator's `registerLogs`, not in executor. Secret values are present in raw executor output.
- **Bun.file dependency in executor:** `collectArtifacts`, `collectOutputs`, `collectReports` use `Bun.file`, a non-Node-API that ties the implementation to Bun runtime.
- **Embedded ChildProcess vs Bun.spawn:** Uses `effect/unstable/process/ChildProcess` rather than `Bun.spawnSync` (used only in test guard).
- **No output streaming:** All output (stdout/stderr) is buffered to full string before processing.
- **`dockerArgs` reconstructs env names but not secret values:** Uses `--env NAME` (passthrough from process env) instead of `--env NAME=VALUE`. This means env vars are inherited from the host process, which works in prototype but is fragile.
- **`isExecutorInfrastructureFailure` regex-only detection:** Only catches known daemon-unreachable patterns; other docker startup failures may not be detected.

## 11. What the final coursework report should say

- **Safe claims:** Executor is a clean single-method service. `LocalContainerExecutor` is the only implementation. It spawns `docker run --rm` and captures logs, outputs, artifacts, and failure info into a normalized `ExecutorResult`. Workspace path escape is prevented. Outputs are decoded as text or JSON with a 64KB limit.
- **Claims to avoid:** Don't claim the executor supports cancellation, timeout, or host execution. Don't claim artifacts are efficiently streamed. Don't claim the executor handles the full outcome range (only `succeeded`/`failed` produced internally).
- **Suggested figures/tables/screenshots:** Class diagram of `Executor`, `DispatchRequest`, `ExecutorResult` types; sequence diagram of Flow A from orchestrator dispatch through `executor.execute` → docker → result collection; table of `ExecutorResult` fields with descriptions.
- **Suggested appendix material:** Full `executor.ts` code listing; test output demonstrating workspace artifact collection; comparison of declared vs actual outcome production.

## 12. Open questions for report writer

- Should the `LocalContainerExecutor`'s env passthrough (`--env NAME` without value) be flagged as a dev-only shortcut or a security concern?
- Is the absence of output streaming a relevant limitation for the prototype's target scale?
- Does the `Bun.file` dependency matter for portability to Node.js-based self-hosted deployment?
- Should the report note that artifact payloads are carried in-memory through the `ExecutorResult` rather than being written to the ArtifactStore directly?

# Context Report: Runtime State, Event History, Artifacts, Logs, and Persistence

## 1. Scope

- **Owned area:** Durable storage for workflow runtime state, execution history (event log), artifact payloads, log payloads, and recovery metadata.
- **Explicit exclusions:** UI/API rendering of stored data; Orchestrator transition logic except which persistence APIs it calls; Executor internals except payload handoff.
- **Related areas / handoff edges:** Orchestrator (`src/engine/orchestrator.ts`) — reads/writes all three stores; Engine interface (`src/engine/interface.ts`) — exposes Engine-owned read capabilities; CLI/dashboard (`src/cli/`, `src/dashboard/`) — consume inspection data via Engine.

## 2. Implementation status

| Capability / responsibility                 |      Status | Evidence                                                                      | Notes                                                                                            |
| ------------------------------------------- | ----------: | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Workflow-run current state persistence      | IMPLEMENTED | `src/engine/stores/state-store.ts:11-27`                                      | Memory + Postgres layers; full `WorkflowRunState` stored as JSONB                                |
| Execution-unit current state persistence    | IMPLEMENTED | `src/engine/stores/state-store.ts:19-20`                                      | Embedded in `WorkflowRunState.units` array in state JSONB                                        |
| Execution-attempt current state persistence | IMPLEMENTED | `src/engine/stores/state-store.ts:20`                                         | Embedded in `ExecutionUnitState.attempts` array in state JSONB                                   |
| Append-only event log                       | IMPLEMENTED | `src/engine/stores/event-log.ts:11-17`                                        | Memory + Postgres; `sequence`-ordered; `_tag` typed events                                       |
| Artifact payload storage (S3)               | IMPLEMENTED | `src/engine/stores/artifact-store.ts:211-543`                                 | S3 `artifacts/` key prefix; `Bun.S3Client`                                                       |
| Log payload storage (S3)                    | IMPLEMENTED | `src/engine/stores/artifact-store.ts:211-543`                                 | S3 `logs/` key prefix; `Bun.S3Client`                                                            |
| Artifact metadata DB storage                | IMPLEMENTED | `src/engine/stores/artifact-store.ts:242-285`                                 | Postgres `artifact_metadata` table with S3 object key                                            |
| Log metadata DB storage                     | IMPLEMENTED | `src/engine/stores/artifact-store.ts:297-335`                                 | Postgres `log_metadata` table with S3 object key                                                 |
| Compact summaries in state vs full payloads |     PARTIAL | `src/domain/runtime-state.ts:112-136`                                         | State embeds full `ArtifactMetadata`/`LogMetadata` arrays (not just refs); payloads are separate |
| Transactional consistency across stores     | IMPLEMENTED | `src/runtime/storage.ts:27-41`                                                | `StorageTransactor` wraps in `sql.withTransaction`                                               |
| Resume-based recovery (no event replay)     | IMPLEMENTED | `src/engine/orchestrator.ts:836-868`                                          | `recoverIncompleteRuns` reads StateStore, marks running → interrupted                            |
| Retention / GC                              | IMPLEMENTED | `src/engine/stores/artifact-gc.ts`                                            | Expiration-based GC with configurable `retentionDays`; per-run GC                                |
| Migration framework                         | IMPLEMENTED | `src/runtime/storage.ts:194-464`                                              | `PgMigrator.fromRecord` with 10 named migrations                                                 |
| In-memory stores for tests                  | IMPLEMENTED | `StateStore.memoryLayer`, `EventLog.memoryLayer`, `ArtifactStore.memoryLayer` | Map-based implementations                                                                        |
| Secret storage                              | IMPLEMENTED | `src/secrets/store.ts` (referenced)                                           | Encrypted in `secrets` table                                                                     |

## 3. Main source locations

| Path                                  | Role in this area                                       | Important symbols / entrypoints                                                                                         |
| ------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/engine/stores/state-store.ts`    | Current runtime state persistence                       | `StateStore` — `createRun`, `updateRun`, `getRun`, `updateUnit`, `updateAttempt`, `listIncompleteRuns`                  |
| `src/engine/stores/event-log.ts`      | Append-only execution history                           | `EventLog` — `append`, `readRunEvents`                                                                                  |
| `src/engine/stores/artifact-store.ts` | Artifact + log payload storage and metadata             | `ArtifactStore` — `registerArtifact`, `registerLog`, `readArtifactPayload`, `readLogPayload`, `gcRunArtifacts`, `runGc` |
| `src/engine/stores/artifact-gc.ts`    | Background GC scheduling                                | `ArtifactGc` — `runOnce`, `runForRun`, `start`                                                                          |
| `src/domain/runtime-state.ts`         | State type definitions                                  | `WorkflowRunState`, `ExecutionUnitState`, `ExecutionAttemptState`                                                       |
| `src/domain/events.ts`                | Event type definitions (all 21 event types)             | `WorkflowEvent` union — `RunCreated`, `RunStarted`, `RunResumed`, `RunFailed`, etc.                                     |
| `src/domain/artifacts.ts`             | Artifact/log metadata types                             | `ArtifactMetadata`, `LogMetadata`, `RegisteredArtifact`, `RegisteredLog`                                                |
| `src/domain/ids.ts`                   | Branded ID types                                        | `RunId`, `UnitId`, `AttemptId`, `EventId`, `ArtifactRef`, `LogRef`                                                      |
| `src/runtime/storage.ts`              | SQL client, object storage, migrations                  | `StorageTransactor`, `ObjectStorageClient`, `sqlClientLayer`, `storageMigrationLayer`                                   |
| `src/runtime/storage-codecs.ts`       | JSON serialization/deserialization with legacy upgrades | `encodeWorkflowRunState`, `decodeWorkflowRunState`, `encodeWorkflowEvent`, etc.                                         |
| `src/runtime/config.ts`               | Storage configuration                                   | `PostgresConfig`, `ObjectStorageConfig`, `ArtifactLifecycleConfig`, `StorageRuntimeConfig`                              |
| `src/runtime/layers.ts`               | Store composition into service layers                   | `makeDurableStorageLayer`, `makeInMemoryEngineLayer`                                                                    |
| `src/engine/orchestrator.ts`          | Coordinates state/event/artifact writes                 | `Orchestrator` — `createRun`, `advanceRun`, `recoverIncompleteRuns`                                                     |
| `src/engine/run-controller.ts`        | Startup recovery orchestration                          | `RunController` — `recoverOnStartup`                                                                                    |
| `src/engine/interface.ts`             | Externally visible persistence operations               | `Engine` — `readRunEvents`, `readArtifactPayload`, `readLogPayload`, `gcRunArtifacts`                                   |
| `src/domain/errors.ts`                | Error types                                             | `StoreUnavailable`, `RunNotFound`, `UnitNotFound`                                                                       |
| `tests/storage.integration.test.ts`   | Integration tests for durable storage                   | Round-trip, recovery, end-to-end demo                                                                                   |
| `tests/orchestrator.test.ts`          | Orchestrator tests (use in-memory stores)               | Unit-level state/event verification                                                                                     |
| `tests/artifact-gc.test.ts`           | GC tests                                                | Retention-based and per-run GC                                                                                          |
| `compose.yml`                         | Infra definition                                        | Postgres 16 + MinIO                                                                                                     |

## 4. Actual responsibilities found in code

- Persist complete `WorkflowRunState` as a JSONB blob in the `workflow_runs` table, including full unit and attempt state trees.
- Append typed milestone events to the `workflow_events` table with sequence ordering and event JSON.
- Store artifact and log payloads in S3-compatible object storage (via `Bun.S3Client`), with metadata separately indexed in Postgres `artifact_metadata`/`log_metadata` tables.
- Coordinate state updates + event appends within a single Postgres transaction via `StorageTransactor`.
- Resume incomplete runs after restart by reading `WorkflowRunState` from the State Store, marking in-progress attempts as `interrupted`, resetting non-terminal units to `pending`, and appending a `RunResumed` event.
- Schedule configurable GC: global TTL-based (default 90 days) and per-run cleanup.
- Provide both in-memory (`Map`-based) and durable (Postgres + S3) implementations for all three stores, swappable via Effect Layers.

## 5. Core data structures, types, services, and APIs

| Name                      | Kind            | Location                                 | Purpose                                                                                         | Upstream / downstream connections                                                   |
| ------------------------- | --------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `WorkflowRunState`        | Schema class    | `src/domain/runtime-state.ts:116`        | Complete current state of a workflow run: status, units, progress, artifact/log metadata arrays | Serialized ↔ JSONB in `workflow_runs.state_json`; read by Orchestrator, Engine, CLI |
| `ExecutionUnitState`      | Schema class    | `src/domain/runtime-state.ts:96`         | Current state of one execution unit: status, attempts, artifact/log metadata arrays             | Nested inside `WorkflowRunState.units`                                              |
| `ExecutionAttemptState`   | Schema class    | `src/domain/runtime-state.ts:79`         | Current state of one attempt: status, resolvedInputs, outputs, artifact/log metadata arrays     | Nested inside `ExecutionUnitState.attempts`                                         |
| `WorkflowEvent`           | Tagged union    | `src/domain/events.ts:171`               | 21 event types with runId, sequence, occurredAt, eventId                                        | Serialized ↔ JSONB in `workflow_events.event_json`                                  |
| `ArtifactMetadata`        | Schema class    | `src/domain/artifacts.ts:10`             | Artifact ref, size, checksum, expiry, status (expected/available/missing/failed)                | Embedded in state AND in `artifact_metadata` table                                  |
| `LogMetadata`             | Schema class    | `src/domain/artifacts.ts:26`             | Log ref, size, checksum, expiry, status                                                         | Embedded in state AND in `log_metadata` table                                       |
| `StateStore`              | Context.Service | `src/engine/stores/state-store.ts:11`    | CRUD for `WorkflowRunState`; `listIncompleteRuns` for recovery                                  | Called by Orchestrator; backed by Map or Postgres                                   |
| `EventLog`                | Context.Service | `src/engine/stores/event-log.ts:11`      | `append` / `readRunEvents`                                                                      | Called by Orchestrator for milestone recording                                      |
| `ArtifactStore`           | Context.Service | `src/engine/stores/artifact-store.ts:13` | Register artifacts/logs; read payloads from S3; GC                                              | S3 for payloads, Postgres for metadata                                              |
| `StorageTransactor`       | Context.Service | `src/runtime/storage.ts:11`              | Wraps effects in `sql.withTransaction`                                                          | Used by Orchestrator for atomic multi-store writes                                  |
| `ObjectStorageClient`     | Context.Service | `src/runtime/storage.ts:45`              | S3-compatible read/write/delete via `Bun.S3Client`                                              | Used by ArtifactStore s3Layer                                                       |
| `ArtifactGc`              | Context.Service | `src/engine/stores/artifact-gc.ts:11`    | TTL-based and per-run cleanup                                                                   | Uses ArtifactStore; appends `ArtifactGcCompleted` event                             |
| `ArtifactLifecycleConfig` | Context.Service | `src/runtime/config.ts:111`              | `retentionDays` (90), `maxSizeMb`, `gcIntervalMinutes`                                          | Injected into ArtifactStore and ArtifactGc                                          |

## 6. Main runtime flows

### Flow A: Create Run + Persist Initial State

1. Orchestrator creates `WorkflowRunState` with `status: "queued"`, empty units, empty payload arrays.
2. Calls `stateStore.createRun(run)` to insert row into `workflow_runs`.
3. Calls `eventLog.append(event)` with `RunCreated`.
4. Steps 2-3 wrapped in `storageTransactor.run()` for transactional atomicity.

Evidence:

- `src/engine/orchestrator.ts:216-243` — `createRun` method
- `src/engine/orchestrator.ts:234-239` — transactional call of both state + event writes

### Flow B: Advance Run (state update + event append)

1. After Executor returns result, Orchestrator constructs new `ExecutionAttemptState` + `ExecutionUnitState` with outcome.
2. Calls `persistRun(run)` → `stateStore.updateRun(run)`.
3. Calls `eventLog.append(...)` with outcome events (e.g. `AttemptFailed`, `UnitSucceeded`, `RunFailed`).
4. Calls `artifactStore.registerLog(...)` and `artifactStore.registerArtifact(...)` for payloads (separate transactions, not S3 in transactor).
5. Steps 2-3 wrapped in `storageTransactor.run()`.

Evidence:

- `src/engine/orchestrator.ts:556-563` — failure flow: persistState + appendEvents inside transaction
- `src/engine/orchestrator.ts:391-430` — success flow
- `src/engine/orchestrator.ts:385-387` — artifact/log registration (outside transactor)

### Flow C: Resume / Recovery After Restart

1. `RunController.recoverOnStartup()` calls `Orchestrator.recoverIncompleteRuns()`.
2. `recoverIncompleteRuns()` reads incomplete runs via `stateStore.listIncompleteRuns()`.
3. For each run: if `canceling` → finalize as canceled; if `queued` → keep queued.
4. For running units: mark running attempts as `interrupted`, reset non-terminal units to `pending`, set run status to `running`.
5. Persist recovered state + append `RunResumed` event (within transaction).
6. `RunController` re-activates recovered runs via fibers.

Evidence:

- `src/engine/orchestrator.ts:836-868` — `recoverIncompleteRuns`
- `src/engine/orchestrator.ts:1391-1438` — `recoverRun` pure function
- `src/engine/run-controller.ts:171-185` — `recoverOnStartup`
- `tests/storage.integration.test.ts:173-214` — integration test: seeds running state, calls resume, verifies `interrupted`

### Flow D: Artifact/Log Registration

1. Orchestrator receives `RegisteredLog`/`RegisteredArtifact` from Executor result.
2. Calls `artifactStore.registerLog(log)` or `artifactStore.registerArtifact(artifact)`.
3. ArtifactStore writes payload to S3 (if `payloadBase64` is present) then inserts/upserts metadata row in Postgres.
4. Returns persisted `ArtifactMetadata`/`LogMetadata`.
5. Orchestrator appends `ArtifactRegistered`/`LogRegistered` event.
6. Copies returned metadata into `WorkflowRunState` arrays for current state embedding.

Evidence:

- `src/engine/orchestrator.ts:709-747` — `registerLogs` and `registerArtifacts` helpers
- `src/engine/stores/artifact-store.ts:231-337` — S3 write + DB insert
- `src/engine/orchestrator.ts:385-387` — embed into run state

### Flow E: Artifact GC

1. `ArtifactGc.runOnce(now)` calls `artifactStore.runGc(now)`.
2. `runGc` selects rows from `artifact_metadata`/`log_metadata` where `expires_at < now`.
3. For each expired row: deletes S3 object, deletes metadata row.
4. Increments counters, appends `ArtifactGcCompleted` event.
5. Background loop runs at `gcIntervalMinutes` (default 60) intervals.

Evidence:

- `src/engine/stores/artifact-store.ts:491-527` — `runGc` (both memory and S3 layers)
- `src/engine/stores/artifact-gc.ts:51-55` — `start` background fiber
- `src/runtime/config.ts:111-129` — `ArtifactLifecycleConfig`

## 7. User-visible behavior / report-relevant behavior

- **CLI/API outputs:** Run state (`status`, `progress`), unit states, artifact/log metadata, event timeline — all composed by Engine from stores.
- **Inputs accepted:** Engine reads history via `engine.readRunEvents(runId)`, reads artifact payloads, reads log payloads.
- **Errors surfaced:** `StoreUnavailable` (any SQL error or S3 error), `RunNotFound`/`UnitNotFound` (missing data).
- **Recovery on startup:** Orchestrator resumes incomplete runs automatically; user sees interrupted runs become recoverable.
- **GC behavior:** Artifacts/logs older than `retentionDays` are silently deleted; per-run GC on run completion.
- **Hardcoded state-embedded arrays:** `WorkflowRunState` always contains `artifacts: Array(ArtifactMetadata)` and `logs: Array(LogMetadata)` — not optional.

## 8. Dependencies and integrations

| Dependency / integration                          | Used for                          | Location                         | Notes                              |
| ------------------------------------------------- | --------------------------------- | -------------------------------- | ---------------------------------- |
| `@effect/sql-pg` (PgClient)                       | Postgres queries and transactions | `src/runtime/storage.ts:1`       | Effect v4 beta                     |
| `Bun.S3Client` (built-in)                         | S3-compatible object storage      | `src/runtime/storage.ts:69-76`   | MinIO in dev, any S3 in production |
| `effect` (Effect, Layer, Schema, Context, Config) | Core framework                    | Throughout                       | Effect v4 beta                     |
| `PgMigrator` (from `@effect/sql-pg`)              | Schema migrations                 | `src/runtime/storage.ts:194-456` | Inline SQL in `fromRecord`         |
| Postgres 16                                       | SQL database                      | `compose.yml:27`                 | Local dev image                    |
| MinIO                                             | S3-compatible storage             | `compose.yml:43`                 | Local dev image                    |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                    | Actual code evidence                                                                                        | Classification          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------- |
| "Current runtime state stores compact summaries, not full artifact metadata"   | `WorkflowRunState.artifacts` is `Array(ArtifactMetadata)` — full metadata objects, not summaries            | DIFFERENT               |
| "Current runtime state stores compact summaries, not full attempt history"     | `ExecutionUnitState.attempts` is `Array(ExecutionAttemptState)` — full attempt history                      | DIFFERENT               |
| "Do not define exact schemas in ADR" (ADR guardrail)                           | Implementation uses a single JSONB column for the entire state tree — no normalized relational state schema | PARTIAL (within bounds) |
| "State Store does not store full log payloads"                                 | Log payloads are S3-only ✓; metadata is embedded in state                                                   | IMPLEMENTED             |
| "Recovery resumes from persisted current state, does not replay Event Log"     | `recoverIncompleteRuns` reads StateStore, appends `RunResumed` event                                        | IMPLEMENTED             |
| "Event log is not operational source of truth"                                 | Events are never read for recovery; only StateStore is used                                                 | IMPLEMENTED             |
| "Artifact Store returns stable references stored in State Store and Event Log" | `ArtifactRef`/`LogRef` branded strings used across all three; metadata duplicated in state                  | IMPLEMENTED             |
| "Interface surfaces must use Engine-owned reads"                               | `Engine` service wraps all store reads (e.g. `readRunEvents`, `readArtifactPayload`)                        | IMPLEMENTED             |
| "Prototype avoids hard-coding local-only assumptions"                          | Uses Postgres (URL config) + S3 (configurable endpoint); no local filesystem                                | IMPLEMENTED             |

## 10. Limitations, shortcuts, and incomplete areas

- **No normalized runtime state schema:** The entire `WorkflowRunState` is serialized into a single `state_json` JSONB column. This makes queries like "find all runs where unit X failed" impossible without loading and parsing the blob.
- **Artifact/log metadata is duplicated:** `ArtifactMetadata`/`LogMetadata` objects are stored BOTH in `workflow_runs.state_json` AND in `artifact_metadata`/`log_metadata` tables. The state-embedded copies grow unboundedly as events accumulate.
- **No event log cleanup/retention:** `workflow_events` table has no GC mechanism. Events accumulate indefinitely.
- **State blob grows without bound:** Since every unit attempt and artifact/log metadata record is appended to arrays within `state_json`, the blob grows monotonically. No compaction or trimming.
- **No explicit consistency model beyond per-operation transactions:** The Orchestrator wraps state+event in a single transactor call but artifact+log registration happens outside the transactor (separate S3 writes). If the App crashes between S3 write and state update, artifact metadata exists in S3 but is not referenced from state.
- **Event sequencing is client-side:** `eventSequences` is an in-memory `Map<RunId, number>` in the Orchestrator — lost on restart, re-initialized by reading the last event sequence from DB.
- **In-memory stores lack `.listIncompleteRuns` equivalent for `ArtifactStore`:** The `runGc` and `gcRunArtifacts` implementations exist in both layers, but the memory layer iterates maps linearly.
- **Recovery for `canceling` runs:** Simply finalizes as canceled with a generic reason — no attempt to check if in-flight subs could complete.
- **No interruption reason propagation:** `RunInterrupted` event has a `reason` string but `recoverRun` sets `reason: "Resumed from persisted runtime state after restart"` regardless of actual cause.
- **GC is fire-and-forget:** `runOnce` catches all errors and returns zeros on failure — no alerting, no retry, no max-age guarantee.
- **`project_id` was added retroactively:** Migration `0005` added `project_id` to `workflow_runs`, `github_bindings`, `github_run_links` after the fact — evidence of schema evolution.

## 11. What the final coursework report should say

### Safe claims

- Three-store architecture (State Store, Event Log, Artifact Store) is fully implemented with both in-memory (test) and durable (Postgres+S3) backends, swappable via Effect Layers.
- State Store is the operational source of truth: recovery reads StateStore, not Event Log.
- Event Log provides 21 typed milestone events for timeline inspection and audit.
- Artifact/log payloads are stored in S3; metadata is indexed in Postgres.
- Transactional consistency for state+event writes is provided by `StorageTransactor`.
- Retention GC is implemented (TTL-based and per-run) with configurable defaults.
- Resume-based recovery is implemented: running attempts become `interrupted`, non-terminal units reset to `pending`, then re-executed.
- The model uses Postgres 16 and S3-compatible storage (MinIO), avoiding local-only filesystem coupling.
- 10 database migrations exist covering schema evolution from initial tables through project queueing and artifact lifecycle.

### Claims to avoid

- Do NOT claim "lean current runtime state" — state embeds full attempt history and full artifact/log metadata arrays.
- Do NOT claim "strict separation of concerns" for metadata — the same `ArtifactMetadata`/`LogMetadata` objects appear in both state JSONB and indexed tables.
- Do NOT claim "eventual consistency model is well-defined" — only the state+event pair is transactional; S3 writes are not in the transaction.
- Do NOT claim "scalable storage" — the JSONB blob approach does not scale to thousands of units or long-running workflows with many events.

### Suggested figures/tables/screenshots

1. **Three-store architecture diagram:** State Store (Postgres JSONB), Event Log (Postgres rows), Artifact Store (S3 + Postgres metadata). Show arrows: Orchestrator writes all three; recovery reads only State Store.
2. **State JSONB structure table:** Show that `WorkflowRunState` nests → `ExecutionUnitState[]` → each with `ExecutionAttemptState[]`, `ArtifactMetadata[]`, `LogMetadata[]`.
3. **Transaction boundary diagram:** Show which writes are inside `sql.withTransaction()` (state+event) and which are outside (S3 artifact writes).
4. **Event type table:** List all 21 `WorkflowEvent` variants grouped by lifecycle phase (Run, Unit, Attempt, Artifact/Log, GC).
5. **Recovery flow sequence diagram:** Startup → `listIncompleteRuns` → for each: `recoverRun` (mark interrupted, reset pending) → persist + append `RunResumed` → re-activate fibers.
6. **Screenshot of `workflow_runs` table:** Show `state_json` as JSONB, indexed on `status` and `project_id`.

### Suggested appendix material

- Full migration DDL listing (migrations 0001-0010 from `src/runtime/storage.ts:196-455`).
- `PostgresConfig` and `ObjectStorageConfig` environment variable mappings.
- `ArtifactLifecycleConfig` defaults (90-day retention, 1024 MB max, 60-min GC interval).

## 12. Open questions for report writer

1. **State blob growth is the biggest architectural risk:** Should the report call out that the JSONB blob approach will not scale beyond small workflows, or is this accepted as a prototype shortcut? The SDD (line 553+) lists open questions including "What exact attempt-level history belongs in current state?" — this was never resolved.
2. **Is the artifact/log metadata duplication intentional or incidental?** Artifact metadata is stored in both state JSONB and `artifact_metadata` table. The report should explain whether this is a deliberate read-optimization or an implementation shortcut.
3. **No Event Log GC exists:** Is this an oversight or deferred? The ADR says Event Log is "not the operational source of truth" but does not say it's append-only forever.
4. **The `state_json` column stores JSON from `WorkflowRunState` but also has mirrored columns for `project_id`, `status`, `created_at` etc.** — the relational columns seem to be query indexes while the JSONB is the canonical payload. Should this be described as "hybrid relational+document storage"?
5. **`fromRecord` migrations are inline in `storage.ts`** — is this an acceptable approach for coursework discussion or should it be flagged as a maintenance concern (migrations mixed with runtime code)?

# Context Report: Engine Public Contract and Service/API Layer

## 1. Scope

- **Owned area:** Engine-facing control and inspection contract; HTTP/JSON API surface; DTOs/read models; error mapping; streaming updates
- **Explicit exclusions:** CLI formatting, dashboard component rendering, persistence internals (StateStore/EventLog/ArtifactStore), Planner/Orchestrator/Executor internal logic
- **Related areas / handoff edges:** CLI (`src/cli/index.ts`), dashboard handlers (`src/dashboard/handlers.ts`), GitHub integration (via `GitHubIntegration` service reference only), project management (via `LocalProjectStore`)

## 2. Implementation status

| Capability / responsibility   |               Status | Evidence                                           | Notes                                                                 |
| ----------------------------- | -------------------: | -------------------------------------------------- | --------------------------------------------------------------------- |
| Canonical Engine contract     |          IMPLEMENTED | `src/engine/interface.ts:22-47`                    | `Engine` class extending `Context.Service` with 22 methods            |
| Validate workflow             |          IMPLEMENTED | `src/engine/interface.ts:60`                       | Delegates to `planner.validate()`                                     |
| Plan workflow                 |          IMPLEMENTED | `src/engine/interface.ts:62`                       | Delegates to `planner.plan()`                                         |
| Start run (plan)              |          IMPLEMENTED | `src/engine/interface.ts:72-74`                    | `startRun(plan, options?)` → `orchestrator.startRun()`                |
| Start run (definition)        |          IMPLEMENTED | `src/engine/interface.ts:64-66`                    | `startDefinition(definition, options?)` plan+start                    |
| Submit run (plan)             |          IMPLEMENTED | `src/engine/interface.ts:76-78`                    | `submitRun` → `runController.submitRun`                               |
| Submit run (definition)       |          IMPLEMENTED | `src/engine/interface.ts:68-70`                    | `submitDefinition` → plan→submit                                      |
| Cancel run                    |          IMPLEMENTED | `src/engine/interface.ts:80`                       | `cancelRun(runId, reason?)` → `runController.cancelRun`               |
| Retry run                     |          IMPLEMENTED | `src/engine/interface.ts:82`                       | `retryRun(runId, reason?)` → `runController.retryRun`                 |
| List runs                     |          IMPLEMENTED | `src/engine/interface.ts:84-90`                    | `listRuns(projectId?)` filters in-memory from `stateStore.listRuns()` |
| Inspect run                   |          IMPLEMENTED | `src/engine/interface.ts:92`                       | `inspectRun(runId)` → `orchestrator.inspectRun()`                     |
| Stream all runs               |          IMPLEMENTED | `src/engine/interface.ts:94`                       | `streamRuns()` → PubSub-based SSE                                     |
| Stream single run             |          IMPLEMENTED | `src/engine/interface.ts:96-97`                    | `streamRun(runId)` → filtered PubSub                                  |
| Read run events               |          IMPLEMENTED | `src/engine/interface.ts:99`                       | `readRunEvents(runId)` → `eventLog.readRunEvents()`                   |
| Read artifacts                |          IMPLEMENTED | `src/engine/interface.ts:101-103`                  | `readArtifacts(runId)` reads from run state                           |
| Read artifact payload         |          IMPLEMENTED | `src/engine/interface.ts:105-107`                  | `readArtifactPayload(artifactRef)` → `artifactStore`                  |
| Delete artifact               |          IMPLEMENTED | `src/engine/interface.ts:109-119`                  | Marks run metadata "missing" + deletes payload                        |
| Read logs                     |          IMPLEMENTED | `src/engine/interface.ts:122-124`                  | `readLogs(runId)` reads from run state                                |
| Read log payload              |          IMPLEMENTED | `src/engine/interface.ts:126`                      | `readLogPayload(logRef)` → `artifactStore`                            |
| Delete log                    |          IMPLEMENTED | `src/engine/interface.ts:128-139`                  | Marks run metadata "missing" + deletes payload                        |
| GC run artifacts              |          IMPLEMENTED | `src/engine/interface.ts:141-146`                  | Runs `ArtifactGc` if available                                        |
| Version                       |          IMPLEMENTED | `src/engine/interface.ts:148`                      | Returns `appVersion`                                                  |
| Resume (control)              | DOCUMENTED_NOT_FOUND | Engine contract line 31: no resume method          | ADR 0003 lists resume; not in contract                                |
| Plan graph read               |              PARTIAL | `src/domain/execution-plan.ts:87-99`               | Plan returned from `plan()`; no read per run                          |
| Unit state deep read          |              PARTIAL | `inspectRun` returns `WorkflowRunState` with units | No separate per-unit query                                            |
| Project-aware filtering       |          IMPLEMENTED | `src/engine/interface.ts:84-90`                    | `listRuns(projectId?)` filters in code                                |
| Execution plan structure read | DOCUMENTED_NOT_FOUND | No Engine method for plan structure per run        | Plan is embedded in run state's `execution.plan`                      |
| Dashboard composite reads     |          IMPLEMENTED | `src/dashboard/handlers.ts:12-21`                  | `inspectRun` composes 4 Engine calls                                  |
| Auth in API                   |       NOT_APPLICABLE | No auth middleware                                 | Only GitHub webhook signature verification                            |
| HTTP server routes            |          IMPLEMENTED | `src/service/server.ts:186-325`                    | 32 route handlers                                                     |
| SSE streaming                 |          IMPLEMENTED | `src/service/server.ts:993-1018`                   | `text/event-stream` via `RunUpdate`                                   |
| Error mapping (HTTP)          |          IMPLEMENTED | `src/service/server.ts:1062-1089`                  | DomainError → HTTP status codes                                       |
| Run recovery on startup       |              PARTIAL | `src/service/server.ts:121-123`                    | Calls `runController.recoverOnStartup()` if configured                |
| Secrets management API        |          IMPLEMENTED | `src/service/server.ts:250-257`                    | CRUD via `/api/secrets` routes                                        |

## 3. Main source locations

| Path                              | Role in this area                    | Important symbols / entrypoints                                                                                                  |
| --------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/interface.ts`         | Canonical Engine contract            | `Engine` class (22-method facade), `Engine.layer`                                                                                |
| `src/service/server.ts`           | HTTP API server                      | `startServiceServer`, `serviceProgram`, 32 route handlers, `runJsonEffect`, `runStreamEffect`, `errorResponse`, `statusForError` |
| `src/service/client.ts`           | HTTP Engine client                   | `engineServiceClientLayer`, `gitHubIntegrationClientLayer`, `SecretsClient`, `openServiceEventStream`                            |
| `src/service/contracts.ts`        | Request/response DTOs                | `RunSubmissionRequest`, `WorkflowRunSubmissionRequest`, `ServiceErrorResponse`, `RunActionRequest`, `SecretSetRequest`           |
| `src/service/schema-json.ts`      | Schema encode/decode helpers         | `encodeJson`, `decodeJson`                                                                                                       |
| `src/dashboard/handlers.ts`       | In-process dashboard engine handlers | `createDashboardHandlers`, `DashboardEngine` interface                                                                           |
| `src/dashboard/proxy-handlers.ts` | Dashboard proxy to service           | `createDashboardProxyHandlers` — HTTP forwarding + DTO mapping                                                                   |
| `src/dashboard/reads.ts`          | Domain→DTO mapping functions         | `mapRunSummary`, `mapRunDetail`, `mapEvent`, `mapPayloadMetadata`, `deriveStages`, `mapRawRunSummary`, `mapRawRunDetail`         |
| `src/dashboard/types.ts`          | Presentation-specific DTOs           | `RunSummaryDto`, `RunDetailDto`, `RunUnitDto`, `PayloadMetadataDto`, `TimelineEventDto`                                          |
| `src/dashboard/api.ts`            | Frontend API client (DA)             | `createDashboardApi` — typesafe fetch-based client                                                                               |
| `src/dashboard/server.ts`         | Dashboard Bun.serve                  | `dashboardProgram`, route forwarding                                                                                             |
| `src/cli/index.ts`                | CLI commands; Engine consumer        | `cli`, `makeCliLayer` (in-process), `makeAppLayer` (HTTP client)                                                                 |
| `src/cli/local.ts`                | Local CLI entry                      | `localCliProgram`                                                                                                                |
| `src/runtime/layers.ts`           | Runtime composition layers           | `makeServiceEngineLayer`, `makeInMemoryEngineLayer`, `makeInMemoryServiceEngineLayer`                                            |
| `src/domain/errors.ts`            | Domain error types                   | `DomainError` union (20 error classes), each tagged                                                                              |
| `src/domain/runtime-state.ts`     | Run/unit/attempt state schemas       | `WorkflowRunState`, `ExecutionUnitState`, `ExecutionAttemptState`, `RunExecutionContext`                                         |
| `src/engine/run-updates.ts`       | Streaming update model               | `RunUpdate`, `RunUpdates` (PubSub-based)                                                                                         |

## 4. Actual responsibilities found in code

- **Canonical Engine facade** — 22-method `Engine` service that owns all control and inspection operations
- **HTTP API server** — Bun.serve with 30+ routes wrapping Engine methods; encodes domain errors to HTTP status codes
- **HTTP Engine client** — Full `Engine` interface implementation via HTTP, interchangeable with in-process Engine
- **Dashboard composition** — Dashboard's `inspectRun` composites 4 Engine calls into a `RunDetailDto`; this is NOT an Engine-owned composite read
- **SSE streaming** — `RunUpdates` PubSub → `text/event-stream` for live run updates
- **Presentation DTOs** — Separate `RunSummaryDto`/`RunDetailDto` types in `src/dashboard/types.ts`; these are NOT the canonical read model
- **Project filtering** — `listRuns(projectId?)` filters in-memory at Engine level
- **Error mapping** — DomainError tag → HTTP status (400/404/502/503) via `statusForError`
- **Readiness/health probes** — `/healthz`, `/readyz`, `/metrics`, `/version`

## 5. Core data structures, types, services, and APIs

| Name                           | Kind                     | Location                              | Purpose                                                   | Upstream / downstream connections                              |
| ------------------------------ | ------------------------ | ------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| `Engine`                       | Context.Service (class)  | `src/engine/interface.ts:22-47`       | Canonical 22-method control+inspection contract           | Consumed by CLI, dashboard handlers, HTTP server               |
| `WorkflowRunState`             | Schema.Class             | `src/domain/runtime-state.ts:116-136` | Full run state returned by inspect/list/start/submit      | Schema-encoded over HTTP; embedded in dashboard reads          |
| `ExecutionPlan`                | Schema.Class             | `src/domain/execution-plan.ts:87-99`  | Execution plan returned by `plan()`                       | Input to submitRun/startRun; embedded in run state             |
| `RunUpdate`                    | Schema.Class             | `src/engine/run-updates.ts:7-13`      | Streamed SSE update: {runId, status, terminal, eventType} | Streamed over `/api/runs/stream` and `/api/runs/:runId/stream` |
| `RunUpdates`                   | Context.Service          | `src/engine/run-updates.ts:15-36`     | PubSub-based publish/stream service                       | Optional; noop layer in tests                                  |
| `RunStartOptions`              | type (from Orchestrator) | `src/engine/orchestrator.ts`          | {workspacePath?, inputValues?}                            | Downstream to Executor dispatch                                |
| `RunExecutionOptions`          | Schema.Class             | `src/domain/runtime-state.ts:67-70`   | HTTP-serializable version of options                      | Used in service contracts                                      |
| `DomainError`                  | Schema.Union             | `src/domain/errors.ts:134-158`        | 20 tagged error classes                                   | All Engine methods return `Effect<A, DomainError>`             |
| `RunSubmissionRequest`         | Schema.Class             | `src/service/contracts.ts:10-13`      | {plan, options?} POST body                                | `/api/runs` POST                                               |
| `WorkflowRunSubmissionRequest` | Schema.Class             | `src/service/contracts.ts:15-18`      | {definition, options?} POST body                          | `/api/workflows/runs` POST                                     |
| `ServiceErrorResponse`         | Schema.Class             | `src/service/contracts.ts:20-23`      | {error, tag?} error body                                  | Fallback for non-domain errors                                 |
| `RunSummaryDto`                | interface                | `src/dashboard/types.ts:1-26`         | Presentation run summary                                  | Dashboard-only; NOT canonical                                  |
| `RunDetailDto`                 | interface                | `src/dashboard/types.ts:156-168`      | Dashboard composite run detail                            | Dashboard-only; NOT canonical                                  |
| `DashboardEngine`              | interface                | `src/dashboard/reads.ts:22-34`        | Engine subset for in-process dashboard                    | 12 methods, no plan/validate/submit/streamRuns                 |

## 6. Main runtime flows

### Flow A: Submit and execute workflow (via API)

1. Client POSTs `NormalizedWorkflowDefinition` to `/api/workflows/runs`
2. Server handler `submitWorkflowRun` parses JSON → calls `engine.submitDefinition()`
3. Engine: `plan(definition)` → `Planner.plan()` → returns `ExecutionPlan`
4. Engine: `runController.submitRun(plan, options)` → queues run in StateStore
5. RunController/RunUpdates publishes initial `RunUpdate` (status="queued")
6. Orchestrator picks up run, executes units, updates state, appends events
7. Client polls `inspectRun` or subscribes to SSE stream

Evidence:

- `src/service/server.ts:210-212` — route registration
- `src/service/server.ts:421-433` — `submitWorkflowRun` handler
- `src/engine/interface.ts:68-70` — `submitDefinition` implementation

### Flow B: Inspect run with composition (dashboard)

1. Dashboard server receives GET `/api/runs/:runId`
2. Proxy handler `inspectRun` sends 4 parallel GETs to service:
   - GET `…/api/runs/:runId` → `engine.inspectRun()` → `WorkflowRunState`
   - GET `…/api/runs/:runId/events` → `engine.readRunEvents()`
   - GET `…/api/runs/:runId/artifacts` → `engine.readArtifacts()`
   - GET `…/api/runs/:runId/logs` → `engine.readLogs()`
3. Proxy maps raw JSON through `mapRawRunDetail()` → returns `RunDetailDto`

Evidence:

- `src/dashboard/proxy-handlers.ts:94-108` — 4 parallel fetches + `mapRawRunDetail`
- `src/dashboard/reads.ts:102-186` — `mapRunDetail` composition function

### Flow C: SSE streaming (runs list)

1. Client GETs `/api/runs/stream` (or dashboard proxies `proxyEventStream`)
2. Server calls `runStreamEffect(engine.streamRuns())`
3. `engine.streamRuns()` returns PubSub-based `Stream<RunUpdate>`
4. `runStreamEffect` converts to SSE `text/event-stream` with `Sse.encoder.write`
5. If `RunUpdates` not configured, returns `Stream.empty` (no-op)

Evidence:

- `src/service/server.ts:284-286` — route: `GET /api/runs/stream`
- `src/service/server.ts:993-1018` — `runStreamEffect` SSE encoding
- `src/engine/interface.ts:94` — `streamRuns` with `Option.match(runUpdates, …)`

### Flow D: Cancel run (via CLI/API)

1. Client POSTs to `/api/runs/:runId/cancel` (or CLI calls `engine.cancelRun()`)
2. Server handler parses optional reason → calls `engine.cancelRun(runId, reason)`
3. Engine delegates to `runController.cancelRun(runId, reason)`
4. RunController sets cancel flag; Orchestrator interrupts in-progress Executor fibers
5. State updates to "canceled"; `RunUpdate` published; event appended

Evidence:

- `src/service/server.ts:319-321` — route: `POST /api/runs/:runId/cancel`
- `src/engine/interface.ts:80` — `cancelRun`
- `src/cli/index.ts:225-232` — CLI cancel command

### Flow E: Service client (remote Engine)

1. CLI or app imports `Engine` from effect context
2. Engine is actually `engineServiceClientLayer` — an HTTP client implementing the same `Engine` interface
3. Each Engine method → HTTP request to service server (e.g., `inspectRun` → `GET /api/runs/:runId`)
4. Response decoded from JSON via `decodeJson(DomainError)` for errors or `decodeJson(schema)` for success
5. Streaming methods (`streamRuns`, `streamRun`) → SSE over HTTP

Evidence:

- `src/service/client.ts:25-197` — `engineServiceClientLayer`
- `src/service/client.ts:399-418` — `requestStream` SSE parser
- `src/cli/index.ts:38-54` — `makeAppLayer` uses `engineServiceClientLayer`

## 7. User-visible behavior / report-relevant behavior

- **HTTP API** on configurable port with routes covering all Engine operations
- **SSE streaming** for live run updates (subset of `WorkflowRunState` as `RunUpdate`)
- **Health/readiness**: `/healthz` (200 OK), `/readyz` (200/503 with checks), `/metrics` (Prometheus), `/version`
- **Inputs accepted**: JSON POST bodies using Effect Schema codecs; route params for IDs; query params for project filtering
- **Outputs produced**: JSON responses (200/201), SSE text/event-stream, 204 No Content, plain text, binary artifact bytes
- **Errors**: DomainError tags mapped to HTTP 400/404/502/503; 500 for unknown errors; structured `{error, tag}` response body
- **Project filtering**: `GET /api/runs?projectId=X` filters in-memory
- **No pagination** on `listRuns` — returns full array
- **No auth** on API (except GitHub webhook signature verification)
- **Dashboard proxy** adds presentation-specific DTO mapping layer

## 8. Dependencies and integrations

| Dependency / integration       | Used for                                | Location                            | Notes                                                    |
| ------------------------------ | --------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `Bun.serve`                    | HTTP server                             | `src/service/server.ts:186-329`     | Native Bun HTTP server                                   |
| `effect/Schema`                | Request/response codecs, DTO validation | Throughout                          | Schema-based serialization via `encodeJson`/`decodeJson` |
| `effect/Stream` + `Sse`        | SSE streaming                           | `src/service/server.ts:993-1018`    | `Stream.toReadableStream` + `Sse.encoder.write`          |
| `HttpClient` (FetchHttpClient) | HTTP Engine client                      | `src/service/client.ts`             | Effect-native HTTP client                                |
| `effect/PubSub`                | RunUpdates broadcast                    | `src/engine/run-updates.ts:24`      | Unbounded PubSub                                         |
| `GitHubIntegration`            | GitHub webhooks/bindings                | Referenced in server routes         | Separate service; Engine not involved                    |
| `SecretStore`                  | Secrets management                      | Referenced in `/api/secrets` routes | Separate persistence                                     |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                            | Actual code evidence                                                                                                     | Classification |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------- |
| ADR 0003: Engine-owned control+inspection contract                                     | `Engine` class with 22 methods; CLI and dashboard both use `Engine`                                                      | IMPLEMENTED    |
| ADR 0003: Interface must not access persistence internals                              | CLI/dashboard route through `Engine`; no direct StateStore access                                                        | IMPLEMENTED    |
| ADR 0003: Presentation DTOs must not be the only canonical read model                  | Dashboard has `RunDetailDto`/`RunSummaryDto` (presentation-specific) separate from `WorkflowRunState` (canonical)        | IMPLEMENTED    |
| SDD §6: Resume incomplete runs after restart                                           | `runController.recoverOnStartup()` called in server; but no `resumeRun` Engine method                                    | PARTIAL        |
| ADR 0003: Cancel, retry, resume control operations                                     | Cancel and retry IMPLEMENTED; resume NOT IMPLEMENTED                                                                     | PARTIAL        |
| SDD §5: Engine inspection includes execution plan structure, unit states, dependencies | Plan structure is embedded in `WorkflowRunState.execution.plan`; no separate Engine read                                 | PARTIAL        |
| SDD §5: Engine inspection includes planning diagnostics                                | Diagnostics are on `ExecutionPlan`; readable via `plan()` but not for completed runs                                     | PARTIAL        |
| ADR 0003: Dashboard should share canonical Engine semantics                            | Dashboard `inspectRun` composites 4 separate Engine calls; not a single Engine-owned composite                           | DIFFERENT      |
| SDD §5: Interface surfaces use Engine-owned inspection reads                           | Dashboard proxy-handlers fetch raw JSON from service and map via `mapRawRunDetail()`; service returns `WorkflowRunState` | PARTIAL        |
| ADR 0003/ADR 0004: Local and self-hosted modes share Engine contract                   | Local CLI uses same `Engine` interface in-process; remote CLI uses same interface via HTTP                               | IMPLEMENTED    |

## 10. Limitations, shortcuts, and incomplete areas

1. **No `resumeRun` method** in Engine contract despite ADR listing resume as a control operation
2. **No plan-graph-per-run read** — the execution plan is embedded in `WorkflowRunState.execution.plan` but there's no Engine method to read just the plan for a completed run
3. **No per-unit state query** — `inspectRun` returns all units; no `inspectRunUnit` API
4. **No per-attempt query** — attempt data only accessible via unit's `attempts` array
5. **No pagination** — `listRuns` returns all runs unfiltered
6. **In-memory project filtering** — filters after `stateStore.listRuns()` returns all; not efficient at scale
7. **Dashboard composite reads** — `inspectRun` in dashboard makes 4 parallel HTTP calls; not an Engine-backed composite read model as ADR suggests
8. **SSE runs stream is no-op** when `RunUpdates` is not configured (e.g., in tests with `noopLayer`)
9. **`streamRuns` and `streamRun` return `Stream.empty`** when `RunUpdates` is absent — silent failure, not a dedicated error
10. **`readArtifactPayload` returns `string`** not `Uint8Array` in Engine contract; separate `readArtifactContent` is used by the service for binary
11. **Error response body for 500** uses `ServiceErrorResponse` — does not include the error tag
12. **No timed-out test** — no test verifying `timed_out` status flow through the Engine interface
13. **No retry test** — no test for `retryRun` through the Engine interface (only CLI has the command)
14. **Hardcoded SSE event type** `"run-update"` — not configurable
15. **`mapRaw*` fallback** in `reads.ts` — duplicate mapping path for raw JSON when Schema encoding is preferred but fails silently

## 11. What the final coursework report should say

### Safe claims

- The Engine facade implements a 22-method contract (validate, plan, submit/start, cancel, retry, list, inspect, stream, read events/artifacts/logs, delete, gc, version)
- The HTTP API server provides 32+ routes mapping Engine operations to JSON/SSE endpoints
- CLI and dashboard both use the `Engine` interface — CLI directly (in-process or via HTTP client), dashboard via a proxy layer
- DTOs are presentation-specific (`RunSummaryDto`, `RunDetailDto`) separate from canonical `WorkflowRunState`
- Streaming uses PubSub→SSE with `RunUpdate` as the event model
- Domain errors map to HTTP status codes (400/404/502/503)
- Project filtering is implemented (query param → in-memory filter)
- The service client implements the full `Engine` contract via HTTP, making local and remote modes interchangeable

### Claims to avoid

- "The Engine has an Engine-owned composite inspection read model" — dashboard composites from 4 separate reads
- "Resume is implemented" — no `resumeRun` method in Engine contract
- "Auth is implemented" — only GitHub webhook signature verification
- "Pagination is implemented" — `listRuns` returns unfiltered array

### Suggested figures/tables/screenshots

- **Table**: Engine contract methods (22) with signatures and delegation targets
- **Diagram**: Service route → handler → Engine method → Engine internal flow
- **Table**: Error tag → HTTP status mapping
- **Architecture diagram**: CLI/Dashboard → Engine (in-process vs HTTP client) → Orchestrator/StateStore/EventLog

### Suggested appendix material

- Full route table (`src/service/server.ts`) with method, path, request schema, response schema
- Engine contract signature table (`src/engine/interface.ts`)

## 12. Open questions for report writer

1. Should dashboard's 4-call composited `inspectRun` be presented as intentional (BFF-style) or as a shortcut away from ADR 0003's intent?
2. Is the missing `resumeRun` an intentional deferral or an oversight to note as an incompleteness?
3. Should the report note that `listRuns` has no pagination/sorting as a limitation?
4. Should `readArtifactPayload` returning `string` vs `Uint8Array` be discussed (Engine contract vs service endpoint divergence)?
5. Are the `mapRaw*` functions a workaround for Schema encoding fragility, or a deliberate design?

# Context Report: CLI workflows and local developer experience

## 1. Scope

- Owned area:
- Explicit exclusions:
- Related areas / handoff edges:

## 2. Implementation status

Use only these labels: IMPLEMENTED, PARTIAL, STUB, DOCUMENTED_NOT_FOUND, NOT_APPLICABLE.

| Capability / responsibility                     |         Status | Evidence                                               | Notes                                                                                                                                                                                                                           |
| ----------------------------------------------- | -------------: | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI binary entrypoint (two modes)               |    IMPLEMENTED | `index.ts:1-8`, `index.local.ts:1-6`                   | Remote mode (`bun run index.ts`) via HTTP client layer; local mode (`bun run local`) via embedded `Bun.serve()` + local CLI                                                                                                     |
| Command list + arg/flag parsing                 |    IMPLEMENTED | `src/cli/index.ts:80-453`                              | 9 top-level commands, 13 subcommands using `effect/unstable/cli`                                                                                                                                                                |
| Config discovery (ENGINE_BASE_URL)              |    IMPLEMENTED | `src/runtime/config.ts:196-219`                        | `EngineServiceConfig` reads `ENGINE_BASE_URL` env var, defaults to `http://127.0.0.1:3000`                                                                                                                                      |
| Workflow file loading (dynamic import)          |    IMPLEMENTED | `src/dsl/loader.ts:72-108`, `src/cli/index.ts:467-475` | `WorkflowModuleLoader.load()` uses `import()` + `Bun.pathToFileURL`; export detection: `default` then `workflow`                                                                                                                |
| Workflow validation via CLI                     |    IMPLEMENTED | `src/cli/index.ts:125-136`                             | Calls `engine.validate(definition)`, prints `workflow <id> is valid`                                                                                                                                                            |
| Workflow planning via CLI                       |    IMPLEMENTED | `src/cli/index.ts:138-146`                             | Calls `engine.plan(definition)`, prints unit + dependency list                                                                                                                                                                  |
| Run submission via CLI                          |    IMPLEMENTED | `src/cli/index.ts:148-167`                             | Calls `engine.startDefinition()` with workspace + inputs, waits for terminal, prints summary                                                                                                                                    |
| Wait-for-terminal polling                       |    IMPLEMENTED | `src/cli/index.ts:491-501`                             | Polls `engine.inspectRun()` every 250ms until terminal status                                                                                                                                                                   |
| Runs list                                       |    IMPLEMENTED | `src/cli/index.ts:169-176`                             | `runs list` with optional `--project` filter                                                                                                                                                                                    |
| Runs show (inspect)                             |    IMPLEMENTED | `src/cli/index.ts:178-190`                             | `runs show <runId>`, prints full run state                                                                                                                                                                                      |
| Runs events                                     |    IMPLEMENTED | `src/cli/index.ts:192-204`                             | `runs events <runId>`, prints event sequence                                                                                                                                                                                    |
| Runs artifacts metadata                         |    IMPLEMENTED | `src/cli/index.ts:206-218`                             | `runs artifacts <runId>`                                                                                                                                                                                                        |
| Runs logs metadata                              |    IMPLEMENTED | `src/cli/index.ts:248-260`                             | `runs logs <runId>`                                                                                                                                                                                                             |
| Runs artifact payload                           |    IMPLEMENTED | `src/cli/index.ts:276-288`                             | `runs artifact <artifactRef>`, reads payload text                                                                                                                                                                               |
| Runs log payload                                |    IMPLEMENTED | `src/cli/index.ts:262-274`                             | `runs log <logRef>`, reads payload text                                                                                                                                                                                         |
| Runs cancel                                     |    IMPLEMENTED | `src/cli/index.ts:220-232`                             | `runs cancel <runId>`                                                                                                                                                                                                           |
| Runs retry                                      |    IMPLEMENTED | `src/cli/index.ts:234-246`                             | `runs retry <runId>`                                                                                                                                                                                                            |
| Artifacts delete                                |    IMPLEMENTED | `src/cli/index.ts:290-306`                             | `artifacts delete <artifactRef>`                                                                                                                                                                                                |
| Logs delete                                     |    IMPLEMENTED | `src/cli/index.ts:308-324`                             | `logs delete <logRef>`                                                                                                                                                                                                          |
| GitHub bindings add                             |    IMPLEMENTED | `src/cli/index.ts:341-365`                             | `bindings add github <repo> <path> --installation-id`                                                                                                                                                                           |
| GitHub bindings list                            |    IMPLEMENTED | `src/cli/index.ts:372-379`                             | `bindings list`                                                                                                                                                                                                                 |
| Projects list                                   |    IMPLEMENTED | `src/cli/index.ts:381-388`                             | `projects list`                                                                                                                                                                                                                 |
| Secrets set                                     |    IMPLEMENTED | `src/cli/index.ts:400-421`                             | `secrets set <projectId> <key> --from-env <VAR>`                                                                                                                                                                                |
| Secrets list                                    |    IMPLEMENTED | `src/cli/index.ts:423-429`                             | `secrets list <projectId>`                                                                                                                                                                                                      |
| Secrets delete                                  |    IMPLEMENTED | `src/cli/index.ts:431-443`                             | `secrets delete <projectId> <key>`                                                                                                                                                                                              |
| Timeline/inspection (SSE streaming)             |        PARTIAL | `src/cli/index.ts:262-274`                             | No CLI command for live SSE streaming; only queries metadata/payloads. Engine supports SSE routes at `/api/runs/stream` and `/api/runs/:runId/stream`                                                                           |
| Graph visualization in CLI                      | NOT_APPLICABLE | —                                                      | Not designed for CLI; dashboard provides DAG rendering                                                                                                                                                                          |
| Plan structure inspection                       |    IMPLEMENTED | `src/cli/index.ts:503-511`                             | `plan` command outputs unit list, deps, diagnostics count                                                                                                                                                                       |
| In-memory test engine                           |    IMPLEMENTED | `src/runtime/layers.ts:80-137`                         | `makeInMemoryEngineLayer` used by `makeCliLayer()` for tests                                                                                                                                                                    |
| Sample executor results for UX demos            |    IMPLEMENTED | `src/cli/index.ts:719-774`                             | `sampleExecutorResultsByUnitId` seeds mock artifacts/logs for `unit:build`, `unit:test`, `unit:deploy`                                                                                                                          |
| Local engine bootstrap                          |    IMPLEMENTED | `src/cli/local.ts:22-37`                               | `localCliProgram`: starts `Bun.serve()`, runs CLI, stops server                                                                                                                                                                 |
| Engine service program                          |    IMPLEMENTED | `src/service/server.ts:352-355`                        | `serviceProgram`: runs `startServiceServer` then `Effect.never`                                                                                                                                                                 |
| `--export` flag                                 |    IMPLEMENTED | `src/cli/index.ts:84-88`                               | Selects named export from workflow module                                                                                                                                                                                       |
| `--workspace` flag                              |    IMPLEMENTED | `src/cli/index.ts:90-94`                               | Workspace directory for container mounts; defaults to workflow module directory                                                                                                                                                 |
| `--inputs` flag                                 |    IMPLEMENTED | `src/cli/index.ts:96-99`                               | JSON object string for workflow inputs                                                                                                                                                                                          |
| `--project` flag                                |    IMPLEMENTED | `src/cli/index.ts:111-114`                             | Filter runs list by project ID                                                                                                                                                                                                  |
| CLI tests                                       |    IMPLEMENTED | `tests/cli.test.ts:1-820`                              | 16 test cases covering validate, plan, run (success/failure), workspace defaulting, input parsing, runs list filter, artifact payload, cancel, skip reasons, artifacts delete, logs delete, bindings add/list, secrets set/list |
| Local CLI bootstrap test                        |    IMPLEMENTED | `tests/local-cli.test.ts:1-29`                         | Verifies start-run-stop lifecycle with mock handle                                                                                                                                                                              |
| Error diagnostics from validate                 |        PARTIAL | `src/cli/index.ts:134`                                 | `engine.validate(definition)` returns `Effect<void, DomainError>`; CLI only prints success message, errors propagate as Effect failures with `EngineUnavailable` catch                                                          |
| Error diagnostics from plan                     |        PARTIAL | `src/cli/index.ts:142-144`                             | Plan output includes `diagnostics: N` count but CLI doesn't render individual diagnostic entries                                                                                                                                |
| Timeline/graph commands                         | NOT_APPLICABLE | —                                                      | Timeline is available via dashboard only                                                                                                                                                                                        |
| `bun run cli` vs `bun run index.ts` equivalence |    IMPLEMENTED | `package.json`                                         | Scripts: `cli` → `index.ts`, `local` → `index.local.ts`                                                                                                                                                                         |

## 3. Main source locations

| Path                           | Role in this area                                           | Important symbols / entrypoints                                                                                                  |
| ------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/index.ts`             | Main CLI implementation                                     | `cli`, `cliProgram`, `appProgram`, `makeCliLayer`, `makeAppLayer`, `makeAppLayerForBaseUrl`, all Command definitions             |
| `src/cli/local.ts`             | Local mode bootstrap                                        | `localCliProgram`, `runWithLocalService`, `LocalServiceHandle`                                                                   |
| `index.ts`                     | Remote mode entry point                                     | Calls `appProgram.pipe(Effect.provide(makeAppLayer()))`                                                                          |
| `index.local.ts`               | Local mode entry point                                      | Calls `localCliProgram.pipe(Effect.provide(BunServices.layer))`                                                                  |
| `src/dsl/loader.ts`            | Workflow module dynamic import                              | `WorkflowModuleLoader`, `loadWorkflowModule`, `resolveWorkflowModulePath`                                                        |
| `src/dsl/materializer.ts`      | Authored workflow → normalized definition                   | `DslMaterializer`, `materialize`                                                                                                 |
| `src/engine/interface.ts`      | Engine service contract                                     | `Engine` class with 18 methods                                                                                                   |
| `src/service/client.ts`        | HTTP client wrappers for Engine, GitHubIntegration, Secrets | `engineServiceClientLayer`, `gitHubIntegrationClientLayer`, `SecretsClient`                                                      |
| `src/service/server.ts`        | Engine HTTP server (Bun.serve routes)                       | `startServiceServer`, `makeServiceLayer`, `serviceProgram`                                                                       |
| `src/runtime/layers.ts`        | DI layers for in-memory/durable engine                      | `makeInMemoryEngineLayer`, `makeServiceEngineLayer`, `makeDurableStorageLayer`                                                   |
| `src/runtime/config.ts`        | Environment-based config                                    | `EngineServiceConfig`, `SchedulerConfig`, `PostgresConfig`                                                                       |
| `src/runtime/version.ts`       | Version string from package.json                            | `appVersion`                                                                                                                     |
| `src/service/contracts.ts`     | API request/response schemas                                | `RunSubmissionRequest`, `WorkflowRunSubmissionRequest`, `RunActionRequest`, `SecretSetRequest`                                   |
| `src/domain/runtime-state.ts`  | Runtime state domain types                                  | `WorkflowRunState`, `ExecutionUnitState`, `WorkflowRunStatus`                                                                    |
| `src/domain/errors.ts`         | Domain error types                                          | `DomainError` (union of 18 error types)                                                                                          |
| `src/domain/execution-plan.ts` | Execution plan types                                        | `ExecutionPlan`, `PlanUnit`, `PlanDependency`                                                                                    |
| `tests/cli.test.ts`            | CLI unit tests                                              | 16 test cases                                                                                                                    |
| `tests/local-cli.test.ts`      | Local bootstrap test                                        | 1 test case                                                                                                                      |
| `tests/fixtures/workflows/`    | Test workflow fixtures                                      | `valid-workflow.ts`, `materialization-error.ts`, `invalid-export.ts`, `github-trigger-workflow.ts`, `package-import-workflow.ts` |
| `examples/demo-workflow.ts`    | Example workflow (build → test → package)                   | Default export, uses `Workflow.make`, `Job.make`, `Artifact.file`                                                                |
| `examples/demo-project/`       | Demo workspace (package.json, src/, tests/)                 | -                                                                                                                                |

## 4. Actual responsibilities found in code

- Parse CLI arguments and flags using `effect/unstable/cli` (`Argument`, `Flag`, `Command`)
- Load TypeScript workflow modules via dynamic `import()` at runtime, supporting both default and named exports
- Materialize authored workflow definitions into normalized form via `DslMaterializer`
- Call `Engine` operations (validate, plan, startDefinition, listRuns, inspectRun, cancelRun, retryRun, readRunEvents, readArtifacts, readArtifactPayload, readLogs, readLogPayload, deleteArtifact, deleteLog)
- Support two execution modes: in-process Engine (embedded, for test/demo) and remote Engine (HTTP client, for production-like deployment)
- Bootstrap local mode: start a `Bun.serve()` engine service, run CLI against it, tear down
- Resolve workspace paths: explicit `--workspace` flag or default to workflow module's parent directory
- Parse `--inputs` as JSON object and forward as input values
- Render structured text output for validate, plan, run, runs list/show/events/artifacts/logs, artifacts delete, logs delete, bindings add/list, projects list, secrets set/list/delete
- Seed sample executor results for demo workflow (produces mock artifacts, logs for `unit:build`, `unit:test`, `unit:deploy`)
- Handle `EngineUnavailable` error with a user-facing message (`engine service unavailable: <msg>`)
- Provide test support via `makeCliLayer()` and `TestConsole` layer

## 5. Core data structures, types, services, and APIs

| Name                           | Kind          | Location                              | Purpose                                                     | Upstream / downstream connections                                                         |
| ------------------------------ | ------------- | ------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Engine`                       | Service class | `src/engine/interface.ts:22-47`       | Central contract for all Engine operations                  | CLI calls these; service client implements via HTTP; in-memory engine implements directly |
| `WorkflowModuleLoader`         | Service class | `src/dsl/loader.ts:53-70`             | Resolves and dynamically imports workflow modules           | Called by CLI `loadAndMaterializeWorkflow`                                                |
| `DslMaterializer`              | Service class | `src/dsl/materializer.ts:51-60`       | Converts authored DSL to `NormalizedWorkflowDefinition`     | Called by CLI; validates structure, checks duplicates                                     |
| `NormalizedWorkflowDefinition` | Schema class  | `src/domain/workflow-definition.ts`   | Canonical workflow format for Engine                        | Produced by `DslMaterializer`, consumed by `Engine.validate/plan/startDefinition`         |
| `ExecutionPlan`                | Schema class  | `src/domain/execution-plan.ts:87-99`  | Planner output with resolved DAG                            | Returned by `engine.plan()`, used by CLI `plan` command renderer                          |
| `WorkflowRunState`             | Schema class  | `src/domain/runtime-state.ts:116-136` | Complete run snapshot with units, progress, artifacts, logs | Returned by `engine.inspectRun()`, `engine.startDefinition()`, etc.                       |
| `SecretsClient`                | Service class | `src/service/client.ts:293-338`       | HTTP client for secret operations                           | Used by `secrets set/list/delete` commands                                                |
| `GitHubIntegration`            | Service class | `src/github/integration.ts`           | GitHub binding and webhook methods                          | Used by `bindings add/list`, `projects list` commands                                     |
| `EngineServiceConfig`          | Config class  | `src/runtime/config.ts:196-219`       | Service URL and port from env                               | `ENGINE_BASE_URL`, `ENGINE_PORT`                                                          |
| `CliInputInvalid`              | Error class   | `src/cli/index.ts:25-27`              | CLI input validation error                                  | Thrown on invalid `--inputs` JSON                                                         |
| `RunExecutionOptions`          | Schema class  | `src/domain/runtime-state.ts:67-70`   | Workspace path + input values                               | Passed from CLI to Engine                                                                 |
| `RunSubmissionRequest`         | Schema class  | `src/service/contracts.ts:10-13`      | HTTP body for `POST /api/runs`                              | Used by engine service client                                                             |
| `WorkflowRunSubmissionRequest` | Schema class  | `src/service/contracts.ts:15-18`      | HTTP body for `POST /api/workflows/runs`                    | Used by engine service client                                                             |
| `RunStartOptions`              | Type          | `src/engine/orchestrator.ts`          | Workspace + inputs for starting a run                       | Passed from CLI to Engine                                                                 |

## 6. Main runtime flows

Describe only flows verified in source code.

### Flow A: Local workflow run (`bun run local run <workflow> --workspace <dir>`)

1. `index.local.ts` starts → calls `localCliProgram` from `src/cli/local.ts`
2. `localCliProgram` calls `runWithLocalService(startLocalService, runProgram)`
3. `startLocalService`: creates `makeServiceLayer()`, calls `startServiceServer` which starts `Bun.serve()` on port 3000 (or `ENGINE_PORT`)
4. Returns `LocalServiceHandle` with `baseUrl: "http://127.0.0.1:3000"` and `stop: () => server.stop(true)`
5. `runProgram(baseUrl)`: calls `appProgram` provided with `makeAppLayerForBaseUrl(baseUrl)` + `BunServices.layer`
6. `appProgram` (`src/cli/index.ts:457-463`): runs `cliProgram` with `EngineUnavailable` catch
7. `cliProgram` (`src/cli/index.ts:455`): `Command.run(cli, { version })` parses args, dispatches to `runCommand`
8. `runCommand` handler (`src/cli/index.ts:148-167`):
   - Resolves workspace path via `resolveWorkspacePath` (defaults to dirname of workflow module)
   - Parses `--inputs` JSON via `parseInputValues`
   - Calls `loadAndMaterializeWorkflow` → `WorkflowModuleLoader.load()` then `DslMaterializer.materialize()`
   - Calls `engine.startDefinition(definition, { workspacePath, inputValues })` — for local mode this is HTTP to local engine service
   - The HTTP client `startDefinition` (`src/service/client.ts:92-95`) calls `submitDefinition` then polls `waitForTerminalRun`
   - After terminal, reads events, artifacts, logs via Engine
   - Prints `renderRunSummary` (run ID, project, status, workspace, inputs/outputs/reports, unit statuses, events, artifacts, logs)
9. On completion, `runWithLocalService` calls `service.stop()` (shuts the embedded server)

Evidence:

- `src/cli/local.ts:22-37` — `localCliProgram` with `acquireUseRelease` lifecycle
- `src/service/server.ts:186-329` — `Bun.serve()` with all API routes, including engine service
- `src/cli/index.ts:148-167` — `runCommand` handler
- `src/cli/index.ts:467-475` — `loadAndMaterializeWorkflow`
- `src/service/client.ts:92-95` — `startDefinition` HTTP client polling

### Flow B: Remote mode validate (`bun run index.ts validate <workflow>`)

1. `index.ts` starts → creates `makeAppLayer()` (HTTP client layers for Engine, GitHubIntegration, SecretsClient)
2. Provides it to `appProgram` which runs `cliProgram`
3. Args parsed → `validateCommand` handler
4. `loadAndMaterializeWorkflow` resolves and dynamically imports the workflow module
5. `engine.validate(definition)` → HTTP POST `/api/workflows/validate` with normalized definition
6. Prints `workflow <workflowId> is valid`

Evidence:

- `index.ts:1-8` — entry point
- `src/cli/index.ts:125-136` — validate command
- `src/service/client.ts:33-38` — HTTP validate client

### Flow C: In-memory test CLI (test layer, no HTTP)

1. Test creates `makeCliLayer()` → `DslMaterializer.layer` + `WorkflowModuleLoader.layer` + `makeInMemoryEngineLayer()`
2. `Command.runWith(cli, { version })` called with test args
3. Output captured via `TestConsole.logLines`

Evidence:

- `tests/cli.test.ts:666-673` — `runCli` helper with `makeCliTestLayer`
- `src/runtime/layers.ts:80-137` — `makeInMemoryEngineLayer`

### Flow D: Workspace resolution

1. If `--workspace` flag provided: `resolvePath(process.cwd(), workspace.value)`
2. If omitted: `dirname(resolvedModulePath)` (directory containing the workflow file)

Evidence:

- `src/cli/index.ts:477-489` — `resolveWorkspacePath`

### Flow E: Output rendering structure

- `renderPlanSummary` (`src/cli/index.ts:503-511`): workflow ID, name, units with deps, dependency edges, diagnostic count
- `renderRunSummary` (`src/cli/index.ts:513-535`): run ID, project, status, workspace, inputs, outputs, reports, unit statuses, event tags, artifact refs, log refs
- `renderRunState` (`src/cli/index.ts:547-570`): full inspection with progress, failure, cancellation, inputs/outputs/reports, trigger metadata, per-unit skip/cancel reasons
- `renderRunsList` (`src/cli/index.ts:537-545`): run ID, project, workflow, status, updatedAt

## 7. User-visible behavior / report-relevant behavior

- CLI/API/UI/runtime behavior that can be described in the coursework report:
- Inputs accepted:
- Outputs produced:
- Errors/diagnostics surfaced:

**CLI binary:**

- `bun run cli <command>` or `bun run index.ts <command>` — remote mode (needs `ENGINE_BASE_URL`)
- `bun run local <command>` — local embedded engine mode

**Commands and their I/O:**

| Command                             | Inputs                                                            | Output                                                                                                                                                       | UX notes                                                         |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `validate <workflow>`               | workflow module path, `--export`                                  | `workflow <id> is valid` or Effect failure                                                                                                                   | Error propagates as Effect defect; no structured error rendering |
| `plan <workflow>`                   | workflow module path, `--export`                                  | Multi-line: workflow name, unit list with deps, edge list, diagnostic count                                                                                  | Does NOT render individual diagnostics, only count               |
| `run <workflow>`                    | workflow path, `--workspace`, `--inputs`, `--export`              | Multi-line: run ID, project, status, workspace, inputs/outputs/reports, unit statuses, event tags, artifact/log refs                                         | Polls every 250ms until terminal; prints summary at end          |
| `runs list`                         | `--project` (optional)                                            | `runs:` header + per-run: ID, project, workflow, status, updatedAt                                                                                           | Empty list shows `-`                                             |
| `runs show <runId>`                 | runId                                                             | Full run state: ID, project, workflow, plan, status, timestamps, progress, failure, cancellation, inputs/outputs/reports, trigger metadata, per-unit details |                                                                  |
| `runs events <runId>`               | runId                                                             | `events:` header + numbered event tags                                                                                                                       |                                                                  |
| `runs artifacts <runId>`            | runId                                                             | `artifacts:` header + name, ref, status, expiresAt, summary                                                                                                  |                                                                  |
| `runs artifact <artifactRef>`       | artifactRef                                                       | `artifact: <ref>` + payload text                                                                                                                             |                                                                  |
| `runs logs <runId>`                 | runId                                                             | `logs:` header + name, ref, status, expiresAt                                                                                                                |                                                                  |
| `runs log <logRef>`                 | logRef                                                            | `log: <ref>` + payload text                                                                                                                                  |                                                                  |
| `runs cancel <runId>`               | runId                                                             | Full run state after cancellation                                                                                                                            |                                                                  |
| `runs retry <runId>`                | runId                                                             | Full run state of new retry run                                                                                                                              |                                                                  |
| `artifacts delete <artifactRef>`    | artifactRef                                                       | `artifact: <ref>`, `status: deleted`                                                                                                                         |                                                                  |
| `logs delete <logRef>`              | logRef                                                            | `log: <ref>`, `status: deleted`                                                                                                                              |                                                                  |
| `bindings add github <repo> <path>` | repo, path, `--installation-id`, `--branch`, `--workspace-subdir` | Multi-line binding summary                                                                                                                                   |                                                                  |
| `bindings list`                     | (none)                                                            | `bindings:` header + per-binding summary                                                                                                                     |                                                                  |
| `projects list`                     | (none)                                                            | `projects:` header + per-project: ID, name, provider, repo, bindings count, run count                                                                        |                                                                  |
| `secrets set <projectId> <key>`     | projectId, key, `--from-env <VAR>`                                | `project:`, `secret:`, `status: stored`                                                                                                                      | Value read from env var, NOT printed                             |
| `secrets list <projectId>`          | projectId                                                         | `project:`, `secrets:` header + key, updatedAt                                                                                                               | Values NOT printed                                               |
| `secrets delete <projectId> <key>`  | projectId, key                                                    | `project:`, `secret:`, `status: deleted`                                                                                                                     |                                                                  |

**Error diagnostics:**

- `EngineUnavailable` errors: caught and printed as `engine service unavailable: <message>`
- Other domain errors (e.g. `DslMaterializationFailed`, `PlanningFailed`, `WorkflowInputsInvalid`): propagate as Effect failures, no user-friendly message
- CLI-specific input errors (`CliInputInvalid`): thrown via `Effect.fail` for bad JSON inputs
- Secret `--from-env` missing var: prints `missing environment variable for --from-env: <var>` + fails

**Config discovery:**

- `ENGINE_BASE_URL` env var (default `http://127.0.0.1:3000`)
- No config file discovery (`effect-cicd.json`, `.effect-cicd/`, etc.) is implemented

**Workflow file discovery:**

- CLI requires explicit workflow module path argument
- No automatic `workflows/**/*.ts` globbing in CLI (server has `/api/workflows/files` endpoint for discovery)

## 8. Dependencies and integrations

| Dependency / integration                        | Used for                                             | Location                                                | Notes                                               |
| ----------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `effect/unstable/cli`                           | CLI framework (Command, Argument, Flag, Command.run) | `src/cli/index.ts:2`                                    | Effect v4 built-in CLI, no `@effect/cli` v3 package |
| `Bun.serve()` (in-process)                      | Local mode engine server                             | `src/service/server.ts:186`                             | Local mode starts this via `startServiceServer`     |
| `Bun.file()` + `Bun.pathToFileURL()`            | Workflow module reading + dynamic import             | `src/dsl/loader.ts:110-128`, `src/runtime/version.ts:1` |                                                     |
| `Bun.resolveSync()`                             | Workflow module path resolution                      | `src/dsl/loader.ts:121`                                 |                                                     |
| `FetchHttpClient` (from `effect/unstable/http`) | HTTP client for remote Engine mode                   | `src/service/client.ts:3`                               |                                                     |
| `TestConsole` (from `effect/testing`)           | CLI test output capture                              | `tests/cli.test.ts:3-4`                                 |                                                     |
| `effect/unstable/encoding` (Sse)                | SSE parsing for run streams (client)                 | `src/service/client.ts:4`                               | Used in client's `makeRunUpdateSseParser`           |
| `effect/unstable/process/ChildProcessSpawner`   | CLI test support layer                               | `tests/cli.test.ts:5`                                   | Stubbed in tests                                    |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                                                                             | Actual code evidence                                                                                                                     | Classification                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| "The Interface layer operates over engine-managed execution and engine-owned runtime state" (ADRs)                                      | CLI calls `Engine` service exclusively; respects boundary                                                                                | IMPLEMENTED                                                                                      |
| "local and self-hosted are operating modes of the same system, same Engine model"                                                       | `localCliProgram` boots `makeServiceLayer()` (same as server), CLI uses HTTP client; local mode uses same Engine code path               | IMPLEMENTED                                                                                      |
| "The CLI should expose workflow-aware inspection — run status, plan structure, unit state, progress, failures, events, logs, artifacts" | `runs show` provides most of this; `plan` provides structure without individual diagnostics; events/artifacts/logs are separate commands | PARTIAL — covered but CLI lacks combined timeline view                                           |
| "CLI and dashboard must not access State Store, Event Log, Artifact Store directly"                                                     | CLI goes through `Engine` in both modes; test layer goes through in-memory Engine                                                        | IMPLEMENTED                                                                                      |
| "Validate a normalized workflow definition" via CLI                                                                                     | `validate` command calls `engine.validate()`                                                                                             | IMPLEMENTED                                                                                      |
| "Plan a normalized workflow definition" via CLI                                                                                         | `plan` command calls `engine.plan()`                                                                                                     | IMPLEMENTED                                                                                      |
| "Start/Cancel/Retry a workflow run" via CLI                                                                                             | `run`, `runs cancel`, `runs retry` commands                                                                                              | IMPLEMENTED                                                                                      |
| "List workflow runs" via CLI                                                                                                            | `runs list` command with `--project` filter                                                                                              | IMPLEMENTED                                                                                      |
| "Read execution timeline from Event Log" via CLI                                                                                        | `runs events <runId>` prints event sequence                                                                                              | IMPLEMENTED                                                                                      |
| "Read compact output summaries" via CLI                                                                                                 | Plan output shows diagnostics count but NOT individual entries                                                                           | PARTIAL — count only, no text rendering                                                          |
| "Diagnostics should be structured enough for CLI ... surfaces to present them"                                                          | Plan output shows `diagnostics: N` but doesn't render individual diagnostic entries                                                      | PARTIAL                                                                                          |
| "local mode may embed the Engine in the CLI process — packaging choice, same semantics"                                                 | `src/cli/local.ts` starts a full HTTP engine service (in-process via Bun.serve), not embedded directly                                   | DIFFERENT — does NOT embed; starts same HTTP service process, runs CLI as HTTP client against it |
| "Should local mode embed the Engine in the CLI process, start a local Engine process, or support both?" (open question in ADR)          | Implements "start a local Engine process" (in-process via Bun.serve)                                                                     | IMPLEMENTED (one option)                                                                         |
| "CLI surfaces must not implement their own run lifecycle rules"                                                                         | CLI uses `waitForTerminalRun` polling; does not implement Orchestrator/Executor logic                                                    | IMPLEMENTED                                                                                      |
| "Resume incomplete workflow runs" via CLI                                                                                               | NOT found — no CLI command for resumption                                                                                                | NOT FOUND                                                                                        |
| "The CLI should support `--export` to select a named export"                                                                            | `--export` flag is implemented and tested                                                                                                | IMPLEMENTED                                                                                      |
| "DSL materialization should be testable independently from Engine execution"                                                            | Tests validate materializer failures surface through CLI; `DslMaterializer.layer` is swappable                                           | IMPLEMENTED                                                                                      |
| "Source metadata" preservation for workflow/unit/dependency                                                                             | `NormalizedWorkflowDefinition` has `source` field; CLI does not render source metadata                                                   | PARTIAL — stored but not displayed                                                               |
| "Inspection must be workflow-aware, not only stream-oriented"                                                                           | CLI provides structured inspection per command but no combined workflow-aware view (runs show + events + artifacts are separate calls)   | PARTIAL                                                                                          |

## 10. Limitations, shortcuts, and incomplete areas

- **No timeline/graph visualization in CLI**: only textual event list (`runs events`); the dashboard provides DAG rendering
- **No resume command**: `resume` is referenced in docs but not implemented in CLI
- **Plan diagnostic detail hidden**: `plan` output shows `diagnostics: N` count but never renders individual `PlanningDiagnostic` entries (severity, message, unitId)
- **Error presentation is minimal**: `appProgram` only catches `EngineUnavailable`; other domain errors produce raw Effect failures with no user-friendly message
- **No SSE streaming in CLI**: engine supports SSE at `/api/runs/stream` and `/api/runs/:runId/stream` but CLI only does polling
- **No config file discovery**: no `effect-cicd.json` or `.effect-cicd/config` auto-discovery; all config is env-var-based
- **No workflow auto-discovery**: CLI requires explicit workflow path; no `workflows/**/*.ts` glob from CLI
- **`local` mode is NOT embedded Engine**: starts full Bun.serve HTTP service, not a direct in-process call — documented ADR left this as an open question; current impl chose "start a local Engine process"
- **Sample executor data is hardcoded**: `sampleExecutorResultsByUnitId` in `src/cli/index.ts:719-774` seeds mock results for `unit:build`, `unit:test`, `unit:deploy` — only works for demo workflow IDs
- **No `--help` content tested**: command descriptions exist but aren't verified in tests
- **No progress/streaming during `run` polling**: CLI polls every 250ms silently; no partial output until run completes
- **`runs list` renders entire output at once**: no pagination or streaming
- **Version comes from `package.json`**: `src/runtime/version.ts:1` reads via `Bun.file()`; works with Bun runtime

## 11. What the final coursework report should say

- Safe claims:
- Claims to avoid:
- Suggested figures/tables/screenshots:
- Suggested appendix material:

**Safe claims:**

- CLI has 9 top-level commands with 13 subcommands (validate, plan, run, runs list/show/events/artifacts/artifact/logs/log/cancel/retry, artifacts delete, logs delete, bindings add/list, projects list, secrets set/list/delete)
- Two execution modes: `bun run local` (ephemeral engine service) and `bun run index.ts` (persistent engine service)
- All CLI commands go through the `Engine` service contract — never directly access storage
- Workflow files are loaded via dynamic `import()` at runtime; supports both `default` and `workflow` named exports
- CLI uses Effect v4's built-in `effect/unstable/cli` framework for argument parsing
- Workspace defaults to the directory containing the workflow module
- `--inputs` accepts a JSON object string
- Sample executor results are seeded for demo workflows only
- In-memory engine layer exists for testability (`makeInMemoryEngineLayer`)
- 16 CLI tests verify command dispatching, output formatting, error propagation, and layer interactions

**Claims to avoid:**

- Do NOT claim "embedded Engine" — local mode starts a separate Bun.serve HTTP process, not truly embedded
- Do NOT claim "full workflow-aware inspection" — CLI inspection is split across multiple commands
- Do NOT claim "SSE streaming in CLI" — SSE is engine/dashboard only
- Do NOT claim "resume command exists"
- Do NOT claim "config file auto-discovery" — only env vars

**Suggested figures/tables/screenshots:**

- CLI command hierarchy tree (9 top-level + 13 subcommands)
- Sample `plan` output (text format)
- Sample `run` output (text format with unit statuses, events, artifacts, logs)
- Sample `runs show` output
- Local vs remote mode architecture diagram (showing local: Bun.serve → HTTP → CLI vs remote: CLI → HTTP → engine service)
- CLI test coverage table (16 tests per area: validate/plan/run/list/cancel/delete/secrets/bindings)
- Command → Engine method mapping table

**Suggested appendix material:**

- Full CLI command reference table (name, args, flags, description, Engine method call)
- Example output for each command
- `makeCliLayer` dependency graph (DslMaterializer, WorkflowModuleLoader, makeInMemoryEngineLayer)
- Environment variable reference (ENGINE_BASE_URL, ENGINE_PORT)

## 12. Open questions for report writer

- Is the "local mode starts Bun.serve vs truly in-process" distinction important for your evaluation criteria? The ADR listed both as options; the code chose one.
- Would you like me to produce any specific command output samples for your screenshots section?
- Are there specific error scenarios the report should demonstrate (e.g., bad workflow, engine unavailable, missing inputs)?
- Should the report mention that the CLI only catches `EngineUnavailable` but lets other domain errors propagate as Effect defects?
- The `plan` command shows diagnostics count but not individual diagnostics — is this worth noting as a gap, or is it intentionally minimal?

# Context Report: Dashboard Inspection and Operational Control UI

## 1. Scope

- **Owned area:** Web dashboard SPA — project management, run inspection, execution control, log/artifact browsing, secrets/bindings management
- **Explicit exclusions:** Engine internals (`src/engine/`), CLI (`src/cli/`), GitHub webhook internals (`src/github/`), DSL definition (`src/dsl/`), server contract definitions (`src/service/`)
- **Related areas / handoff edges:** `src/dashboard/handlers.ts` → `src/dashboard/reads.ts` (DashboardEngine interface) → Engine; `src/dashboard/server.ts` → EngineServiceConfig for proxy mode; API client fetches `/api/*` endpoints served by the service layer

## 2. Implementation status

| Capability / responsibility          | Status         | Evidence                                                                                                    | Notes                                                                             |
| ------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Projects list page                   | IMPLEMENTED    | `src/dashboard/views/projects-page.tsx:86`                                                                  | Real API via `dashboardQueries.projects()`; create dialog for local + GitHub      |
| Project detail page                  | IMPLEMENTED    | `src/dashboard/views/project-page.tsx:115`                                                                  | Tabs: Runs / Bindings / Secrets; edit/delete/run-now actions                      |
| Runs list per project                | IMPLEMENTED    | `src/dashboard/views/runs-page.tsx:13`                                                                      | RunsTab component with table; SSE live refresh                                    |
| Run detail + stages                  | IMPLEMENTED    | `src/dashboard/views/run-page.tsx:36`                                                                       | Tabs: Workflow (pipeline) / Timeline; cancel/retry/GC                             |
| Job/unit detail page                 | IMPLEMENTED    | `src/dashboard/views/job-page.tsx:23`                                                                       | Tabs: Overview / Logs / Artifacts / Timeline; attempt selector                    |
| Run pipeline graph (DAG)             | IMPLEMENTED    | `src/dashboard/components/run-pipeline.tsx`                                                                 | SVG dependency curves; stage columns with clickable unit cards; status dots       |
| Timeline event view                  | IMPLEMENTED    | `src/dashboard/components/timeline-event-list.tsx`                                                          | Color-coded event dots; event message + type + timestamp                          |
| Logs per run/unit/attempt            | IMPLEMENTED    | `src/dashboard/views/job-page.tsx:291`                                                                      | PayloadBrowser component; filters by attempt; text payload view with line numbers |
| Artifacts per run/unit/attempt       | IMPLEMENTED    | `src/dashboard/views/job-page.tsx:314`                                                                      | PayloadBrowser; text/binary detection; download raw link                          |
| Reports view                         | IMPLEMENTED    | `src/dashboard/views/job-page.tsx:148`                                                                      | Reports shown as badges on artifacts; refs to artifact payload                    |
| Bindings (GitHub) tab                | IMPLEMENTED    | `src/dashboard/views/project-bindings-tab.tsx:67`                                                           | Table of bindings; add dialog with autocomplete for repos/branches/workflow files |
| Secrets tab                          | IMPLEMENTED    | `src/dashboard/views/project-secrets-tab.tsx:27`                                                            | CRUD: list/add/delete secrets                                                     |
| Control actions (start/cancel/retry) | IMPLEMENTED    | `src/dashboard/views/run-page.tsx:56-82`, `project-page.tsx:196-213`                                        | Via `dashboardApi.cancelRun`/`retryRun`/`startProjectRun`/`gcRunArtifacts`        |
| Live updates (SSE)                   | IMPLEMENTED    | `src/dashboard/lib/use-stream-query-refresh.ts`                                                             | EventSource on `/api/runs/stream`; invalidates active queries                     |
| Loading states                       | IMPLEMENTED    | Various views — `isPending` checks show "Loading..." text                                                   | Simple text, no spinners/skeletons                                                |
| Error states                         | IMPLEMENTED    | Various views — `error` checks show Alert destructive                                                       | Consistent Alert pattern                                                          |
| Empty states                         | IMPLEMENTED    | No projects / runs / bindings / secrets shown                                                               | Descriptive messages and CTA cards                                                |
| 404 / not-found states               | IMPLEMENTED    | `app.tsx:43`, `job-page.tsx:126-131`                                                                        | Navigate to root; "Run not found" / "Job not found"                               |
| API client                           | IMPLEMENTED    | `src/dashboard/api.ts:95`                                                                                   | `createDashboardApi()` — typed fetch wrapper for all dashboard endpoints          |
| Route parsing                        | IMPLEMENTED    | `src/dashboard/lib/routing.ts`                                                                              | `parseDashboardRoute` with view + attempt query params                            |
| Frontend tests                       | IMPLEMENTED    | `tests/dashboard-ui.test.tsx`, `tests/dashboard-handlers.test.ts`, `tests/dashboard-proxy-handlers.test.ts` | Smoke, handler integration, proxy forwarding                                      |
| Screenshots / stories                | NOT_APPLICABLE | —                                                                                                           | No Storybook or screenshot artifacts found                                        |
| Project-wide runs list               | PARTIAL        | `api.ts:137` `listRuns()` accepts optional `projectId`                                                      | No standalone "All Runs" page; only per-project runs tab                          |
| Workflow definition viewer           | NOT_APPLICABLE | —                                                                                                           | Not in dashboard scope per docs                                                   |

## 3. Main source locations

| Path                                               | Role in this area                              | Important symbols / entrypoints                                                                        |
| -------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/dashboard/main.tsx`                           | SPA entry                                      | App mount from `#root`                                                                                 |
| `src/dashboard/app.tsx`                            | Root component, routing, query provider        | `App`, `DashboardApp`, React Router `<Routes>`                                                         |
| `src/dashboard/server.ts`                          | Dashboard HTTP server (Bun.serve)              | `dashboardProgram`, `makeDashboardLayer`, `proxyEventStream`                                           |
| `src/dashboard/api.ts`                             | Typed API client                               | `createDashboardApi` — wraps all `/api/*` endpoints                                                    |
| `src/dashboard/handlers.ts`                        | Direct Effect-based request handlers           | `createDashboardHandlers` (in-process mode)                                                            |
| `src/dashboard/proxy-handlers.ts`                  | Proxy-mode request handlers                    | `createDashboardProxyHandlers` (standalone mode)                                                       |
| `src/dashboard/reads.ts`                           | Domain→DTO mapping + DashboardEngine interface | `DashboardEngine`, `mapRunDetail`, `mapRunSummary`, `mapEvent`, `mapPayloadMetadata`, `deriveStages`   |
| `src/dashboard/types.ts`                           | Dashboard DTO types                            | `RunDetailDto`, `RunSummaryDto`, `RunUnitDto`, `TimelineEventDto`, `PayloadMetadataDto`, `RunStageDto` |
| `src/dashboard/lib/dashboard-query.ts`             | TanStack Query definitions                     | `dashboardQueries`, `dashboardQueryKeys`, `dashboardApi` singleton                                     |
| `src/dashboard/lib/routing.ts`                     | Client-side route types + URL helpers          | `hrefForProject`, `hrefForRun`, `hrefForJob`, `parseDashboardRoute`                                    |
| `src/dashboard/lib/use-event-stream.ts`            | SSE hook                                       | `useEventStream`                                                                                       |
| `src/dashboard/lib/use-stream-query-refresh.ts`    | SSE-driven query refresh                       | `useStreamQueryRefresh`                                                                                |
| `src/dashboard/lib/run-status.ts`                  | Status→color/variant mapping                   | `badgeVariantForStatus`, `dotClassForStatus`, `displayStatus`                                          |
| `src/dashboard/lib/format.ts`                      | Formatting helpers                             | `formatDateTime`, `formatDuration`, `formatBytes`, `formatAge`, `truncateMiddle`                       |
| `src/dashboard/views/projects-page.tsx`            | Projects list + create dialog                  | `ProjectsPage`, `projectLabel`                                                                         |
| `src/dashboard/views/project-page.tsx`             | Project detail (tabs)                          | `ProjectPage` — Runs/Bindings/Secrets tabs                                                             |
| `src/dashboard/views/runs-page.tsx`                | Runs tab per project                           | `RunsTab`                                                                                              |
| `src/dashboard/views/run-page.tsx`                 | Run detail                                     | `RunPage` — Workflow/Timeline tabs                                                                     |
| `src/dashboard/views/job-page.tsx`                 | Job/unit detail                                | `JobPage` — Overview/Logs/Artifacts/Timeline tabs                                                      |
| `src/dashboard/views/project-bindings-tab.tsx`     | GitHub binding management                      | `ProjectBindingsTab`                                                                                   |
| `src/dashboard/views/project-secrets-tab.tsx`      | Secrets management                             | `ProjectSecretsTab`                                                                                    |
| `src/dashboard/components/run-pipeline.tsx`        | DAG pipeline view                              | `RunPipelineView` — SVG + stage columns                                                                |
| `src/dashboard/components/run-header.tsx`          | Run detail header                              | `RunHeader` — breadcrumb, status, actions (retry/cancel/GC)                                            |
| `src/dashboard/components/run-timeline.tsx`        | Run timeline wrapper                           | `RunTimeline`                                                                                          |
| `src/dashboard/components/timeline-event-list.tsx` | Event list with color coding                   | `TimelineEventList`, `eventDotClass`                                                                   |
| `src/dashboard/components/payload-browser.tsx`     | Log/artifact browser                           | `PayloadBrowser`, `PayloadViewer`                                                                      |
| `src/dashboard/components/app-shell.tsx`           | Layout shell                                   | `AppShell` — header, version badge, refresh button                                                     |
| `src/dashboard/styles.css`                         | Tailwind + shadcn CSS                          | Dark mode default, CSS variables                                                                       |
| `dashboard.ts`                                     | Standalone dashboard entry                     | Bun serve entrypoint                                                                                   |
| `tests/dashboard-ui.test.tsx`                      | UI smoke tests                                 | Pipeline render, header render, routing, API client                                                    |
| `tests/dashboard-handlers.test.ts`                 | Handler integration tests                      | Effect-based handler tests with mock Engine                                                            |
| `tests/dashboard-proxy-handlers.test.ts`           | Proxy handler tests                            | Proxy forwarding, binary passthrough                                                                   |

## 4. Actual responsibilities found in code

- **Project lifecycle:** list, create (local file + GitHub binding), edit name, delete (with cascade of runs/bindings/secrets/artifacts)
- **Run inspection:** detail view with stages, DAG dependency graph, per-unit overviews, resolved inputs, outputs, reports
- **Execution control:** start run (with optional JSON inputs), cancel, retry, GC artifacts
- **Log browsing:** per-run, per-unit, per-attempt; text payload viewing with line numbers; download raw
- **Artifact browsing:** per-run, per-unit, per-attempt; text/binary detection; inline text viewer; download raw; GC
- **Timeline events:** color-coded chronological event list across run and per-unit/attempt
- **GitHub binding management:** list, create with autocomplete for repositories, branches, workflow files via GitHub API
- **Secrets management:** list, create, delete
- **Live updates:** SSE stream (`/api/runs/stream`) triggers query invalidation
- **Two deployment topologies:** (1) standalone dashboard process proxying to engine service, (2) embedded in app server with direct Effect handlers

## 5. Core data structures, types, services, and APIs

| Name                           | Kind                         | Location                                        | Purpose                                                                                                                                                             | Upstream / downstream connections                                    |
| ------------------------------ | ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `RunDetailDto`                 | Interface (DTO)              | `src/dashboard/types.ts:156`                    | Full run detail — run summary, source context, stages, dependencies, units, events, artifacts, logs                                                                 | Consumed by RunPage, JobPage; produced by `mapRunDetail` in reads.ts |
| `RunSummaryDto`                | Interface (DTO)              | `src/dashboard/types.ts:1`                      | Run list entry — status, progress, control flags                                                                                                                    | Consumed by RunsTab; produced by `mapRunSummary`                     |
| `RunUnitDto`                   | Interface (DTO)              | `src/dashboard/types.ts:80`                     | Execution unit detail — attempts, inputs, outputs, reports, command, image                                                                                          | Consumed by JobPage, RunPipelineView                                 |
| `TimelineEventDto`             | Interface (DTO)              | `src/dashboard/types.ts:134`                    | Event with type, sequence, timestamp, unit/attempt/artifact/log refs                                                                                                | Consumed by TimelineEventList                                        |
| `PayloadMetadataDto`           | Interface (DTO)              | `src/dashboard/types.ts:118`                    | Log/artifact metadata — ref, size, checksum, expiry, age                                                                                                            | Consumed by PayloadBrowser                                           |
| `DashboardEngine`              | Interface (service contract) | `src/dashboard/reads.ts:22`                     | Effect-based Engine read/control contract — `listRuns`, `inspectRun`, `cancelRun`, `retryRun`, `gcRunArtifacts`, `readLogPayload`, `readArtifactPayload`, `version` | Implemented by Engine layer; consumed by `createDashboardHandlers`   |
| `createDashboardApi()`         | Factory                      | `src/dashboard/api.ts:95`                       | Typed fetch API client — list/create/update/delete for projects, runs, bindings, secrets, logs, artifacts                                                           | Consumed by all view components via `dashboardQueries`               |
| `dashboardQueries`             | Query configs                | `src/dashboard/lib/dashboard-query.ts:25`       | TanStack Query configs — 15 query definitions with keys + fetchers                                                                                                  | Consumed by all view components via `useQuery`                       |
| `useStreamQueryRefresh`        | Hook                         | `src/dashboard/lib/use-stream-query-refresh.ts` | SSE-driven React Query invalidation                                                                                                                                 | Consumed in ProjectsPage, RunsTab, RunPage, JobPage                  |
| `createDashboardHandlers`      | Factory (in-process)         | `src/dashboard/handlers.ts:7`                   | Effect → HTTP Response handler factory                                                                                                                              | Used by `server.ts` when dashboard runs embedded                     |
| `createDashboardProxyHandlers` | Factory (proxy)              | `src/dashboard/proxy-handlers.ts:5`             | fetch-based HTTP proxy to engine service                                                                                                                            | Used by `server.ts` when dashboard runs standalone                   |

## 6. Main runtime flows

### Flow A: Run inspection (user clicks on a run from project page)

1. User navigates to `/projects/:projectId` → ProjectPage renders RunsTab
2. RunsTab calls `dashboardQueries.projectRuns(projectId)` → `GET /api/runs?projectId=...`
3. User clicks a run link → navigates to `/runs/:runId` → RunPage
4. RunPage calls `dashboardQueries.runDetail(runId)` → `GET /api/runs/:runId`
5. Server handler (`handlers.ts:12`) merges 4 Effect calls: `inspectRun` + `readRunEvents` + `readArtifacts` + `readLogs`
6. Response assembled via `mapRunDetail` (`reads.ts:102`) — builds stages, maps events, artifacts, logs
7. RunPage renders RunHeader + tabs (Workflow/Timeline)
8. Pipeline view (`run-pipeline.tsx`) computes stage layout and renders SVG dependency curves + clickable unit cards
9. SSE on `/api/runs/stream` auto-refreshes when runId matches event data

**Evidence:**

- `src/dashboard/views/run-page.tsx:47` — `useQuery(dashboardQueries.runDetail(runId))`
- `src/dashboard/handlers.ts:12-21` — 4-way Effect.all merge
- `src/dashboard/views/runs-page.tsx:14` — `dashboardQueries.projectRuns`
- `src/dashboard/components/run-pipeline.tsx` — SVG DAG rendering

### Flow B: Job detail inspection (user clicks a unit in the pipeline)

1. User clicks a unit card in RunPipelineView → calls `onSelectUnit(unitId)`
2. Navigates to `/runs/:runId/jobs/:unitId` → JobPage
3. JobPage reuses the same `dashboardQueries.runDetail(runId)` as RunPage
4. Filters `detail.units.find(...)` for the target unit; filters logs/artifacts/events by unitId and attemptId
5. Renders tabs: Overview (execution details, inputs, outputs), Logs, Artifacts, Timeline
6. Log/artifact payload fetched lazily: `dashboardQueries.logPayload(ref)` / `dashboardQueries.artifactPayload(ref)`
7. Attempt selector (Select dropdown) filters scope — defaults to latest attempt

**Evidence:**

- `src/dashboard/views/job-page.tsx:50-52` — unit/attempt/scope selection
- `src/dashboard/views/job-page.tsx:66-77` — lazy payload queries with `enabled`
- `src/dashboard/views/job-page.tsx:291-311` — Logs tab with PayloadBrowser

### Flow C: Control action — Cancel/Retry/GC

1. RunPage renders RunHeader with Cancel/Retry/Clear buttons (conditionally shown per `detail.run.controls`)
2. Click triggers `actionMutation.mutateAsync(action)`
3. Calls `dashboardApi.cancelRun(runId, reason)` / `retryRun` / `gcRunArtifacts` → `POST /api/runs/:runId/cancel|retry|gc`
4. On retry success: navigates to new run URL (`result.runId`)
5. On cancel/GC success: invalidates query → re-renders with updated status

**Evidence:**

- `src/dashboard/views/run-page.tsx:56-82` — actionMutation
- `src/dashboard/components/run-header.tsx:104-135` — button rendering with `controls`
- `src/dashboard/handlers.ts:45-49` — cancel/retry/GC handlers

### Flow D: Project creation (local or GitHub)

1. ProjectsPage shows "Create Project" dialog with Local/GitHub tabs
2. Local: user provides workflow module path (autocomplete from discovered files), optional projectId and workspace path
3. GitHub: user provides repository (autocomplete from GitHub API), installation ID, workflow path, optional branch + subdir
4. Submit → `dashboardApi.createLocalProject(payload)` → `POST /api/projects` or `dashboardApi.createBinding(payload)` → `POST /api/bindings/github`
5. On success: invalidates project list, navigates to new project page

**Evidence:**

- `src/dashboard/views/projects-page.tsx:219-526` — create dialog
- `src/dashboard/views/projects-page.tsx:155-209` — mutation handlers

## 7. User-visible behavior / report-relevant behavior

- **Project list:** card grid with provider badge, binding count, run count, latest run status + timestamp; click navigates to project detail
- **Create project dialog:** two tabs (Local / GitHub) with autocomplete from discovered workflow files, GitHub repos, branches, workflow files
- **Project detail:** breadcrumb (Projects > name); header with project ID and actions (Run Now, Edit, Delete); three tabs: Runs / Bindings / Secrets
- **Run Now:** opens dialog with JSON input field; shows required inputs; POST to create run; navigates to run detail on success
- **Run detail:** breadcrumb (Projects > project > workflow); status badge, timestamps, duration, retried-from link; three action buttons (Retry / Cancel / Clear); two sub-tabs: Workflow (pipeline DAG) and Timeline (events)
- **Pipeline DAG view:** stage columns (left-to-right based on dependency resolution order); unit cards with status dot + badge; SVG Bézier curves for dependency edges; click navigates to job detail
- **Job detail:** breadcrumb (Projects > project > workflow > job name); status badge, timestamps, duration, failure/skip/cancellation messages; attempt selector (Select dropdown); four sub-tabs: Overview, Logs, Artifacts, Timeline
- **Overview tab:** execution details (image, command, working directory, dependencies, source location), resolved inputs, outputs (with format badges)
- **Logs tab:** two-panel browser (list + viewer); per-attempt toggle (button); line-numbered text view; download raw link
- **Artifacts tab:** same two-panel browser; text/binary detection; reports shown as badges on artifact items; download raw link
- **Timeline tab (run + job):** color-coded event list (progress=blue, success=green, warning=amber, failure=red, other=gray)
- **Bindings tab:** table of GitHub bindings (workflow module path, branch, workspace subdir, enabled/disabled badge, created date); "Add Binding" dialog with repository/branch/workflow file autocomplete
- **Secrets tab:** table of secrets (key, created, updated); add/delete dialogs; no value display (security)
- **Errors:** displayed as inline Alert (destructive variant) with error title + description
- **Loading:** simple "Loading..." text (no spinners/skeletons/progress bars)
- **Empty states:** descriptive messages ("No runs for this project", "No secrets for this project", etc.)
- **Live updates:** SSE on `/api/runs/stream` causes automatic re-fetch of active queries — no manual refresh needed for run status changes
- **Manual refresh:** "Refresh" button in header (invalidates all queries)
- **Inputs accepted:** JSON input values for run workflow; text for secrets values
- **Outputs produced:** Console log of server URL; HTTP responses; SSE stream proxied from engine
- **Errors/diagnostics surfaced:** 404 (RunNotFound, ArtifactNotFound, LogNotFound) → "not found"; 500 → error message from backend; validation errors in create forms

## 8. Dependencies and integrations

| Dependency / integration                                 | Used for                    | Location                                               | Notes                                                   |
| -------------------------------------------------------- | --------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `react` + `react-dom`                                    | UI framework                | `main.tsx`, all components                             | v19                                                     |
| `react-router-dom`                                       | Client-side routing         | `app.tsx` — BrowserRouter, Route, Routes               | 4 routes                                                |
| `@tanstack/react-query`                                  | Server state management     | `dashboard-query.ts`, all view components              | 15 query definitions                                    |
| `lucide-react`                                           | Icons                       | Various components                                     | Activity, Play, Square, RotateCcw, Trash2, Pencil, etc. |
| `react-hook-form` + `@hookform/resolvers/zod`            | Form handling               | projects-page, project-page, bindings-tab, secrets-tab | Resolver-based validation                               |
| `zod`                                                    | Schema validation           | Form schemas in views                                  | Repository regex, JSON parsing, etc.                    |
| `tailwindcss` + `tw-animate-css` + `shadcn/tailwind.css` | Styling                     | `styles.css`                                           | Dark mode default                                       |
| `clsx` + `tailwind-merge`                                | Class merging               | `utils.ts`                                             | `cn()` helper                                           |
| EventSource (browser API)                                | SSE for live updates        | `use-event-stream.ts`                                  | Connect to `/api/runs/stream`                           |
| Engine service API (HTTP)                                | All read/write operations   | `api.ts`, `proxy-handlers.ts`                          | REST endpoints                                          |
| `effect`                                                 | Effect system (server-side) | `handlers.ts`, `reads.ts`, `server.ts`                 | Effect-based handlers                                   |
| `@effect/platform-bun`                                   | Bun runtime for server      | `dashboard.ts`, `server.ts`                            | BunRuntime, BunServices                                 |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                                                  | Actual code evidence                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Dashboard provides "visibility into workflow structure, execution progress, failures, and outcomes" (PRD §5) | Full pipeline DAG, timeline, per-unit overview with inputs/outputs, per-attempt logs/artifacts                              |
| Dashboard provides "operational control" (PRD §5)                                                            | Cancel, retry, GC — all implemented via Engine-backed mutators                                                              |
| CLI and dashboard "share canonical Engine semantics" (ADR-0003)                                              | Both use `DashboardEngine` interface; `reads.ts` mapping is shared                                                          |
| "Interface must not become a persistence client" (ADR-0003)                                                  | Dashboard only accesses Engine via `DashboardEngine` interface or HTTP proxy to engine service, never directly reads stores |
| "Separate unrelated CLI and dashboard contracts were rejected" (ADR-0003)                                    | Both use same `DashboardEngine` interface contract                                                                          |
| Dashboard redesign mentioned in SDDS-0003                                                                    | No evidence of redesign; current implementation is production-grade                                                         |
| Dashboard should be "product-owned" (PRD)                                                                    | Dashboard is fully owned within the product codebase                                                                        |
| Workflow definition should be viewable in dashboard                                                          | Not implemented — no workflow source/definition viewer page                                                                 |

## 10. Limitations, shortcuts, and incomplete areas

- **No global runs page:** Runs are only viewable per-project; there's no standalone "All Runs" route or infinite-scroll list
- **No spinners/skeletons:** Loading states use plain text "Loading..." — no visual loading indicators (skeleton, spinner, progress bar)
- **No pagination:** Project/run lists fetch all data at once; no cursor/offset pagination
- **No polling fallback:** SSE is the only live-update mechanism; if SSE fails, no polling fallback
- **No unit tests for individual components:** Only one smoke test (`dashboard-ui.test.tsx`) uses `renderToStaticMarkup` — no `@testing-library/react` tests
- **Binding edit/delete:** No update or delete for existing bindings in the bindings tab
- **Secrets: no value masking in UI:** Secret values are not masked or obfuscated in the form UI (though never displayed in table)
- **No dark/light toggle:** Dashboard forces dark mode via `document.documentElement.classList.add("dark")` in `app.tsx:29`
- **No mobile-responsive layout:** The pipeline DAG requires horizontal scrolling; some layouts use flex-wrap but mobile testing is unverified
- **Error boundaries:** No React error boundary wrapping; unhandled render errors could blank the page
- **No toast notifications:** Success/error feedback appears in-page (Alert) rather than as toasts
- **No keyboard navigation:** Pipeline unit cards are buttons but no explicit keyboard support documented
- **No Storybook/Visual regression:** No component previews or visual tests
- **Pipeline stage derivation is algorithmic, not from plan:** `deriveStages` (`reads.ts:188`) computes stages from dependency graph client-side rather than using server-provided stage assignments
- **`project-queries.ts` filters locally:** `dashboardQueries.project()` and `dashboardQueries.projectBindings()` fetch all entities and filter client-side, not via server-side query params

## 11. What the final coursework report should say

**Safe claims:**

- Dashboard is a React SPA with 4 routes (projects, project detail, run detail, job detail) and 3 sub-tab systems
- Every page connects to real API data — no mocks, no placeholders, no hardcoded sample data
- Run inspection shows a DAG pipeline with stage columns, SVG dependency curves, and status-per-unit
- Logs and artifacts are scoped by run → unit → attempt with inline text viewing and download
- Three control actions implemented: cancel, retry, GC
- Project management: create (local + GitHub), edit name, delete with cascade
- Secrets and GitHub bindings have dedicated management tabs (CRUD)
- Live updates via SSE with automatic React Query invalidation
- Two deployment topologies: standalone proxy or embedded in app server
- 3 test files cover UI smoke, handler integration, and proxy forwarding
- Uses Effect v4 patterns for server-side handlers, TanStack Query for client state

**Claims to avoid:**

- Do NOT claim the dashboard is fully responsive or mobile-ready
- Do NOT claim comprehensive test coverage (1 smoke file, no component unit tests)
- Do NOT claim pagination or infinite scroll
- Do NOT claim workflow definition viewer exists
- Do NOT claim dark/light mode toggle exists
- Do NOT claim binding update/delete exists
- Do NOT claim toast notifications

**Suggested figures/tables/screenshots:**

1. Projects list page — card grid with provider badges and run counts
2. Create project dialog — two tabs (Local / GitHub) with autocomplete
3. Run detail with pipeline DAG — stage columns, SVG curves, status dots
4. Job detail — Overview tab — execution details, inputs, outputs with format badges
5. Job detail — Logs tab — two-panel browser with line-numbered text
6. Job detail — Artifacts tab — with report format badge
7. Timeline event view (run or job level) — color-coded event list
8. Secrets tab — table with add/delete
9. Bindings tab — table with add dialog
10. Architecture diagram showing: browser → Bun.serve → dashboard handlers OR proxy → engine service → engine stores

**Suggested appendix material:**

- Complete route table (4 routes × sub-tabs)
- API client endpoint list
- Test coverage summary (3 test files, ~20 test cases)
- Deployment modes comparison (standalone dashboard vs embedded)

## 12. Open questions for report writer

- Is the lack of pagination acceptable for V1 scope, or should it be called out as a limitation?
- Should the client-side filtering of projects/bindings (`listProjects().find()`) be flagged as a performance concern?
- Is the "dark mode only" approach intentional or pending work?
- Are there plans to add `@testing-library/react` component tests beyond the current smoke test?
- Is the missing binding edit/delete a planned future feature or intentional minimal scope?

## Context Report: GitHub Integration, Project Bindings, Triggers, Snapshots, and Project Isolation

### 1. Scope

- **Owned area**: GitHub App integration lifecycle (auth, webhooks, bindings, trigger matching, source snapshots, check runs), project identity derivation, project-aware run inspection, async webhook processing, snapshot isolation/retention.
- **Explicit exclusions**: Generic Engine run lifecycle after engine.submitRun(), executor command execution after workspace preparation, dashboard presentation details (except project/GitHub page existence), DSL design.
- **Related areas / handoff edges**: Engine.submitRun() / Engine.inspectRun() / engine.plan() from src/engine/interface.ts; WorkflowModuleLoader + DslMaterializer from src/dsl/; RunController scheduler from src/engine/run-controller.ts; StateStore from src/engine/stores/state-store.ts.

### 2. Implementation status

| Capability / responsibility                          | Status         | Evidence                                                       |
| ---------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| GitHub App JWT + installation token                  | IMPLEMENTED    | src/github/app-auth.ts:29-113                                  |
| GitHub REST API client                               | IMPLEMENTED    | src/github/api-client.ts:32-196                                |
| Webhook signature verification                       | IMPLEMENTED    | src/github/integration.ts:748-756                              |
| Webhook event processing (push)                      | IMPLEMENTED    | src/github/integration.ts:160-177                              |
| Webhook event processing (installation)              | IMPLEMENTED    | src/github/integration.ts:179-190                              |
| Webhook event processing (installation_repositories) | IMPLEMENTED    | src/github/integration.ts:191-206                              |
| Webhook event (pull_request)                         | NOT APPLICABLE | src/github/integration.ts:162 switch                           |
| Binding CRUD (memory + postgres)                     | IMPLEMENTED    | src/github/binding-store.ts                                    |
| Binding filtering for push events                    | IMPLEMENTED    | src/github/integration.ts:362-367                              |
| projectId derivation from repo                       | IMPLEMENTED    | src/domain/project.ts:29-34                                    |
| projectId persistence on all entities                | IMPLEMENTED    | Migration 0005_project_queueing                                |
| Duplicate webhook dedupe (durable)                   | IMPLEMENTED    | src/github/trigger-delivery-store.ts:72                        |
| In-flight trigger dedupe (fiber)                     | IMPLEMENTED    | src/github/integration.ts:435-439                              |
| Source snapshot (download + extract)                 | IMPLEMENTED    | src/github/source-snapshots.ts:67-124                          |
| Snapshot reuse                                       | IMPLEMENTED    | src/github/source-snapshots.ts:36-38                           |
| Snapshot path isolation by project                   | IMPLEMENTED    | src/github/source-snapshots.ts:31-32, src/domain/project.ts:36 |
| Snapshot retention (count-based)                     | IMPLEMENTED    | src/github/source-snapshots.ts:158-186                         |
| Snapshot retention (TTL/background)                  | STUB           | src/github/source-snapshots.ts:183 catch block                 |
| Async webhook processing                             | PARTIAL        | src/service/server.ts:143-172                                  |
| Check run create + sync lifecycle                    | IMPLEMENTED    | src/github/check-runs.ts                                       |
| Run link store (memory + postgres)                   | IMPLEMENTED    | src/github/run-link-store.ts                                   |
| Project-aware run inspection                         | IMPLEMENTED    | src/service/server.ts:437                                      |
| Project list API                                     | IMPLEMENTED    | src/service/server.ts:217                                      |
| CLI project/binding commands                         | IMPLEMENTED    | src/cli/index.ts:341-397                                       |
| Dashboard project page                               | IMPLEMENTED    | src/dashboard/views/projects-page.tsx                          |
| Dashboard binding tab                                | IMPLEMENTED    | src/dashboard/views/project-bindings-tab.tsx                   |
| Dashboard secret tab                                 | IMPLEMENTED    | src/dashboard/views/project-secrets-tab.tsx                    |

### 3. Main source locations

| Path                                         | Role in this area                 | Important symbols / entrypoints                                                                                                                                               |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/github/integration.ts                    | Core integration orchestrator     | GitHubIntegration, handleWebhook, triggerPush, acceptWebhook, processWebhook, handlePushEvent, triggerBinding, executeTriggeredBinding, verifyWebhookSignature                |
| src/github/app-auth.ts                       | GitHub App authentication         | GitHubAppAuth, createAppJwt, getInstallationToken                                                                                                                             |
| src/github/api-client.ts                     | GitHub REST API client            | GitHubApiClient, getRepository, downloadRepositoryArchive, listInstallationRepositories, listRepositoryBranches, listRepositoryWorkflowFiles, upsertCheckRun                  |
| src/github/binding-store.ts                  | Binding persistence               | GitHubBindingStore, create, list, listEnabledForPush, listProjects                                                                                                            |
| src/github/trigger-delivery-store.ts         | Webhook idempotency store         | GitHubTriggerDeliveryStore, create, get                                                                                                                                       |
| src/github/source-snapshots.ts               | Source snapshot acquisition       | GitHubSourceSnapshots, acquire, pruneSnapshots                                                                                                                                |
| src/github/check-runs.ts                     | GitHub Check Run lifecycle        | GitHubCheckRuns, registerRun, syncRun, watchRunUpdates, toGitHubCheckLifecycle                                                                                                |
| src/github/run-link-store.ts                 | Run ↔ check run link persistence  | GitHubRunLinkStore, create, get, update                                                                                                                                       |
| src/domain/github.ts                         | GitHub domain schemas             | GitHubBinding, GitHubBindingCreateRequest, GitHubBindingSummary, GitHubTriggeredRun, GitHubPushWebhookPayload, GitHubTriggerDelivery, GitHubRunLink, GitHubRepositorySnapshot |
| src/domain/project.ts                        | Project identity                  | deriveGitHubProjectId, sanitizeProjectPathSegment, projectIdForRunSummary                                                                                                     |
| src/domain/workflow-definition.ts            | Trigger declarations              | GitHubPushTriggerDeclaration, ManualTriggerDeclaration, TriggerDeclaration                                                                                                    |
| src/domain/errors.ts                         | Error types                       | GitHubBindingRejected, GitHubWebhookUnauthorized, GitHubConfigMissing, GitHubAuthFailed, GitHubApiFailed, SourceAcquisitionFailed                                             |
| src/domain/ids.ts                            | Branded ID types                  | BindingId, ProjectId                                                                                                                                                          |
| src/runtime/config.ts                        | Config                            | GitHubTriggerConfig (workspaceRoot, snapshotRetentionPerProject), GitHubAppConfig (appId, privateKey, webhookSecret, etc.)                                                    |
| src/runtime/storage.ts                       | DB migrations                     | Migrations 0001–0005 for github_bindings, github_run_links, github_trigger_deliveries, project_id columns                                                                     |
| src/runtime/storage-codecs.ts                | JSON codecs with migration        | encodeGitHubBinding, decodeGitHubBinding, encodeGitHubRunLink, encodeGitHubTriggerDelivery                                                                                    |
| src/service/server.ts                        | HTTP routes                       | handleGitHubWebhook, enqueueGitHubWebhook, drainGitHubWebhooks, routes at /api/bindings, /api/github/\*, /api/projects, /api/triggers/github                                  |
| src/cli/index.ts                             | CLI commands                      | bindings add github, bindings list, projects list                                                                                                                             |
| src/projects/local-project-store.ts          | Local project persistence         | LocalProjectStore                                                                                                                                                             |
| src/dashboard/views/projects-page.tsx        | Dashboard project list + creation | ProjectsPage                                                                                                                                                                  |
| src/dashboard/views/project-page.tsx         | Dashboard single project          | Tabs: runs, bindings, secrets                                                                                                                                                 |
| src/dashboard/views/project-bindings-tab.tsx | Dashboard bindings tab            | ProjectBindingsTab                                                                                                                                                            |
| tests/github-integration.test.ts             | Integration tests                 | Creates bindings, triggers, dedup, signature verification                                                                                                                     |
| tests/github-source-snapshots.test.ts        | Snapshot tests                    | Extraction, reuse, project isolation                                                                                                                                          |
| tests/github-check-runs.test.ts              | Check run lifecycle tests         | toGitHubCheckLifecycle mapping                                                                                                                                                |
| tests/github-app-auth.test.ts                | Auth tests                        | JWT signing, token caching                                                                                                                                                    |
| tests/project-scheduler.test.ts              | Scheduler tests                   | Concurrency limits, per-project caps, queued admission                                                                                                                        |

### 4. Actual responsibilities found in code

- GitHub App authentication: Creates RS256 JWTs for app identity, exchanges for installation access tokens, caches with expiry safety margin.
- GitHub API client: Wraps REST calls (repos, branches, workflow files, archive download, check runs) with installation token auth.
- Webhook signature verification: HMAC-SHA256 with constant-time comparison. Fails hard when secret is configured but signature is absent/mismatched.
- Webhook dispatch: Accepts push, installation, installation_repositories events. Push events trigger full pipeline; installation events are acknowledged only.
- Binding management: CRUD for GitHub repository → workflow module mappings. Filters enabled bindings by installation + repository + optional branch.
- Project identity derivation: Stable project ID from GitHub repository ID (or owner/name fallback). Persisted across all entities.
- Trigger matching: Before creating a run, checks that the workflow definition declares a GitHubPushTrigger and that the trigger's branch/ref/tag filters match.
- Source snapshot acquisition: Downloads commit-specific tarball from GitHub, extracts via tar, stores at project-scoped path.
- Snapshot isolation: Path structure <workspaceRoot>/<provider>/<sanitizedProjectId>/<commitSha> prevents collision.
- Snapshot retention: Count-based per-project pruning after each new snapshot materialization.
- Webhook deduplication: Durable idempotency key storage with ON CONFLICT DO NOTHING, plus in-flight fiber dedup to prevent concurrent duplicate triggers.
- Check run lifecycle: Creates GitHub Check Runs on trigger, syncs status changes via RunUpdates stream.
- Async webhook processing: Webhook endpoint returns 202 immediately; actual processing happens via in-memory queue drain.
- Project filtering: API, CLI, and dashboard support filtering runs by projectId and listing all projects.

### 5. Core data structures, types, services, and APIs

| Name                         | Kind              | Location                                | Purpose                                                                |
| ---------------------------- | ----------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| GitHubIntegration            | Service (Context) | src/github/integration.ts:46            | Orchestrates webhook, binding, trigger operations                      |
| GitHubBindingStore           | Service (Context) | src/github/binding-store.ts:14          | Persists and queries GitHub repository ↔ workflow bindings             |
| GitHubTriggerDeliveryStore   | Service (Context) | src/github/trigger-delivery-store.ts:10 | Dedupe store for webhook deliveries                                    |
| GitHubSourceSnapshots        | Service (Context) | src/github/source-snapshots.ts:12       | Acquires and prunes repository snapshots                               |
| GitHubCheckRuns              | Service (Context) | src/github/check-runs.ts:35             | Creates and syncs GitHub Check Runs                                    |
| GitHubRunLinkStore           | Service (Context) | src/github/run-link-store.ts:11         | Maps workflow runs to GitHub check runs                                |
| GitHubApiClient              | Service (Context) | src/github/api-client.ts:32             | GitHub REST API wrapper                                                |
| GitHubAppAuth                | Service (Context) | src/github/app-auth.ts:14               | JWT + installation token management                                    |
| GitHubBinding                | Schema class      | src/domain/github.ts:7                  | Binding data model (projectId, repo, branch, workflowModulePath, etc.) |
| GitHubTriggerDelivery        | Schema class      | src/domain/github.ts:157                | Deduplication record with idempotency key                              |
| GitHubTriggeredRun           | Schema class      | src/domain/github.ts:53                 | Response from triggered webhook (runId, checkRunId, deduped, paths)    |
| GitHubRunLink                | Schema class      | src/domain/github.ts:138                | Maps run to GitHub installation/repo/check run                         |
| GitHubPushWebhookPayload     | Schema class      | src/domain/github.ts:113                | Parsed GitHub push event payload                                       |
| GitHubPushTriggerDeclaration | Schema class      | src/domain/workflow-definition.ts:97    | DSL trigger declaration with branch/ref/tag filters                    |
| GitHubTriggerConfig          | Service (Config)  | src/runtime/config.ts:221               | workspaceRoot, snapshotRetentionPerProject                             |
| GitHubAppConfig              | Service (Config)  | src/runtime/config.ts:243               | appId, privateKey, webhookSecret, clientId, publicBaseUrl, apiBaseUrl  |
| deriveGitHubProjectId()      | Pure function     | src/domain/project.ts:29                | Derives stable project ID from repo identity                           |
| sanitizeProjectPathSegment() | Pure function     | src/domain/project.ts:36                | Makes project ID filesystem-safe                                       |

### 6. Main runtime flows

**Flow A: GitHub push webhook processing**

1. HTTP POST arrives at /api/github/webhooks or /api/triggers/github → handleGitHubWebhook() extracts x-github-event, x-hub-signature-256, x-github-delivery, and raw body.
2. gitHubIntegration.acceptWebhook() verifies signature (HMAC-SHA256), parses JSON body, validates against schema; returns 202 Accepted with GitHubTriggerResponse containing ignoredReason: "Webhook accepted for asynchronous processing".
3. enqueueGitHubWebhook() pushes the raw request onto an in-memory array and schedules drainGitHubWebhooks() for microtask.
4. drainGitHubWebhooks() processes the queue sequentially: for each item, calls gitHubIntegration.handleWebhook().
5. handleWebhook() re-verifies signature, re-parses body, dispatches on event type.
6. For push events → processWebhook() → handlePushEvent():
   - Rejects branch-delete pushes (all-zero commit SHA).
   - Extracts branch name from ref; rejects non-branch refs.
   - Queries bindingStore.listEnabledForPush(installationId, repositoryId, owner, name).
   - Filters by optional branch match.
   - If no bindings match, returns matchedBindings: 0.
   - For each matching binding → triggerBinding().
7. triggerBinding():
   - Computes idempotency key: github:<bindingId>:delivery:<deliveryId> or github:<bindingId>:push:<repoId>:<ref>:<sha>.
   - Checks triggerDeliveryStore.get(idempotencyKey) — if exists, returns existing run reference with deduped: true.
   - Checks in-flight fiber map — if already being processed, waits for result.
   - Forks executeTriggeredBinding() as a child fiber.
8. executeTriggeredBinding():
   - Acquires snapshot via sourceSnapshots.acquire() — downloads/extracts/caches.
   - Loads workflow module from snapshot path via WorkflowModuleLoader.
   - Materializes via DslMaterializer.
   - Checks supportsGitHubPushTrigger() — verifies workflow has a GitHubPushTrigger declaration and branch/ref/tag filters match.
   - If no matching trigger → returns undefined (ignored).
   - Annotates definition with trigger metadata, project metadata, source snapshot metadata.
   - Calls engine.plan() then engine.submitRun() — creates a queued run.
   - Persists trigger delivery record with the idempotency key.
   - Registers GitHub Check Run via gitHubChecks.registerRun().
   - Returns GitHubTriggeredRun with runId, checkRunId, paths.

**Evidence:**

- src/github/integration.ts:160-177 — event dispatch
- src/github/integration.ts:219-226 — handleWebhook (full processing)
- src/github/integration.ts:228-235 — acceptWebhook (fast return)
- src/github/integration.ts:319-407 — handlePushEvent
- src/github/integration.ts:409-459 — triggerBinding with dedup + in-flight tracking
- src/github/integration.ts:461-556 — executeTriggeredBinding
- src/service/server.ts:832-858 — HTTP handler + async enqueue
- src/service/server.ts:143-172 — drainGitHubWebhooks

**Flow B: Check run lifecycle sync**

1. GitHubCheckRuns.registerRun() is called from executeTriggeredBinding().
2. Creates a GitHubRunLink in the store mapping runId → binding/repo/ref/sha/checkRunId.
3. Calls gitHubApi.upsertCheckRun() (POST or PATCH) to create/update a GitHub Check Run with status queued.
4. Check run includes details_url pointing to the dashboard run page (if PUBLIC_BASE_URL is configured).
5. watchRunUpdates() subscribes to RunUpdates.stream() — whenever a run changes state (via Engine orchestrator).
6. For each update → syncRun() → reads the run link → fetches current WorkflowRunState → maps to check run lifecycle (toGitHubCheckLifecycle()).
7. Maps native statuses to GitHub check run status/conclusion:
   - queued → queued
   - running/canceling → in_progress
   - succeeded → completed/success
   - failed → completed/failure (or timed_out if failure message mentions timeout)
   - timed_out → completed/timed_out
   - canceled → completed/cancelled
   - interrupted → completed/neutral

**Evidence:**

- src/github/check-runs.ts:55-93 — registerRun
- src/github/check-runs.ts:95-103 — syncRun
- src/github/check-runs.ts:139-141 — watchRunUpdates
- src/github/check-runs.ts:152-206 — toGitHubCheckLifecycle
- src/github/api-client.ts:160-187 — upsertCheckRun (GitHub API call)

**Flow C: Source snapshot acquisition and retention**

1. GitHubSourceSnapshots.acquire() receives binding + ref + commitSha.
2. Computes path: <GITHUB_WORKSPACE_ROOT>/<provider>/<sanitizedProjectId>/<commitSha>.
3. If path already exists → reuses (no download).
4. If not → materializeSnapshot():
   - Creates temp directory.
   - Calls gitHubApi.downloadRepositoryArchive(installationId, owner, name, commitSha) → GitHub tarball endpoint.
   - Extracts via tar -xzf <archive> -C <target> --strip-components 1.
   - Renames extracted path to final snapshot path (atomic on same filesystem; fallback to reuse if racing).
   - Cleans up temp directory.
5. Checks workspace path exists (respects workspaceSubdir config).
6. Runs pruneSnapshots():
   - Reads all directories in project root.
   - Sorts by modification time (newest first).
   - Removes all except retentionCount - 1 newest (keeping the just-created one).
   - Retention default: 5 per project.

**Evidence:**

- src/github/source-snapshots.ts:28-59 — acquire
- src/github/source-snapshots.ts:67-124 — materializeSnapshot
- src/github/source-snapshots.ts:126-145 — runTarExtraction
- src/github/source-snapshots.ts:158-186 — pruneSnapshots

### 7. User-visible behavior / report-relevant behavior

- CLI commands: bindings add github <flags>, bindings list, projects list, runs list --project <id>, secrets set/get/list/delete (project-scoped).
- API endpoints:
  - POST /api/bindings/github — create binding (201)
  - GET /api/bindings — list bindings (200)
  - POST /api/github/webhooks — trigger webhook (202)
  - POST /api/triggers/github — same as above (202)
  - GET /api/github/installations/:id/repositories — list install repos (200)
  - GET /api/github/repositories/branches — list repo branches (200)
  - GET /api/github/repositories/workflows — list workflow files (200)
  - GET /api/projects — list all projects (200)
  - POST /api/projects — create local project (201)
  - GET /api/runs?projectId= — filter runs by project (200)
- Dashboard: Projects page with create dialog (local + GitHub forms), project detail page with runs/bindings/secrets tabs, SSE stream refresh for live updates.
- Inputs accepted:
  - GitHub push webhook payloads (JSON with ref, after, installation, repository fields).
  - Binding create requests (repository owner/name, installationId, workflowModulePath, optional branch/workspaceSubdir).
- Outputs produced:
  - GitHubTriggerResponse with event, matchedBindings, triggeredRuns[], ignoredReason.
  - GitHubTriggeredRun with runId, checkRunId, deduped, snapshotPath, workspacePath.
  - Check Runs on GitHub (queued → in_progress → completed with conclusion).
- Errors/diagnostics surfaced:
  - GitHubConfigMissing — when webhook secret is needed but not configured.
  - GitHubWebhookUnauthorized — signature mismatch/wrong secret.
  - GitHubBindingRejected — invalid repository format, path escapes snapshot root, API failure during binding resolution.
  - GitHubApiFailed — GitHub REST API HTTP errors.
  - SourceAcquisitionFailed — archive download failure, missing workspace subdir, module load/materialize failure.
  - StoreUnavailable — database errors on binding/delivery/run link persistence.

### 8. Dependencies and integrations

| Dependency / integration                              | Used for                                             |
| ----------------------------------------------------- | ---------------------------------------------------- |
| effect (v4 beta)                                      | Effect system, Schema, Context, Layer, Stream, Fiber |
| @effect/sql-pg                                        | PostgreSQL client, migrations                        |
| Bun.serve()                                           | HTTP server with routes                              |
| Bun.S3Client                                          | Object storage (unused in snapshot path)             |
| node:crypto (createHmac, createSign, timingSafeEqual) | Webhook sig verification, JWT signing                |
| GitHub REST API v3                                    | Repository data, archive download, check runs        |
| tar system command                                    | Archive extraction                                   |
| Docker (via executor)                                 | Unit execution in containers                         |
| smee-client (dev dep)                                 | Webhook forwarding for local dev                     |

### 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                                      | Actual code evidence                                                                                |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| GitHub webhook dedupe is durable (SDD §Idempotency)                                              | trigger-delivery-store.ts:72 ON CONFLICT (idempotency_key) DO NOTHING                               |
| projectId derivation: project:github:repo:<id> or project:github:<o>/<n> (SDD §Project Model)    | src/domain/project.ts:29-34                                                                         |
| projectId persisted on bindings, runs, run links, deliveries, snapshots (SDD §Project Model)     | Migration 0005_project_queueing; binding, runLink, delivery, snapshot schemas all include projectId |
| Snapshot path: <root>/<provider>/<sanitized projectId>/<commitSha> (SDD §Snapshot Isolation)     | src/github/source-snapshots.ts:31-32                                                                |
| Snapshot retention: count-based, runs after new snapshot, no background janitor (SDD §Retention) | src/github/source-snapshots.ts:158-186                                                              |
| Scheduler: global + per-project concurrency caps, fairness (SDD §Concurrency)                    | src/engine/run-controller.ts (tested in project-scheduler.test.ts)                                  |
| CLI: runs list --project, projects list (SDD §Inspection)                                        | src/cli/index.ts:169-172, src/cli/index.ts:381-388                                                  |
| API: GET /api/runs?projectId=, GET /api/projects (SDD §Inspection)                               | src/service/server.ts:437, src/service/server.ts:217                                                |
| No standalone projects table (SDD §Project Model)                                                | Only local_projects table exists; GitHub projects derived from bindings                             |
| Async webhook processing (PRD/PVD mentions background processing)                                | In-memory queue only, not durable (server.ts:143-172)                                               |

### 10. Limitations, shortcuts, and incomplete areas

- **In-memory async webhook queue**: pendingGitHubWebhooks is a regular array (src/service/server.ts:140). If the process crashes before drainGitHubWebhooks() processes an item, the webhook is lost. GitHub's built-in webhook retry mechanism (which sends a new distinct delivery with the same payload) would still be handled by idempotency for most cases.
- **No pull_request event handling**: The event switch at src/github/integration.ts:162 only handles push, installation, and installation_repositories. PR events fall through to the default case and return ignoredReason: "Unsupported GitHub event". There is no PR-based trigger in the DSL either (only GitHubPushTrigger).
- **No tag push trigger in DSL**: The GitHubPushTriggerDeclaration has branches, refs, and tags arrays for filtering, but the event processing path only supports branch-based refs. Tag pushes refs/tags/\* are processed but the trigger matching checks tags correctly.
- **Snapshot retention is count-only, no TTL**: pruneSnapshots() keeps N newest by mtime, but a very old snapshot with a recent mtime (e.g., reused via cache) is never cleaned. No background janitor.
- **No webhook re-delivery endpoint**: There is no manual "re-deliver webhook" API endpoint.
- **No GitHub OAuth flow**: clientId and clientSecret are read from config (src/runtime/config.ts:261-262) but never used in any code path.
- **Binding updates not supported**: GitHubBindingStore has create and list but no update or delete operations (though delete is supported indirectly through project deletion, and update can be done via binding_json in SQL).
- **No per-installation webhook secret**: Only a single global webhook secret is supported.
- **One binding per repo per workflow path**: There is no uniqueness constraint preventing duplicate bindings for the same repo+workflowModulePath combination (idempotency is delivery-scoped, not binding-scoped).

### 11. What the final coursework report should say

**Safe claims:**

- The system has a complete GitHub App integration with JWT auth, installation token caching, and HMAC-signed webhook verification.
- Push webhook events trigger a full pipeline: signature verification → binding matching → trigger filter → snapshot acquisition → workflow materialization → queued run → check run creation.
- Webhook deduplication is durable via PostgreSQL ON CONFLICT DO NOTHING on idempotency keys, with a composite key strategy (delivery ID preferred, payload content as fallback).
- In-flight deduplication prevents concurrent duplicate triggers via fiber tracking.
- Source snapshots are fully isolated per project: <root>/github/<sanitizedProjectId>/<commitSha>, preventing collisions between different repositories with the same commit SHA.
- Snapshot retention is configurable (default 5 per project), count-based, and best-effort.
- Check runs are created and synced from queued → in_progress → completed with correct status/conclusion mapping.
- Three webhook event types are handled: push (full processing), installation and installation_repositories (acknowledged only).
- Project identity is stable, derived from GitHub repo ID, and persisted across all entities (bindings, runs, run links, trigger deliveries, snapshots).
- Both CLI and dashboard support project listing, binding management, and project-filtered run inspection.
- Tests cover binding creation, webhook processing with dedup, signature verification, snapshot extraction/reuse/isolation, check run lifecycle mapping, and scheduler concurrency limits.

**Claims to avoid:**

- Do NOT claim that the system handles PR webhooks or PR triggers — only push events are fully supported.
- Do NOT claim that webhook processing is durable — the async queue is in-memory only and lost on crash.
- Do NOT claim that snapshot retention is TTL-based or has a background janitor — only count-based pruning on materialization.
- Do NOT claim there is a standalone projects table for GitHub projects — projects are derived from bindings.
- Do NOT claim that the system supports GitHub OAuth flows — the config keys exist but are unused.

**Suggested figures/tables/screenshots:**

- Architecture diagram of the push webhook pipeline: Webhook → verify → parse → match bindings → snap → load → materialize → trigger check → submitRun → check run sync.
- Table of idempotency key strategies.
- Entity-relationship diagram for projectId on bindings, runs, run links, trigger deliveries, snapshots.
- Screenshot of the dashboard Projects page showing both local and GitHub-backed projects.
- Screenshot of the project detail page showing the bindings tab.
- CLI output of bindings list and projects list commands.

**Suggested appendix material:**

- Full event-type dispatch table.
- PostgreSQL schema for github_bindings, github_run_links, github_trigger_deliveries.
- Test coverage matrix for the GitHub integration.

### 12. Open questions for report writer

- Should the in-memory async webhook queue be considered a critical limitation (lost on crash) or an acceptable design choice for a single-node CI/CD system? The SDD model is silent on delivery guarantees.
- Are installation and installation_repositories event handlers intentionally minimal, or is this an area for future work? The current code acknowledges but does not auto-configure bindings on new installations.
- Is the absence of pull_request triggers a deliberate MVP scope cut, or is it an unimplemented feature that the report should note as missing?
- The clientId/clientSecret config is declared but never referenced — is this a leftover, an incomplete feature, or intended for future OAuth flows?
- Snapshot count-based retention without TTL means very old snapshots never expire if they are the only ones under the limit — is this behavior intentional?

# Context Report: Secrets, Configuration, Environment Handling, and Security Boundaries

## 1. Scope

- **Owned area**: Secrets management (CRUD, encryption, storage, injection, redaction); environment configuration loading (env vars, defaults, precedence); security boundaries between layers (DSL/plan/executor/interface); CLI, API, and dashboard surfaces for secrets.
- **Explicit exclusions**: General auth/authorization (OAuth, JWT, session management); GitHub webhook signature verification (handed off to GitHub agent); business-level security claims unsupported by code.
- **Related areas / handoff edges**: Engine (orchestrator/executor) consumes secrets at dispatch time; DSL materialization keeps `SecretRef` references; project isolation uses `projectId` for scoping; CLI/API/dashboard are Engine-backed clients.

## 2. Implementation status

| Capability / responsibility                          |                                 Status | Evidence                                                                          | Notes                                                                                                                    |
| ---------------------------------------------------- | -------------------------------------: | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Secrets store service                                |                            IMPLEMENTED | `src/secrets/store.ts:12-195`                                                     | `SecretStore` with `memoryLayer` and `postgresLayer`                                                                     |
| AES-256-GCM encryption                               |                            IMPLEMENTED | `src/secrets/store.ts:198-280`                                                    | `SecretCipher` uses Web Crypto API                                                                                       |
| Master key from env                                  |                            IMPLEMENTED | `src/secrets/store.ts:282-295`                                                    | `Config.redacted("SECRETS_MASTER_KEY")`                                                                                  |
| Secret name validation                               |                            IMPLEMENTED | `src/secrets/store.ts:297-305`                                                    | Regex `^[A-Z][A-Z0-9_]*$`                                                                                                |
| Project-scoped secrets                               |                            IMPLEMENTED | `src/secrets/store.ts:317-325`                                                    | Composite key `projectId\0key`                                                                                           |
| DB migration for secrets                             |                            IMPLEMENTED | `src/runtime/storage.ts:332-351`                                                  | Creates `secrets` table with encrypted columns                                                                           |
| Secret error types                                   |                            IMPLEMENTED | `src/domain/errors.ts:81-95`                                                      | `SecretNotFound`, `SecretNameInvalid`, `SecretBackendUnavailable`                                                        |
| DSL `SecretRef` type                                 |                            IMPLEMENTED | `src/domain/secrets.ts:3-5`                                                       | Tagged class with `key` field                                                                                            |
| `SecretSummary` (no value)                           |                            IMPLEMENTED | `src/domain/secrets.ts:7-12`                                                      | `projectId`, `key`, `createdAt`, `updatedAt` only                                                                        |
| DSL `Job.secret()` builder                           |                            IMPLEMENTED | `src/dsl/public.ts:366-371`                                                       | Sets `env[name] = Secret.ref(key)`                                                                                       |
| DSL `Secret.ref()` helper                            |                            IMPLEMENTED | `src/dsl/public.ts:492-493`                                                       | Creates `SecretRef`                                                                                                      |
| Secret references in execution plans                 |                            IMPLEMENTED | `src/domain/execution-plan.ts:33`                                                 | `env` preserves `SecretRef`, not resolved                                                                                |
| Runtime secret resolution                            |                            IMPLEMENTED | `src/engine/orchestrator.ts:1024-1079`                                            | `buildDispatchRequest` resolves at dispatch time                                                                         |
| Secret injection into Docker env                     |                            IMPLEMENTED | `src/engine/executor.ts:170-229`                                                  | Passed via `--env NAME` (value in `env` map)                                                                             |
| `secretEnvNames` tracking                            |                            IMPLEMENTED | `src/engine/executor.ts:34`                                                       | `Schema.Array(Schema.String)` in `DispatchRequest`                                                                       |
| Log redaction                                        |                            IMPLEMENTED | `src/engine/orchestrator.ts:1132-1156`                                            | `redactText` replaces values with `[REDACTED]`                                                                           |
| Missing secret → clean failure                       |                            IMPLEMENTED | `src/engine/orchestrator.ts:1081-1101`                                            | `secretResolutionFailureResult` returns failed `ExecutorResult`                                                          |
| CLI `secrets set`                                    |                            IMPLEMENTED | `src/cli/index.ts:400-421`                                                        | `--from-env` flag, value never printed                                                                                   |
| CLI `secrets list`                                   |                            IMPLEMENTED | `src/cli/index.ts:423-429`                                                        | Metadata only, no values                                                                                                 |
| CLI `secrets delete`                                 |                            IMPLEMENTED | `src/cli/index.ts:431-443`                                                        | By projectId + key                                                                                                       |
| API POST `/api/secrets`                              |                            IMPLEMENTED | `src/service/server.ts:252`                                                       | `SecretSetRequest`, 201 No Content                                                                                       |
| API GET `/api/secrets?projectId=`                    |                            IMPLEMENTED | `src/service/server.ts:251`                                                       | Returns `Schema.Array(SecretSummary)`                                                                                    |
| API DELETE `/api/secrets/:projectId/:key`            |                            IMPLEMENTED | `src/service/server.ts:254-256`                                                   | 204 No Content                                                                                                           |
| `SecretsClient` (HTTP)                               |                            IMPLEMENTED | `src/service/client.ts:293-338`                                                   | Full CRUD via HTTP                                                                                                       |
| Dashboard secrets tab UI                             |                            IMPLEMENTED | `src/dashboard/views/project-secrets-tab.tsx:1-177`                               | Add/list/delete, never shows values                                                                                      |
| Dashboard routing for secrets                        |                            IMPLEMENTED | `src/dashboard/lib/routing.ts:115-116`                                            | `"secrets"` view in `ProjectPageView`                                                                                    |
| Dashboard API client                                 |                            IMPLEMENTED | `src/dashboard/api.ts:45-56, 127-131`                                             | `listSecrets`, `setSecret`, `deleteSecret`                                                                               |
| Config loading (all env vars)                        |                            IMPLEMENTED | `src/runtime/config.ts:1-303`                                                     | 9 config service classes, `Config.redacted` for sensitive values                                                         |
| `Config.redacted` wrapping                           |                            IMPLEMENTED | `src/runtime/config.ts:26,89, etc`                                                | `POSTGRES_URL`, `PGPASSWORD`, `S3_SECRET_KEY`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_SECRET` |
| Redaction of log summaries                           |                            IMPLEMENTED | `src/engine/orchestrator.ts:1132-1142`                                            | Both `content` and `summary` redacted                                                                                    |
| Redaction of failure messages                        |                                PARTIAL | `src/engine/orchestrator.ts:1081-1101`                                            | Failure message includes key (not value), but no general redaction of `failure.message`                                  |
| Redaction of events/run state                        |        IMPLEMENTED (verified in tests) | `tests/orchestrator.test.ts:191-192`                                              | `JSON.stringify(run)` and `JSON.stringify(events)` don't contain secret values                                           |
| In-memory secret store                               |                            IMPLEMENTED | `src/secrets/store.ts:21-82`                                                      | Plaintext in `Map` — no encryption                                                                                       |
| No audit logging for secrets                         | NOT_APPLICABLE (documented limitation) | Code search: no audit trail found                                                 | Not required at prototype stage                                                                                          |
| No secret key rotation                               | NOT_APPLICABLE (documented limitation) | `src/secrets/store.ts:282-295`                                                    | Single static master key                                                                                                 |
| No redaction of artifact payloads                    |                              NOT FOUND | `src/engine/orchestrator.ts` — `requestRedactionValues` only feeds `registerLogs` | Explicit gap                                                                                                             |
| No redaction of report payloads                      |                              NOT FOUND | Same analysis                                                                     | Explicit gap                                                                                                             |
| No redaction of derived/transformed secrets          |                   DOCUMENTED_NOT_FOUND | `README.md:365-366` — documented as known limitation                              | Deterministic string replacement cannot catch encoding transformations                                                   |
| Secrets for authored-workflow standalone DSL package |                            IMPLEMENTED | `packages/dsl/src/secrets.ts:1-8`                                                 | Duplicate `SecretRef` for `@effect-cicd/dsl`                                                                             |
| Config file loading (.env) by Bun                    |                            IMPLEMENTED | `AGENTS.md:14`, `.env` exists                                                     | Bun auto-loads `.env`, no dotenv library                                                                                 |
| Tests: secret resolution & scoping                   |                            IMPLEMENTED | `tests/orchestrator.test.ts:132-177`                                              | 2 tests                                                                                                                  |
| Tests: missing secret failure                        |                            IMPLEMENTED | `tests/orchestrator.test.ts:179-193`                                              | 1 test                                                                                                                   |
| Tests: log redaction                                 |                            IMPLEMENTED | `tests/orchestrator.test.ts:196-234`                                              | 1 test                                                                                                                   |
| Tests: CLI secrets                                   |                            IMPLEMENTED | `tests/cli.test.ts:607-663`                                                       | list and set tests                                                                                                       |
| Tests: API secrets                                   |                            IMPLEMENTED | `tests/service.test.ts:246-291`                                                   | Integration test                                                                                                         |
| Tests: DSL materialization                           |                            IMPLEMENTED | `tests/dsl-materializer.test.ts:231-248`                                          | Secret env references materialize                                                                                        |
| Tests: plan preserves SecretRef                      |                            IMPLEMENTED | `tests/planner.test.ts:208-228`                                                   | Not resolved early                                                                                                       |
| Tests: Config.redacted                               |                            IMPLEMENTED | `tests/storage-config.test.ts:25-30`                                              | Verifies `Redacted.value`                                                                                                |
| Tests: dashboard routing                             |                            IMPLEMENTED | `tests/dashboard-ui.test.tsx:58`                                                  | URL for secrets view                                                                                                     |

## 3. Main source locations

| Path                                            | Role in this area                       | Important symbols / entrypoints                                                                                        |
| ----------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/domain/secrets.ts`                         | Secret data types (domain model)        | `SecretRef`, `SecretSummary`, `isSecretRef`                                                                            |
| `src/domain/errors.ts:81-95`                    | Secret error types                      | `SecretNotFound`, `SecretNameInvalid`, `SecretBackendUnavailable`                                                      |
| `src/secrets/store.ts`                          | Secret storage service + encryption     | `SecretStore`, `SecretCipher`, `SecretEncryptionConfig`, `decodeMasterKey`, `validateSecretName`                       |
| `src/runtime/config.ts`                         | All config loading from env vars        | `PostgresConfig`, `ObjectStorageConfig`, `GitHubAppConfig`, `EngineServiceConfig`, etc                                 |
| `src/runtime/layers.ts`                         | DI composition                          | `secretLayer` composed into `Engine.layer`, `Orchestrator.layer`, etc                                                  |
| `src/runtime/storage.ts:332-351`                | DB migration `0004_secrets`             | Secrets table creation                                                                                                 |
| `src/engine/orchestrator.ts:1024-1156`          | Secret resolution, injection, redaction | `buildDispatchRequest`, `secretResolutionFailureResult`, `requestRedactionValues`, `redactRegisteredLog`, `redactText` |
| `src/engine/executor.ts:27-43`                  | Dispatch envelope with secret metadata  | `DispatchRequest.env`, `DispatchRequest.secretEnvNames`                                                                |
| `src/engine/executor.ts:170-229`                | Docker env injection                    | `executeDockerRequest` — passes all env as `--env NAME`                                                                |
| `src/dsl/public.ts:366-371,492-493`             | DSL entry points for secrets            | `Job.secret()`, `Secret.ref()`                                                                                         |
| `src/dsl/builders.ts:33`                        | DSL builder                             | `secret()`                                                                                                             |
| `src/domain/execution-plan.ts:33`               | Execution plan env type                 | `ContainerCommandDescriptor.env` preserves `SecretRef`                                                                 |
| `src/domain/workflow-definition.ts:114`         | Workflow definition env type            | `ContainerCommandDeclaration.env`                                                                                      |
| `src/dsl/authored-workflow.ts:75`               | Authored command env type               | `env?: Readonly<Record<string, string \| SecretRef>>`                                                                  |
| `src/service/contracts.ts:30-34`                | API request schema                      | `SecretSetRequest`                                                                                                     |
| `src/service/server.ts:250-257,441-455`         | HTTP API handlers                       | `setSecret`, `listSecrets`, route definitions                                                                          |
| `src/service/client.ts:293-338`                 | CLI/HTTP client for secrets             | `SecretsClient`                                                                                                        |
| `src/cli/index.ts:400-448`                      | CLI commands                            | `secretsSetCommand`, `secretsListCommand`, `secretsDeleteCommand`                                                      |
| `src/dashboard/views/project-secrets-tab.tsx`   | Dashboard secrets UI                    | `ProjectSecretsTab`                                                                                                    |
| `src/dashboard/views/project-page.tsx:501-520`  | Project page with secrets tab           | `Tabs` with "Secrets" trigger                                                                                          |
| `src/dashboard/api.ts:45-56,127-131`            | Dashboard API client                    | `SecretSummaryDto`, `SecretSetRequestDto`, `listSecrets`, `setSecret`, `deleteSecret`                                  |
| `src/dashboard/lib/dashboard-query.ts:18,82-86` | React Query integration                 | `dashboardQueries.projectSecrets`                                                                                      |
| `src/dashboard/lib/routing.ts:115-116`          | Routing for secrets view                | `ProjectPageView` includes "secrets"                                                                                   |
| `packages/dsl/src/secrets.ts`                   | Standalone DSL package secrets          | `SecretRef` (duplicate)                                                                                                |
| `packages/dsl/src/builders.ts:33`               | Standalone DSL package builder          | `secret()` (duplicate)                                                                                                 |
| `packages/dsl/src/public.ts`                    | Standalone DSL package public API       | `Job.secret()`, `Secret.ref()` (duplicate)                                                                             |
| `.env`                                          | Local dev env vars                      | `SECRETS_MASTER_KEY` and all config values                                                                             |
| `.env.demo`                                     | Template env file                       | Placeholder `SECRETS_MASTER_KEY`                                                                                       |
| `docs/self-hosting.md`                          | Self-hosting config documentation       | Config table (33 lines)                                                                                                |
| `README.md:284-373`                             | Product README secrets section          | Features, usage, guarantees, limitations                                                                               |

## 4. Actual responsibilities found in code

- **Secret domain types**: `SecretRef` (tagged class with key), `SecretSummary` (metadata only, no value), `isSecretRef` type guard
- **Secret errors**: `SecretNotFound`, `SecretNameInvalid`, `SecretBackendUnavailable` — all tagged errors with descriptive fields
- **SecretStore service**: Four operations (`setSecret`, `listSecrets`, `resolveSecret`, `deleteSecret`); two implementations (in-memory `Map` and Postgres-backed)
- **Encryption**: AES-256-GCM via Web Crypto API; master key from `SECRETS_MASTER_KEY` env var (base64, 32 bytes validated); deterministic encrypt/decrypt wrapped in `Effect`
- **Config loading**: 9 config service classes reading env vars via Effect's `Config` module; sensitive values use `Config.redacted()`
- **DSL secret declaration**: `Job.secret(name, key?)` → `Secret.ref(key)` → `SecretRef` in workflow definition env
- **Plan preservation**: `SecretRef` values survive planning — stored as-is in `ExecutionPlan.units[].env`
- **Dispatch-time resolution**: `buildDispatchRequest` iterates env entries, calls `secretStore.resolveSecret` for `SecretRef` values, builds `secretEnvNames` list
- **Executor env injection**: All resolved env (including secret values) passed to Docker as `--env NAME` arguments
- **Log redaction**: `requestRedactionValues` extracts plaintext secret values from `DispatchRequest.env`; `redactRegisteredLog` applies to both `content` and `summary`; `redactText` does `split(value).join("[REDACTED]")` sorted longest-first
- **CLI management**: Three subcommands (`set`, `list`, `delete`); `set` requires `--from-env` to avoid command-line value exposure; output never prints values
- **API endpoints**: Three routes — POST (create/update), GET (list metadata), DELETE (by project+key); responses never include secret values
- **Dashboard UI**: Add Secret dialog, secrets table (key/timestamps only, no values), delete confirmation; all via `SecretSummary` DTO
- **Secret scoping**: Composite key `projectId\0key`; Postgres table with `(project_id, secret_key)` primary key; different projects can reuse secret names
- **Missing secret handling**: `secretResolutionFailureResult` returns a failed `ExecutorResult` with `outcome: "failed"`, `exitCode: 1`; failure message includes the scoped key name but not the value
- **Project deletion cascades**: `DELETE FROM secrets WHERE project_id = ...` in server.ts

## 5. Core data structures, types, services, and APIs

| Name                       | Kind                 | Location                         | Purpose                                          | Upstream / downstream connections                                                           |
| -------------------------- | -------------------- | -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `SecretRef`                | Class (TaggedClass)  | `src/domain/secrets.ts:3-5`      | Placeholder reference in DSL/plan env            | Materialized by DSL, preserved in plan, resolved by `SecretStore.resolveSecret` at dispatch |
| `SecretSummary`            | Class (Schema class) | `src/domain/secrets.ts:7-12`     | Metadata response DTO (no value)                 | Returned by `listSecrets` to API/CLI/dashboard                                              |
| `SecretStore`              | Service (Context)    | `src/secrets/store.ts:12-195`    | CRUD operations for encrypted secrets            | Consumed by orchestrator, service handlers, CLI client                                      |
| `SecretCipher`             | Service (Context)    | `src/secrets/store.ts:198-280`   | AES-256-GCM encrypt/decrypt                      | Used by `SecretStore.postgresLayer`                                                         |
| `SecretEncryptionConfig`   | Service (Context)    | `src/secrets/store.ts:282-295`   | Provides master key from env                     | Provides to `SecretCipher.layer`                                                            |
| `DispatchRequest`          | Schema class         | `src/engine/executor.ts:27-43`   | Execution envelope with `env` + `secretEnvNames` | Created by `buildDispatchRequest`, consumed by executor                                     |
| `SecretSetRequest`         | Schema class         | `src/service/contracts.ts:30-34` | API request body for creating secrets            | Decoded in `POST /api/secrets` handler                                                      |
| `SecretsClient`            | Service (Context)    | `src/service/client.ts:293-338`  | HTTP client for secrets API                      | Used by CLI commands                                                                        |
| `SecretNotFound`           | Error (TaggedError)  | `src/domain/errors.ts:81-83`     | Raised when secret key not found                 | Returned by `resolveSecret`, `deleteSecret`                                                 |
| `SecretNameInvalid`        | Error (TaggedError)  | `src/domain/errors.ts:85-88`     | Raised for invalid secret name format            | Returned by validation                                                                      |
| `SecretBackendUnavailable` | Error (TaggedError)  | `src/domain/errors.ts:90-95`     | Encryption failure, SQL error, etc               | Returned by all store operations                                                            |
| `PostgresConfig`           | Service (Context)    | `src/runtime/config.ts:5-64`     | Postgres connection parameters                   | Used by SQL layer                                                                           |
| `ObjectStorageConfig`      | Service (Context)    | `src/runtime/config.ts:66-109`   | S3-compatible storage parameters                 | Used by artifact store                                                                      |
| `GitHubAppConfig`          | Service (Context)    | `src/runtime/config.ts:243-279`  | GitHub App credentials (redacted)                | Used by GitHub integration                                                                  |

## 6. Main runtime flows

### Flow A: Secret creation → encrypted storage

1. User sets secret via CLI (`secrets set project:alpha NPM_TOKEN --from-env NPM_TOKEN`) or API (`POST /api/secrets`) or dashboard UI
2. `SecretStore.setSecret(projectId, key, value)` is called
3. For `postgresLayer`: `validateSecretName(key)` rejects non-uppercase/underscore names; `SecretCipher.encrypt(value)` produces `{ ivBase64, ciphertextBase64 }`; SQL `INSERT ... ON CONFLICT DO UPDATE` persists to `secrets` table
4. For `memoryLayer`: plaintext value stored in `Map<string, {value, createdAt, updatedAt}>` keyed by `projectId\0key`
5. Returns `void` — no value in response

Evidence:

- `src/secrets/store.ts:92-125` (postgres setSecret)
- `src/secrets/store.ts:224-241` (encrypt)
- `src/cli/index.ts:400-421` (CLI set)
- `src/service/server.ts:441-445` (API set)
- `src/dashboard/views/project-secrets-tab.tsx:37-45` (dashboard set)

### Flow B: Secret resolution and injection at dispatch time

1. Orchestrator prepares to execute a plan unit
2. `buildDispatchRequest(secretStore, run, planUnit, attemptId, attemptNumber)` called
3. `projectId = run.projectId` determines secret scope
4. For each entry in `planUnit.payloadDescriptor.env`: if value is `SecretRef`, calls `secretStore.resolveSecret(projectId, value.key)` and pushes name to `secretEnvNames`; otherwise uses plain string
5. Constructs `DispatchRequest` with resolved `env` map + `secretEnvNames` array
6. Executor receives `DispatchRequest`, passes all `env` entries to Docker via `--env NAME` (value from env map)
7. `secretEnvNames` metadata reserved for redaction (not used by executor itself)

Evidence:

- `src/engine/orchestrator.ts:1024-1079` (buildDispatchRequest)
- `src/engine/executor.ts:170-229` (Docker env injection — only `--env NAME` passes values, not NAME=VALUE in args; values come from process env which includes the resolved map)
- `src/engine/executor.ts:220-228` (dockerArgs — `Object.keys(env).sort().flatMap(name => ["--env", name])`)

### Flow C: Log redaction after execution

1. Executor returns `ExecutorResult` with logs containing stdout/stderr text
2. Orchestrator's `registerLogs` receives `redactionValues: ReadonlyArray<string>`
3. `requestRedactionValues(request)` extracts plaintext secret values from `DispatchRequest.env` using `secretEnvNames` as index
4. For each log: `redactRegisteredLog(log, redactionValues)` applies `redactText` to both `log.content` and `log.metadata.summary`
5. `redactText` sorts values by length descending, replaces each with `"[REDACTED]"` using `split(value).join("[REDACTED]")`
6. Redacted logs are passed to `ArtifactStore.writeLogPayload` for persistent storage

Evidence:

- `src/engine/orchestrator.ts:1125-1156` (redaction functions)
- `src/engine/orchestrator.ts:709-727` (registerLogs — use site)
- `tests/orchestrator.test.ts:196-234` (verification test)

## 7. User-visible behavior / report-relevant behavior

- **Default shell used by Bun**: zsh (as specified in tool environment)
- **Config loading**: Bun auto-loads `.env`; Docker Compose also passes `.env` to app container; no other config file (YAML/JSON/TOML) for app
- **Required env vars to run**: `POSTGRES_URL` (or split PGHOST/PGPORT/etc), `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `SECRETS_MASTER_KEY`; optional: 30+ other vars with defaults
- **CLI input for secrets**: `bun run index.ts secrets set <projectId> <key> --from-env <VAR>` — value read from environment, never CLI arg
- **CLI output for secrets**: `secrets set` prints `project: x\nsecret: y\nstatus: stored`; `secrets list` prints key + timestamps only
- **API input for secrets**: `POST /api/secrets` with JSON body `{ projectId, key, value }` — plaintext over HTTPS
- **API output for secrets**: GET returns `Array<{projectId, key, createdAt, updatedAt}>` — no values; DELETE returns 204; POST returns 201 No Content
- **Dashboard secrets UI**: Add dialog (key + value), table (key + timestamps + delete), delete confirmation — values never displayed
- **Errors surfaced**:
  - `SecretNotFound`: `Secret <projectId>:<key> not found` — visible in failure message
  - `SecretNameInvalid`: validation error with regex requirement
  - `SecretBackendUnavailable`: generic "Failed to ..." message
  - Missing → unit fails with `outcome: "failed"`, `exitCode: 1`, failure message contains scoped key
- **Log output**: Secret values replaced with `[REDACTED]` in both content and summary

## 8. Dependencies and integrations

| Dependency / integration                | Used for                                              | Location                                      | Notes                                                          |
| --------------------------------------- | ----------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| Effect `Config` module                  | Reading env vars with defaults, redaction, validation | `src/runtime/config.ts`                       | All config classes; `Config.redacted()` wraps sensitive values |
| Web Crypto API (`crypto.subtle`)        | AES-256-GCM encryption/decryption                     | `src/secrets/store.ts:224-275`                | Node.js runtime; `aes-256-gcm` algorithm                       |
| Effect `SqlClient` (Postgres)           | Durable secret storage                                | `src/secrets/store.ts:84-195`                 | `postgresLayer` requires `SqlClient`                           |
| Effect `HttpClient` / `FetchHttpClient` | SecretsClient HTTP calls                              | `src/service/client.ts:293-338`               | CLI communicates with service                                  |
| Bun `.env` auto-load                    | Config loading from env file                          | `AGENTS.md:14`                                | No dotenv library needed                                       |
| Docker                                  | Container execution — env injection                   | `src/engine/executor.ts:170-229`              | Secrets passed as `--env`                                      |
| shadcn/ui (React)                       | Dashboard secrets UI components                       | `src/dashboard/views/project-secrets-tab.tsx` | Dialog, AlertDialog, Table, Button, etc                        |
| @tanstack/react-query                   | Dashboard data fetching for secrets                   | `src/dashboard/lib/dashboard-query.ts`        | `useQuery`, `useMutation`                                      |
| Docker Compose                          | Infra: Postgres, MinIO                                | `compose.yml`, `compose.demo.yml`             | Service env from `.env` file                                   |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                     | Actual code evidence                                                                                                     | Classification                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Secrets encrypted at rest with `SECRETS_MASTER_KEY`                             | IMPLEMENTED: `SecretCipher` with AES-256-GCM; master key from `Config.redacted("SECRETS_MASTER_KEY")`                    | IMPLEMENTED                                  |
| Secret names isolated by `projectId`                                            | IMPLEMENTED: composite key `(project_id, secret_key)` PK in DB; `toScopedKey` in memory store                            | IMPLEMENTED                                  |
| Workflow definitions and plans keep `SecretRef`, not resolved values            | IMPLEMENTED: `src/domain/execution-plan.ts:33` retains `SecretRef`; tested in `tests/planner.test.ts:208-228`            | IMPLEMENTED                                  |
| Secret values resolved only when building dispatch requests                     | IMPLEMENTED: `buildDispatchRequest` in `src/engine/orchestrator.ts:1036-1043` resolves at dispatch time                  | IMPLEMENTED                                  |
| Run state / events / CLI / dashboard never contain resolved secret values       | IMPLEMENTED: `tests/orchestrator.test.ts:191-192` verifies; `SecretSummary` excludes value; CLI never prints value       | IMPLEMENTED                                  |
| Persisted logs redact secret values                                             | IMPLEMENTED: `redactText` + `redactRegisteredLog`; tested in `tests/orchestrator.test.ts:196-234`                        | IMPLEMENTED                                  |
| CLI `secrets set` reads from env, not command line                              | IMPLEMENTED: `--from-env` flag in `src/cli/index.ts:400-421`                                                             | IMPLEMENTED                                  |
| `SECRETS_MASTER_KEY` required on startup                                        | IMPLEMENTED: `Config.redacted("SECRETS_MASTER_KEY")` — no default, will fail if absent                                   | IMPLEMENTED                                  |
| Secret scope uses workflow `metadata.projectId` when present, else `workflowId` | IMPLEMENTED: `projectIdForRun` in `src/engine/orchestrator.ts:1158-1163`; tested at `tests/orchestrator.test.ts:153-177` | IMPLEMENTED                                  |
| Postgres + S3 readiness check (`readyz`)                                        | IMPLEMENTED: separate endpoint in service server                                                                         | PARTIAL (not secrets-specific)               |
| Dashboard does not access Postgres or MinIO directly                            | IMPLEMENTED: dashboard talks only to proxy → service API                                                                 | IMPLEMENTED                                  |
| CLI is Engine-backed, does not read Postgres/MinIO directly                     | IMPLEMENTED: `SecretsClient` communicates via HTTP; `src/cli/index.ts:50-53` layers `FetchHttpClient`                    | IMPLEMENTED                                  |
| Executor never writes authoritative workflow state directly                     | IMPLEMENTED: executor returns `ExecutorResult`, orchestrator persists                                                    | IMPLEMENTED                                  |
| If user command transforms a secret before printing, derived value not caught   | NOT FOUND: `redactText` does exact string match; no heuristic/pattern redaction                                          | DIFFERENT (documented limitation, not a gap) |

## 10. Limitations, shortcuts, and incomplete areas

- **In-memory secret store stores plaintext** (`src/secrets/store.ts:21-82`): `SecretStore.memoryLayer` keeps values in a `Map<string, {value: string}>` — no encryption. Only `postgresLayer` encrypts. Used in all tests.
- **No canonical layer for production**: `src/runtime/layers.ts` composes `SecretStore.postgresLayer` for durable storage, `SecretStore.memoryLayer` for in-memory. The correct production layer must be selected at startup; no guardrail prevents accidentally using memory.
- **Log redaction is post-hoc, not at source**: Secrets are fully present in Docker stdout/stderr at execution time. Redaction happens after the orchestrator receives logs. If the executor writes to any other output channel (e.g., artifacts derived from stdout), secrets could leak.
- **No redaction of artifact payloads**: `src/engine/orchestrator.ts:1125-1156` — `requestRedactionValues` only feeds `registerLogs`. Artifact/report content is not redacted.
- **No redaction of failure messages**: `secretResolutionFailureResult` includes the scoped key name in `failure.message` (e.g., "Secret workflow:missing-secret:NPM_TOKEN not found"). While the value is not present, the key name is information disclosure. More critically, regular execution failures store stdout/stderr in `failure.message` via `summarizeUnitFailure` — those are not redacted.
- **No redaction of event history by the function itself**: Tests verify that `JSON.stringify(events)` doesn't contain secret values, but this is achieved by never storing raw secret values in state (they are ephemeral in `DispatchRequest.env`). However, events store `failure.message` which for secret resolution failures includes the key name.
- **No audit trail**: No logging or tracking of who read, listed, created, or deleted secrets.
- **No key rotation**: Single hard-coded `SECRETS_MASTER_KEY`; no support for re-encrypting existing secrets or key versioning.
- **CLI `secrets set` without `--from-env` not possible**: The `--from-env` flag is required; there is no direct value argument. This is intentional but means the user must have the value in an env var.
- **Validation gap in dashboard secret value min length**: `z.string().min(1)` — allows whitespace-only values. Backend does not validate content beyond requiring non-empty.
- **Docker env injection passes all env as `--env NAME` (not `NAME=VALUE`)**: `src/engine/executor.ts:225-227` — values come from the process env via `ChildProcess.make` with `env` option. This means secret values are set as environment variables in the child process, which is standard but means `/proc` inspection or `printenv` within the container will show them.
- **`Config.redacted` memory safety**: Values wrapped in `Redacted.Redacted` are only protected from accidental serialization (e.g., `JSON.stringify` returns `"[Redacted]"`), not from debugger inspection or memory dumps.

## 11. What the final coursework report should say

### Safe claims

1. **Secrets are encrypted at rest** using AES-256-GCM with a base64-encoded 32-byte master key from a required env var (`SECRETS_MASTER_KEY`). Implementation at `src/secrets/store.ts:198-280`.
2. **Secrets are scoped by project** — composite primary key `(project_id, secret_key)` in Postgres, preventing cross-project leakage. Verified at `src/secrets/store.ts:100-117` (SQL) and `src/secrets/store.ts:317-318` (in-memory scoped key).
3. **Secret values never appear in API responses** — all list/read endpoints return `SecretSummary` (key + timestamps only). Verified at `src/domain/secrets.ts:7-12`.
4. **CLI never prints secret values** — `secrets set` reports status only; `secrets list` shows metadata only. Verified at `src/cli/index.ts:400-429`.
5. **Dashboard UI never displays secret values** — Add Secret form sends value but does not echo it; secrets table only shows key/timestamps. Verified at `src/dashboard/views/project-secrets-tab.tsx`.
6. **Workflow definitions and plans store `SecretRef` references, not plaintext** — Secret resolution is deferred to dispatch time. Verified at `src/domain/execution-plan.ts:33` and `tests/planner.test.ts:208-228`.
7. **Persisted stdout/stderr logs have secret values redacted** — `redactText` replaces with `[REDACTED]` before storage. Verified at `src/engine/orchestrator.ts:1132-1156` and `tests/orchestrator.test.ts:196-234`.
8. **Missing secrets fail the unit gracefully** — `secretResolutionFailureResult` produces a failed outcome without crashing the orchestrator. Verified at `src/engine/orchestrator.ts:1081-1101`.
9. **Sensitive config values use `Config.redacted()`** — 6 env vars (`POSTGRES_URL`, `PGPASSWORD`, `S3_SECRET_KEY`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_SECRET`) plus `SECRETS_MASTER_KEY`. Verified at `src/runtime/config.ts`.
10. **Bun auto-loads `.env`** — No additional config file loading infrastructure. Verified at `AGENTS.md:14`.

### Claims to avoid

- Do not claim "secrets are fully secure" — the system uses encryption at rest, but secrets are in-memory plaintext in the engine process during execution.
- Do not claim "comprehensive audit logging" — there is none.
- Do not claim "secrets are redacted everywhere" — artifact payloads, report payloads, and failure messages are not redacted.
- Do not claim "master key rotation is supported" — it is not.
- Do not claim "the in-memory store is production-ready" — it stores plaintext.

### Suggested figures/tables/screenshots

1. **Secrets table screenshot** — from `examples/dashboard.secrets`, or generate one showing the dashboard secrets tab (key/timestamps table, Add Secret button, delete confirm dialog).
2. **Architecture diagram** — secret flow: DSL `Secret.ref()` → plan preserves `SecretRef` → `buildDispatchRequest` resolves via `SecretStore` → `DispatchRequest` with `env` + `secretEnvNames` → Executor Docker `--env` → log redaction.
3. **Secrets table migration** — the `0004_secrets` migration creating the `secrets` table with `algorithm`, `iv_base64`, `ciphertext_base64` columns.
4. **Redaction code snippet** — `redactText` and `redactRegisteredLog` showing the deterministic replacement.

### Suggested appendix material

- Full env var reference table (from `docs/self-hosting.md` combined with `src/runtime/config.ts`)
- CLI secrets subcommand help text
- API secrets routes summary
- Test coverage breakdown

## 12. Open questions for report writer

1. **Should the report call out test gap for artifact/report redaction?** No unit test verifies that artifact payloads or report payloads are redacted or not. Should this be mentioned as a finding or considered out of scope?
2. **The `SecretSummary` type includes `projectId` but the DB migration initially had `secret_key` as the sole primary key** before migrating to composite `(project_id, secret_key)`. Is this migration detail worth including as evidence of evolving design?
3. **The GitHub webhook secret (`GITHUB_WEBHOOK_SECRET`) is loaded via `Config.redacted` and used for HMAC verification** — should this be included as a tangential security boundary (handoff to GitHub agent), or fully excluded?

# Context Report: Testing, validation, demo evidence, and quality status

## 1. Scope

- **Owned area**: Test infrastructure, automated test suite, demo automation, build health, quality assurance evidence
- **Explicit exclusions**: Re-explaining subsystem internals owned by other agents; writing new tests; running destructive commands
- **Related areas / handoff edges**: Engine (orchestrator, executor, planner tests verify correctness); DSL & DSL materializer tests verify normalization; CLI tests verify command routing; Service tests verify HTTP boundary; Dashboard tests verify UI/proxy; GitHub integration tests verify webhook loop; Project scheduler tests verify concurrency

## 2. Implementation status

| Capability / responsibility          |          Status | Evidence                                              | Notes                                                                                   |
| ------------------------------------ | --------------: | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Test framework integration           |     IMPLEMENTED | `vitest.config.ts:1-7`                                | Vitest with `@effect/vitest` (`it.effect`, `it.live`)                                   |
| Engine unit tests (orchestrator)     |     IMPLEMENTED | `tests/orchestrator.test.ts` — 28 tests               | 3 describe blocks: Orchestrator, RunController, CancellationPolicy                      |
| Engine unit tests (planner)          |     IMPLEMENTED | `tests/planner.test.ts` — 12 tests                    | Validation errors, cycle detection, retry/timeout, triggers, escape-to-parent rejection |
| Engine unit tests (executor)         |     IMPLEMENTED | `tests/executor.test.ts` — 7 tests                    | Deterministic test layer, Docker integration (gated)                                    |
| Engine integration tests (interface) |     IMPLEMENTED | `tests/engine-interface.test.ts` — 10 tests           | 9 `it.effect` + 1 `it.live` cancellation test                                           |
| DSL materializer tests               |     IMPLEMENTED | `tests/dsl-materializer.test.ts` — 9 tests            | Minimal/missing/error cases, secret refs, Planner integration                           |
| Workflow loader tests                |     IMPLEMENTED | `tests/workflow-loader.test.ts` — 5 tests             | Default/named/missing exports, package imports                                          |
| CLI tests                            |     IMPLEMENTED | `tests/cli.test.ts` — 16 tests                        | Validate/plan/run/list/show/cancel/artifacts/logs/bindings/secrets                      |
| Service (HTTP) tests                 |     IMPLEMENTED | `tests/service.test.ts` — 10 tests                    | All `it.live` — real HTTP servers, request/response boundary                            |
| Dashboard handler tests              |     IMPLEMENTED | `tests/dashboard-handlers.test.ts` — 3 tests          | listRuns, inspectRun, cancelRun                                                         |
| Dashboard proxy handler tests        |     IMPLEMENTED | `tests/dashboard-proxy-handlers.test.ts` — 5 tests    | Mocked fetch, request forwarding                                                        |
| Dashboard UI tests                   |     IMPLEMENTED | `tests/dashboard-ui.test.tsx` — 10 tests              | Static markup rendering, route parsing, API client mock                                 |
| GitHub integration tests             |     IMPLEMENTED | `tests/github-*.test.ts` — 11 tests across 5 files    | App auth, check runs, webhooks, bindings, snapshots                                     |
| Project scheduler tests              |     IMPLEMENTED | `tests/project-scheduler.test.ts` — 5 tests           | Concurrency limits, per-project fairness, queuing                                       |
| Artifact GC tests                    |     IMPLEMENTED | `tests/artifact-gc.test.ts` — 4 tests                 | Expiry, fresh-artifact skip, manual API deletion, combined GC                           |
| Storage integration tests            |     IMPLEMENTED | `tests/storage.integration.test.ts` — 4 tests         | Gated by `RUN_STORAGE_TESTS=1`, needs Postgres/MinIO/Docker                             |
| Contracts/domain type tests          |     IMPLEMENTED | `tests/contracts.test.ts` — 5 tests                   | Branded IDs, events, service tags                                                       |
| Storage config round-trip tests      |     IMPLEMENTED | `tests/storage-config.test.ts` — 2 tests              | Env parsing, encode/decode round-trip                                                   |
| Example project tests                |     IMPLEMENTED | `examples/demo-project/tests/index.test.ts` — 2 tests | Uses `bun:test`, not `@effect/vitest`                                                   |
| Demo walkthrough automation          | DOCUMENTED_ONLY | `README.md:64-218`                                    | CLI commands and curl examples, no standalone demo script                               |
| Code coverage reporting              | NOT_IMPLEMENTED | `vitest.config.ts:1-7`                                | No coverage reporter configured                                                         |
| CI pipeline for quality gates        | NOT_IMPLEMENTED | —                                                     | No `.github/`, `Jenkinsfile`, `.gitlab-ci.yml`                                          |
| Performance/stress tests             | NOT_IMPLEMENTED | —                                                     | Not present in any test file                                                            |
| Security tests                       | NOT_IMPLEMENTED | —                                                     | No SAST/DAST/sca config found                                                           |

## 3. Main source locations

| Path                                  | Role in this area       | Important symbols / entrypoints                                                                                                  |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `vitest.config.ts`                    | Test runner config      | `test.include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]`                                                                    |
| `tests/` (22 files + fixtures)        | All automated tests     | 0 `.skip`/`.todo`/`.only` across ~148 tests                                                                                      |
| `tests/fixtures/workflows/` (5 files) | Test workflow fixtures  | `valid-workflow.ts`, `invalid-export.ts`, `materialization-error.ts`, `github-trigger-workflow.ts`, `package-import-workflow.ts` |
| `examples/demo-workflow.ts`           | Demo workflow (3 units) | Used in E2E test `tests/storage.integration.test.ts` test 4                                                                      |
| `examples/demo-project/`              | Demo workspace          | Source, tests, dist (built), `release.json` artifact                                                                             |
| `compose.demo.yml`                    | Local dev infra         | Postgres 16 + MinIO + minio-init                                                                                                 |
| `compose.yml`                         | Production deployment   | App + Postgres + MinIO + minio-init                                                                                              |

## 4. Actual responsibilities found in code

- **~148 test cases** across 22 test files plus 1 example project test file
- **20 `it.live` real-side-effect tests** (HTTP servers, file I/O, Docker) guarded by env variables
- **105 `it.effect` Effect-native deterministic tests** using in-memory test layers
- **23 synchronous `it` tests** for pure domain logic
- **5 test fixtures** providing sample workflow modules for loader/materialization tests
- **1 manual demo walkthrough** documented in README (CLI commands + curl + dashboard)
- **Zero skipped, todo, or focused tests** — entire suite is active and intended to pass
- **Zero TODO/FIXME/HACK/XXX annotations** in any source or test file

## 5. Core data structures, types, services, and APIs

| Name                              | Kind           | Location                            | Purpose                                        | Upstream / downstream connections                                                                                                      |
| --------------------------------- | -------------- | ----------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest` + `@effect/vitest`       | Test framework | `package.json`, `vitest.config.ts`  | Run `it.effect` and `it.live` DSL tests        | All test files import from `@effect/vitest`                                                                                            |
| `Executor.testLayer()`            | Test double    | `src/engine/executor.ts`            | Deterministic executor for orchestrator tests  | `tests/orchestrator.test.ts`, `tests/engine-interface.test.ts`, `tests/project-scheduler.test.ts`, `tests/storage.integration.test.ts` |
| `RunUpdates.noopLayer`            | No-op layer    | `src/engine/run-updates.ts`         | Suppresses SSE run updates in tests            | Many test runtime layer compositions                                                                                                   |
| `TestConsole.layer`               | Test console   | `effect/testing`                    | Captures CLI output                            | `tests/cli.test.ts`, `tests/storage.integration.test.ts`                                                                               |
| `TestClock`                       | Virtual clock  | `effect/testing`                    | Time manipulation in tests                     | `tests/orchestrator.test.ts`, `tests/project-scheduler.test.ts`                                                                        |
| `storageIntegrationEnabled`       | Gate flag      | `tests/storage.integration.test.ts` | Checks `RUN_STORAGE_TESTS=1`                   | Guards Postgres/S3-backed tests                                                                                                        |
| `dockerStorageIntegrationEnabled` | Gate flag      | `tests/storage.integration.test.ts` | Checks `docker info` + flags                   | Guards Docker E2E test                                                                                                                 |
| `dockerIntegrationEnabled`        | Gate flag      | `tests/executor.test.ts`            | Checks `docker info` at import                 | Guards real container execution test                                                                                                   |
| `startServiceServer`              | Test helper    | `src/service/server.ts`             | Create HTTP server for integration tests       | `tests/service.test.ts`, `tests/artifact-gc.test.ts`, `tests/github-service.test.ts`                                                   |
| `makeInMemoryServiceEngineLayer`  | Layer factory  | `src/runtime/layers.ts`             | In-memory engine composition for service tests | `tests/service.test.ts`, `tests/github-integration.test.ts`, `tests/artifact-gc.test.ts`                                               |

## 6. Main runtime flows

### Flow A: Unit test suite (effect + synchronous)

1. Tests import `describe`, `expect`, `it` from `@effect/vitest`
2. Effect-based tests use `it.effect("name", () => Effect.gen(function*() { ... }))` optionally provided with test layer via `.pipe(Effect.provide(layer))`
3. Synchronous tests use `it("name", () => { expect(...).toBe(...) })`
4. Real-side-effect tests use `it.live("name", () => Effect.gen(function*() { ... }))` — may start HTTP servers, access filesystem, or run Docker

Evidence:

- `tests/orchestrator.test.ts:1-1119` — pattern used throughout 28 tests
- `tests/service.test.ts:1-885` — `it.live` pattern with `withServer()` lifecycle

### Flow B: Storage-backed integration tests

1. Check env guard: `storageIntegrationEnabled` reads `RUN_STORAGE_TESTS=1`
2. Compose durable runtime layer with `durableCliLayer()` (real Postgres + MinIO config)
3. Execute CLI commands or run orchestration against real stores
4. Parse CLI output for run state, artifact refs, log refs
5. Assert against persisted data across fresh runtime instances

Evidence:

- `tests/storage.integration.test.ts:120-160` — `durableCliLayer()` factory
- `tests/storage.integration.test.ts:350-400` — E2E with `realDurableCliLayer()` + `LocalContainerExecutor`

### Flow C: Demo walkthrough (manual)

1. `bun run infra:up` — start Postgres + MinIO via Docker Compose
2. `bun run server` — start persistent engine service on port 3000
3. `ENGINE_BASE_URL=http://127.0.0.1:3000 bun run dashboard` — start dashboard proxy on 3001
4. `ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts run ./examples/demo-workflow.ts --workspace ./examples/demo-project` — submit workflow
5. Open `http://localhost:3001` to inspect the run

Evidence:

- `README.md:64-218` — full walkthrough documented

## 7. User-visible behavior / report-relevant behavior

- **Test command set**: `bun run typecheck` (tsc noEmit), `bun run test` (vitest), `bun run test:storage` (vitest with `RUN_STORAGE_TESTS=1`)
- **Inputs accepted**: `ENGINE_BASE_URL` for CLI/service tests; `RUN_STORAGE_TESTS=1`, `RUN_DOCKER_TESTS=1` env guards; 5 test fixture workflow files
- **Outputs produced**: Vitest pass/fail; JSON schema validation; tsc type errors
- **Errors/diagnostics surfaced**: Meaningful error message assertions (e.g., `"workflow unit not found"`, `"duplicate unit"`, `"cycle detected"`, `"missing image"`)

## 8. Dependencies and integrations

| Dependency / integration                  | Used for                     | Location                         | Notes                                          |
| ----------------------------------------- | ---------------------------- | -------------------------------- | ---------------------------------------------- |
| `vitest` ^4.1.7                           | Test runner                  | `package.json` devDeps           | Runs with `bun run --bun vitest`               |
| `@effect/vitest` ^4.0.0-beta.74           | Effect-native test DSL       | `package.json` devDeps           | `it.effect`, `it.live` support                 |
| `@effect/language-service` ^0.86.2        | In-editor type checking      | `package.json` devDeps           | `bun run prepare` patches                      |
| `typescript` ^5                           | Type checking                | `package.json` devDeps           | `bun run typecheck`                            |
| Docker (Docker Desktop/Engine)            | Container execution          | `compose.demo.yml`, `Dockerfile` | Required for E2E + storage integration tests   |
| `smee-client` ^5.0.0                      | Webhook forwarding           | `package.json` devDeps           | For local GitHub webhook testing               |
| `@effect/platform-node-shared`            | Node.js process spawner      | `package.json` devDeps           | `NodeChildProcessSpawner` for Docker execution |
| `effect/testing` (TestConsole, TestClock) | Virtual time, output capture | `effect` (built-in)              | Used in orchestrator, CLI, scheduler tests     |

## 9. Mismatches with docs or intended architecture

| Intended behavior from docs                                                  | Actual code evidence                                                    | Classification  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------- |
| "CI/CD product should have CI pipeline" (implied by product domain)          | No `.github/workflows/`, `Jenkinsfile`, `.gitlab-ci.yml`                | NOT IMPLEMENTED |
| "Code coverage should be tracked" (industry best practice for CI/CD product) | No coverage reporter in `vitest.config.ts`, no coverage scripts         | NOT IMPLEMENTED |
| "Workflow definitions normalize through DslMaterializer"                     | 9 materializer tests verify normalization + error cases                 | IMPLEMENTED     |
| "Engine owns planning, orchestration, execution"                             | 28 orchestrator + 12 planner + 7 executor tests verify separation       | IMPLEMENTED     |
| "Interface layer operates over engine-owned operations"                      | 16 CLI + 10 service tests use Engine mocks through Layer.succeed        | IMPLEMENTED     |
| "Dashboard is interface-layer client over engine service"                    | 15 dashboard tests use mocked/proxied engine backends                   | IMPLEMENTED     |
| "Local and self-hosted use same execution model"                             | `index.local.ts` and `server.ts` both use same Engine; tests cover both | IMPLEMENTED     |

## 10. Limitations, shortcuts, and incomplete areas

- **No code coverage measurement** — cannot verify what percentage of code is exercised
- **No CI pipeline** — no automated quality gate on push/PR (ironic for a CI/CD product)
- **No performance/stress tests** — no measurement of engine throughput under load, no concurrent run limits tested beyond scheduler unit tests
- **Only 1 full E2E test** — `tests/storage.integration.test.ts` test 4 is the sole "real Docker+Postgres+MinIO" end-to-end test, gated by two env flags
- **E2E tests require external infra** — 4 storage integration tests need Postgres + MinIO running; not self-contained
- **Demo is manual** — README documents CLI + curl steps but no automated demo script (bash/sh)
- **No regression test suite** — tests are not organized into smoking/sanity vs full regression groups
- **No snapshot/visual tests for dashboard** — UI tests use `renderToStaticMarkup` only, no DOM, no visual regression
- **Webhook tests fake GitHub** — `GitHubApiClient` is stubbed; no real GitHub endpoint is called
- **GitHub integration tests skip snapshot GC** — `tests/github-source-snapshots.test.ts` creates temp archives but no eviction/cleanup tests
- **No audit trail tests** — event log append-only semantics are tested implicitly but not explicitly verified as immutable
- **Test timeouts not configured** — vitest defaults apply; `it.live` tests could be flaky under resource constraints

## 11. What the final coursework report should say

### Safe claims

- ~148 automated tests across all major subsystems (DSL, Engine, CLI, Dashboard, Service, GitHub, Storage)
- 100% test active rate — zero `.skip`, `.todo`, or `.only` modifiers
- Clean codebase — zero TODO/FIXME/HACK annotations in source or tests
- Layered test design — pure domain tests (`it`), Effect-native deterministic tests (`it.effect` with in-memory layers), and real-side-effect integration tests (`it.live`)
- Engine tests use best-in-class Effect testing patterns (TestClock, mock layers, deterministic executor)
- Well-structured test doubles via Effect's `Layer` system, not fragile mocking frameworks
- Manual demo walkthrough documented with CLI commands and curl examples covering all major product paths

### Claims to avoid

- "Comprehensive E2E coverage" — only 1 true E2E test, gated by flags
- "CI/CD pipeline built into the product" — no CI config in the repo
- "Full test coverage" — no coverage data exists
- "Production-ready quality" — no regression suite, no performance tests, no security tests

### Suggested figures/tables/screenshots

- **Table**: Subsystem × Test count (rows: DSL, Engine-Planner, Engine-Orchestrator, Engine-Executor, CLI, Service HTTP, Dashboard, GitHub, Storage, Project; columns: Unit tests, Integration tests)
- **Figure**: Test architecture — dependency graph showing test layer compositions (`Executor.testLayer` → Orchestrator tests → Engine interface tests → Service HTTP tests)
- **Figure**: Demo walkthrough sequence diagram — CLI → Service → Engine → Docker containers → Postgres/MinIO persistence → Dashboard inspection

### Suggested appendix material

- Test file list with test counts per file
- Sample CLI test output (captured `TestConsole.logLines`)
- Sample engine integration test demonstrating retry/backoff/expiry with TestClock
- Env guard flags table (`RUN_STORAGE_TESTS`, `RUN_DOCKER_TESTS`) with what each gates

## 12. Open questions for report writer

- Should the report note the irony that a CI/CD product has no CI pipeline config? (Answer likely: yes, as a limitation the report should acknowledge explicitly)
- Should the dual-DSL mismatch (differing Input/Output argument order between `src/dsl/` and `packages/dsl/`) be reported as a quality risk?
- Is the lack of coverage tracking acceptable for a prototype, or should it be listed as a material gap? (Prototype threshold: acceptable; production threshold: blocker)
