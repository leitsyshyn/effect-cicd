# FINAL_CONTEXT_REPORT.md

> Normalized, evidence-based implementation context for the coursework report writer.
> Source of truth: the actual repository at `effect-cicd` (version `0.1.0`, prototype).
> Status labels used throughout: `IMPLEMENTED`, `PARTIAL`, `STUB`, `NOT_FOUND`, `DEFERRED`, `NOT_APPLICABLE`.
> Design documents (PRD/PVD/RFC/ADR/SDD) are treated as *intent*, never as implementation evidence.

---

## 1. Executive implementation summary

**What the system is.** `effect-cicd` is a working prototype of a **code-first CI/CD system**. Workflows are authored as native TypeScript using a builder DSL, materialized into a schema-validated **normalized workflow definition**, compiled by a **Planner** into a static **execution plan (DAG)**, and executed by an **Engine** that orchestrates runs, dispatches each unit to a Docker container **Executor**, and persists state to Postgres + S3-compatible object storage. Three interface surfaces consume the Engine: a **CLI**, a **web dashboard** (React SPA), and an **HTTP/JSON + SSE API**. A **GitHub App integration** can trigger runs from push webhooks. The whole codebase is TypeScript on the **Bun** runtime, built on **Effect v4 (beta)** services and layers.

**Main implemented capabilities (all verified in source):**

- A TypeScript DSL (`Workflow`/`Job` builders) that lowers to a normalized definition with deterministic materialization.
- A standalone Planner with extensive structural validation, including DFS cycle detection, dependency/reference integrity, and workspace-path safety; it emits a canonical sorted `ExecutionPlan`.
- A full run lifecycle: queue → admission control → DAG-readiness evaluation → container dispatch → retry (exponential backoff + jitter) → best-effort/fail-fast cancellation → resume-based crash recovery.
- A three-store persistence model (State Store, Event Log, Artifact Store) with in-memory and durable (Postgres + S3) backends, transactional state+event writes, and TTL/count-based GC.
- An Engine facade (~21 fields, ≈19 operations) exposed over an HTTP API with SSE streaming, consumed identically in-process and over HTTP.
- A CLI with 9 top-level commands and a React dashboard wired to real API data (no mock data in the UI).
- Encrypted-at-rest project-scoped secrets (AES-256-GCM) with deferred resolution and post-execution log redaction.
- A GitHub push-trigger pipeline with durable webhook deduplication, per-project source snapshots, and Check Run synchronization.

**Main prototype boundaries.** Single-node only; no hosted/multi-node/worker mode; Docker is the only execution substrate; the dashboard runs as a standalone proxy process (it cannot embed the Engine in a deployed mode); "local mode" is an in-process HTTP loopback service, **not** a direct in-process Engine call.

**Biggest limitations.** Runtime state is stored as a single growing JSONB blob (does not scale, no Event Log GC); secret redaction covers logs only (not artifacts, reports, or failure messages); the in-memory secret store holds plaintext; the async GitHub webhook queue is in-memory and lost on crash; the Planner's diagnostics arrays are always empty and `PlanningFailed` is dead code; there is **no CI pipeline and no coverage measurement** in the repo.

**Sufficiency for a coursework report.** Yes. The implementation is substantial, internally coherent, and well-tested (~148 tests across 22 files, all active). It comfortably supports a report covering domain analysis, architecture, layered design, implementation, user workflows, testing, and an honest limitations/future-work chapter. The report must frame it as a **prototype**, not a production CI/CD platform.

---

## 2. Confirmed system shape

| Area | Confirmed implementation | Evidence | Report relevance |
| ---- | ------------------------ | -------- | ---------------- |
| Repository type | **Single-project Bun repo, not a monorepo.** One root `package.json` plus a `packages/dsl/` subpackage resolved via a tsconfig path alias (`@effect-cicd/dsl`) — no pnpm/npm workspace protocol. | `package.json`, `tsconfig.json`, `packages/dsl/package.json` | Avoid calling it a monorepo. |
| Runtime | Bun for execution, bundling (dashboard), and tests. No separate build/bundler step; `bun run` executes TypeScript directly. | `bunfig.toml`, `Dockerfile` (`ENTRYPOINT ["bun","run","server.ts"]`) | No production build/release tooling exists. |
| Entrypoints | Four `BunRuntime.runMain` entrypoints: CLI remote (`index.ts`), local CLI (`index.local.ts`), engine service (`server.ts`), dashboard (`dashboard.ts`). | the four root `*.ts` files | Each maps to an operating mode. |
| Layers | Three-layer architecture in code: **DSL** (`src/dsl`, `packages/dsl`), **Engine** (`src/engine`, `src/domain`, `src/runtime`, `src/secrets`, `src/github`), **Interface** (`src/cli`, `src/dashboard`, `src/service`). | directory layout | Matches RFC 0001 intent. |
| Storage | All persistent state is external: Postgres (run state, events, secrets, GitHub metadata) + S3/MinIO (artifact & log payloads). No production in-memory fallback. | `src/runtime/storage.ts`, `compose.yml` | Self-hosted requires both. |
| Deployment | Single-node. `Dockerfile` + `compose.yml` (app + Postgres 16 + MinIO + bucket init); `compose.demo.yml` is infra-only. Auto-migrations run on startup. | `compose.yml`, `src/runtime/storage.ts` migrator | ADR 0004 single-node topology. |
| Local / self-hosted mode | **Self-hosted single-node**: persistent `server.ts` + optional dashboard. **Local mode**: `index.local.ts` boots the same service via `Bun.serve()` in-process and drives it through the HTTP client. | `src/cli/local.ts:22-37`, `src/service/server.ts` | Local mode is HTTP loopback, not embedding. |

---

## 3. Final implementation capability matrix

| Capability | Status | What is implemented | Main evidence | Notes / limitations |
| ---------- | :----- | ------------------- | ------------- | ------------------- |
| Repo / build / runtime entrypoints | IMPLEMENTED | 4 Bun entrypoints (CLI, local CLI, service, dashboard); Docker + Compose packaging; auto-migrations on startup | `index.ts`, `index.local.ts`, `server.ts`, `dashboard.ts`, `Dockerfile`, `compose.yml` | No prod build step; `COPY . .` ships tests/docs; no CI. |
| DSL authoring | IMPLEMENTED | `Workflow`/`Job` builder API; 2 trigger kinds, 6 condition kinds, 3 policy kinds; secret refs; example workflows | `src/dsl/public.ts`, `packages/dsl/src/public.ts` | `packages/dsl` is a duplicated **builder-only** subset (no loader/materializer). |
| Normalized workflow definition | IMPLEMENTED | Schema class with units, deps, triggers, conditions, policies, IO, artifacts/reports; schema version `"0.1.0"` hardcoded | `src/domain/workflow-definition.ts`, `src/dsl/materializer.ts` | Deterministic; first-error-only validation. |
| Reusable fragments / static (matrix) expansion | DEFERRED | Only plain TypeScript function composition; no fragment identity, no matrix expansion code | absence in `src/dsl/` | SDD describes it; intentionally out of V1 scope. |
| DSL diagnostics (warnings) | NOT_FOUND | Only hard `DslMaterializationFailed` errors; no severity model / warnings | `src/dsl/materializer.ts` | — |
| Planner / execution plan | IMPLEMENTED | Validates schema version, names, uniqueness, deps, **DFS cycle detection**, input-source & condition integrity, workspace-path safety; emits canonically sorted `ExecutionPlan` | `src/engine/planner.ts`, `src/domain/execution-plan.ts` | See diagnostics row. |
| Static DAG model | IMPLEMENTED | Explicit `(from,to)` dependency edges; deterministic ordering; embedded in run state at creation | `src/engine/planner.ts:291-339` | Plan ID derived from workflowId (no content hash/version). |
| Planner diagnostics | STUB | `PlanningDiagnostic` type exists; `plan.diagnostics` and per-unit arrays are **always `[]`** | `src/engine/planner.ts:327,337` | Nothing populates them. |
| `PlanningFailed` error path | NOT_FOUND | Declared in `plan()` signature but **never constructed** anywhere | `src/domain/errors.ts`; no constructors in `src/` | Dead code. |
| Orchestrator / run lifecycle | IMPLEMENTED | Create→activate→advance loop; readiness + condition eval + skip; result application; retry; cancellation; recovery | `src/engine/orchestrator.ts` | Resume-based recovery, not event replay. |
| Scheduler / admission control | IMPLEMENTED | `RunController` admits queued runs oldest-first; global + per-project concurrency caps (default 1/1); durable queue; re-admit on startup | `src/engine/run-controller.ts:67-185` | Single-node only. |
| Executor / container execution | IMPLEMENTED | `LocalContainerExecutor` spawns `docker run --rm`; captures logs/outputs/artifacts/reports; workspace bind-mount; path-escape guard | `src/engine/executor.ts` | Docker only; emits **succeeded/failed only**. |
| Executor timeout / cancellation | PARTIAL | Timeout via orchestrator `Effect.timeout`; cancellation via fiber interrupt → `handle.kill()` | `src/engine/orchestrator.ts:989-1022`, `executor.ts` | Not container-native (no `docker kill`); not self-terminating. |
| Runtime state store | IMPLEMENTED | Full `WorkflowRunState` persisted as one JSONB blob; memory + Postgres layers | `src/engine/stores/state-store.ts`, `storage.ts` | Blob grows unbounded; metadata duplicated. |
| Event log | IMPLEMENTED | Append-only, sequence-ordered; **26 typed event classes**; memory + Postgres | `src/domain/events.ts`, `src/engine/stores/event-log.ts` | No retention/GC; `RunInterrupted` defined but never emitted. |
| Artifact / log storage | IMPLEMENTED | Payloads in S3 (`artifacts/`, `logs/` prefixes); metadata in Postgres; TTL + per-run GC | `src/engine/stores/artifact-store.ts`, `artifact-gc.ts` | Payloads pass through executor result as base64 first. |
| Engine service / API contract | IMPLEMENTED | `Engine` facade (~21 fields, ≈19 ops); HTTP server with ~32 routes; SSE; error→status mapping; health probes | `src/engine/interface.ts`, `src/service/server.ts`, `client.ts` | No auth (except webhook signature); no pagination; no `resumeRun`. |
| CLI | IMPLEMENTED | 9 top-level commands (validate, plan, run, runs*, artifacts/logs delete, bindings, projects, secrets); remote + local modes | `src/cli/index.ts`, `src/cli/local.ts` | No SSE/streaming output; no resume command; minimal error rendering. |
| Dashboard | IMPLEMENTED | React SPA: projects, run detail with DAG pipeline, job/unit detail, logs/artifacts/timeline, secrets/bindings, SSE live refresh; **real API data** | `src/dashboard/**` | Standalone proxy topology only; no pagination/global-runs page; dark-mode only. |
| Dashboard embedded-in-engine topology | PARTIAL | `createDashboardHandlers` (in-process) exists and is tested, but **not wired to any deployable entrypoint** | `src/dashboard/handlers.ts`; only `proxy-handlers` wired in `server.ts` | Only the proxy process is deployable. |
| GitHub / project integration | IMPLEMENTED | App JWT auth, signed webhooks, binding CRUD, push-trigger matching, per-project snapshots, durable dedupe, Check Run sync, projectId derivation | `src/github/**`, `src/domain/project.ts` | Push only; async queue in-memory; no PR/OAuth. |
| GitHub async webhook durability | PARTIAL | 202-Accepted + in-memory queue drained on microtask | `src/service/server.ts:143-172` | Lost on crash; GitHub re-delivery + idempotency partially mitigate. |
| Secrets / configuration | IMPLEMENTED | AES-256-GCM at rest (Postgres layer), project-scoped, deferred resolution, log redaction; `Config.redacted` for sensitive env | `src/secrets/store.ts`, `src/runtime/config.ts`, `src/engine/orchestrator.ts` | Memory layer plaintext; redaction = logs only. |
| Tests / validation | IMPLEMENTED | ~148 tests / 22 files; Effect + live + sync; gated Docker/storage E2E | `tests/**`, `vitest.config.ts` | No coverage, no CI, 1 full E2E (gated). |
| Self-hosted packaging | IMPLEMENTED | Multi-stage Dockerfile; full + infra-only Compose; documented config | `Dockerfile`, `compose*.yml`, `docs/self-hosting.md` | Single-node. |
| Hosted mode / multi-node / workers / marketplace | DEFERRED | No code references | — | Explicitly out of prototype scope. |
| Resume control operation (`resumeRun`) | NOT_FOUND | Recovery is automatic on startup; no Engine/CLI `resume` operation despite ADR mention | `src/engine/interface.ts`, `src/cli/index.ts` | Recovery ≠ user-invoked resume. |
| API authentication / authorization | NOT_APPLICABLE | None beyond GitHub webhook HMAC | `src/service/server.ts` | Prototype scope. |
| CI pipeline / coverage | NOT_FOUND | No `.github/`, `.gitlab-ci.yml`, `Jenkinsfile`; no coverage reporter | repo root, `vitest.config.ts` | Worth noting honestly. |

---

## 4. Architecture summary for report writing

### 4.1 DSL layer

A TypeScript-native authoring API in `src/dsl/public.ts` exposes immutable builder objects (`WorkflowDsl`, `JobDsl`) modified via `pipe`. `Workflow.make(...).pipe(Workflow.job(Job.make(...).pipe(...)))` produces a live builder, which `lowerWorkflowAuthoring` flattens into raw `AuthoredWorkflow`/`AuthoredUnit` declarations (`src/dsl/authored-workflow.ts`). `DslMaterializer.materialize` (`src/dsl/materializer.ts`) validates basic shape (non-empty ids/names, ≥1 unit, no duplicate unit ids, command completeness, valid dependency targets, no self/duplicate deps) and converts everything into a schema-typed `NormalizedWorkflowDefinition` (`src/domain/workflow-definition.ts`) with `schemaVersion: "0.1.0"`. `WorkflowModuleLoader` (`src/dsl/loader.ts`) dynamically imports a workflow file (`default` then named `workflow` export) and auto-symlinks `@effect-cicd/dsl` into the target project.

**Important locations:** `src/dsl/public.ts`, `src/dsl/materializer.ts`, `src/dsl/loader.ts`, `src/domain/workflow-definition.ts`.

**Limitations:** No reusable fragment system (plain TS composition only); no static/matrix expansion; no warnings/diagnostics (errors only); cycle detection lives in the Planner, not the DSL; `Job.source()`/`Workflow.source()` are not exposed in the public builder (the metadata type exists but is only settable via raw objects). `packages/dsl/` is a **near-duplicate copy** of the builder modules (no `loader`/`materializer`) maintained as a separately importable package — a real two-source-of-truth maintenance hazard.

### 4.2 Engine layer

The Engine is the system's core, exposed through the `Engine` facade (`src/engine/interface.ts`) which composes Planner, Orchestrator, RunController, the three stores, SecretStore, and optional RunUpdates/Metrics.

- **Planner** (`src/engine/planner.ts`): pure validation + plan derivation. `validate()` runs a sequential battery of checks (schema version, names, uniqueness, trigger/condition validity, dependency reference integrity, **DFS cycle detection** at lines 248-289, input-source resolution requiring explicit dependency edges, workspace-relative path safety). `plan()` calls `validate()` then `createPlan()`, which sorts units and dependencies canonically and emits `ExecutionPlan`. Diagnostics arrays are hardcoded empty; `PlanningFailed` is never thrown.
- **Orchestrator** (`src/engine/orchestrator.ts`): owns the run/unit/attempt state machines (run: 8 states; unit: 10 states; attempt: 7 states — `src/domain/runtime-state.ts`). It evaluates DAG readiness and runtime conditions, builds `DispatchRequest`s (resolving secrets and inputs), applies `ExecutorResult`s, schedules retries with exponential backoff + jitter, finalizes terminal runs, handles best-effort and fail-fast cancellation, and performs **resume-based recovery** (running attempts → `interrupted`, non-terminal units → `pending`, then re-advance). It does not manage container lifecycle.
- **RunController** (`src/engine/run-controller.ts`): scheduler/admission control. `scheduleQueuedRuns`/`scheduleOnce` admit queued runs oldest-first under global and per-project concurrency caps (default 1/1), with a re-entrancy guard, durable queue, and startup re-admission.
- **Executor** (`src/engine/executor.ts`): single-method `execute(DispatchRequest)` service. `LocalContainerExecutor` runs `docker run --rm` with `--env`/`--volume`/`--workdir`, captures stdout/stderr to strings, collects declared outputs (text/JSON, 64 KB cap), artifacts (base64), and reports, and returns a normalized `ExecutorResult`.

**Limitations:** Executor produces only `succeeded`/`failed`; `timed_out`/`canceled`/`interrupted` come from the orchestrator/test layer. Timeout and cancellation are fiber-based, not container-native. Retry's `createRetrySchedule` is dead code (inlined arithmetic is used instead). Event-sequence tracking is an in-memory map rebuilt from the DB after restart.

### 4.3 Interface layer

- **Engine HTTP API** (`src/service/server.ts`): `Bun.serve()` with ~32 routes wrapping Engine operations; JSON via Effect Schema codecs; SSE (`text/event-stream`) for run updates; domain-error→HTTP status mapping (400/401/404/502/503); health probes `/healthz`, `/readyz` (checks Postgres + S3), `/metrics` (optional Prometheus), `/version`. No auth beyond GitHub webhook HMAC; no pagination.
- **Engine HTTP client** (`src/service/client.ts`): implements the full `Engine` interface over HTTP, making in-process and remote consumption interchangeable.
- **CLI** (`src/cli/index.ts`): `effect/unstable/cli` command tree; loads/materializes workflows, calls Engine operations, renders structured text. Remote mode uses the HTTP client; local mode boots an in-process service (§4.5).
- **Dashboard** (`src/dashboard/**`): React 19 SPA (TanStack Query, react-router, shadcn/Tailwind) served by a Bun process that proxies `/api/*` to the engine service; live updates via SSE-driven query invalidation. The dashboard reads only through the Engine API — never directly from storage.

**Limitations:** Dashboard `inspectRun` composites four separate Engine calls (BFF-style, not an Engine-owned composite read). The in-process direct-handler topology (`createDashboardHandlers`) is implemented and tested but not wired to a deployable entrypoint. No `resumeRun`, no pagination, no per-unit/per-attempt query endpoints.

### 4.4 Persistence model

Three stores (`src/engine/stores/`), each with a `memoryLayer` (tests) and a durable layer (Postgres/S3), swapped via Effect layers in `src/runtime/layers.ts`:

- **State Store** — operational source of truth. Entire `WorkflowRunState` (with nested unit/attempt trees and full artifact/log metadata arrays) serialized into a single `state_json` JSONB column in `workflow_runs`, alongside mirrored relational columns (`status`, `project_id`, timestamps) used as query indexes.
- **Event Log** — append-only `workflow_events`, sequence-ordered, one JSONB row per event.
- **Artifact Store** — payloads in S3 (`Bun.S3Client`); metadata in `artifact_metadata`/`log_metadata`; TTL + per-run GC (`artifact-gc.ts`).

State+event writes are wrapped in a single Postgres transaction (`StorageTransactor`); S3 writes are **outside** the transaction. Recovery reads only the State Store (no event replay). **Nine** numbered migrations (`0001`–`0009`) in `src/runtime/storage.ts` show schema evolution (runtime storage, GitHub bindings/app loop, secrets, project queueing, artifact lifecycle, legacy state cleanup, content-type, local projects).

**Limitations:** the JSONB blob grows monotonically and is not query-friendly ("find runs where unit X failed" requires loading/parsing blobs); artifact/log metadata is duplicated in both state and indexed tables; **no Event Log GC**; only state+event are transactional (S3 is not).

### 4.5 Deployment / runtime topology

Single node. Three operating modes:

1. **CLI-only (remote):** `index.ts` runs the CLI against a remote engine via the HTTP client (`ENGINE_BASE_URL`, default `http://127.0.0.1:3000`).
2. **Local:** `index.local.ts` → `runWithLocalService` (`src/cli/local.ts`) starts the **same** engine service via `Bun.serve()` **in the same OS process**, then runs the CLI as an HTTP client against `http://127.0.0.1:<port>`, and stops the server on completion. This is an **in-process HTTP loopback service, not a direct in-process Engine call**.
3. **Self-hosted:** `server.ts` runs the persistent engine service (startup recovery, Check Run watcher, artifact GC, then `Bun.serve()` + `Effect.never`); `dashboard.ts` optionally runs the dashboard proxy on port 3001.

Packaging: multi-stage `Dockerfile` (`oven/bun`), `compose.yml` (app + Postgres 16 + MinIO + bucket init), `compose.demo.yml` (infra only).

---

## 5. Implementation modules summary

### 5.1 Repository structure and entrypoints

**Implemented:** single-project Bun repo; 4 entrypoints; Docker/Compose packaging; env-based config (`Config` service classes); auto-migrations on startup.
**Main files / symbols:** `index.ts`/`index.local.ts`/`server.ts`/`dashboard.ts` (entrypoints); `src/runtime/config.ts` (config classes); `src/runtime/layers.ts` (`makeServiceEngineLayer`, `makeInMemoryEngineLayer`, `makeDurableStorageLayer`); `Dockerfile`, `compose.yml`.
**Runtime flow:** entrypoint → `BunRuntime.runMain(program.pipe(Effect.provide(layer)))` → service/CLI/dashboard starts.
**Limitations:** not a monorepo; no prod build; `Dockerfile` `COPY . .` ships everything; no `.dockerignore`; no CI; dashboard cannot embed the engine in a deployed mode.
**Safe report claims:** four operating entrypoints; 3-layer architecture mirrored in `src/`; single-node ADR-0004 topology; Postgres+MinIO required for self-hosted.

### 5.2 DSL authoring and materialization

**Implemented:** builder API; raw `AuthoredWorkflow` interface; deterministic materialization with structural validation; module loader; 2 triggers / 6 conditions / 3 policies; secret refs.
**Main files / symbols:** `src/dsl/public.ts`, `src/dsl/materializer.ts` (`DslMaterializer`), `src/dsl/loader.ts` (`WorkflowModuleLoader`), `src/domain/workflow-definition.ts`.
**Runtime flow:** author → load module → lower builder → materialize+validate → `NormalizedWorkflowDefinition` → Planner.
**Limitations:** duplicated `packages/dsl` builder-only copy; no fragments; no static expansion; no DSL warnings; no DSL-level cycle/input-source validation (moved to Planner); hardcoded schema version.
**Safe report claims:** DSL→Engine boundary is the schema-typed `NormalizedWorkflowDefinition`; materialization is deterministic; dependency edges are explicit `(from,to)` pairs.

### 5.3 Planner and execution plan

**Implemented:** full validation battery incl. DFS cycle detection, reference/input-source integrity, path safety; canonical sorted `ExecutionPlan`; independently testable.
**Main files / symbols:** `src/engine/planner.ts` (`validate`, `plan`, `hasCycle`, `createPlan`), `src/domain/execution-plan.ts`.
**Runtime flow:** `Engine.plan(def)` → `validate` → `createPlan` (sort + convert payloads/policies) → `ExecutionPlan`.
**Limitations:** diagnostics arrays always empty; `PlanningFailed` never constructed (dead code); validation stops at first error; plan id = `plan:<workflowId>` (no content hash/version); recursive DFS (deep-graph stack risk).
**Safe report claims:** the Planner is a distinct, independently tested service that produces a complete static DAG before execution and does not depend on DSL syntax. **Avoid** claiming rich diagnostics.

### 5.4 Orchestrator, scheduler, and run lifecycle

**Implemented:** run/unit/attempt state machines; DAG readiness + condition eval + skip; dispatch; result application; retry (backoff+jitter); best-effort/fail-fast cancellation; resume-based recovery; `RunController` admission with global + per-project caps and oldest-first fairness; durable queue.
**Main files / symbols:** `src/engine/orchestrator.ts`, `src/engine/run-controller.ts`, `src/engine/run-updates.ts`, `src/domain/runtime-state.ts`, `src/domain/events.ts`.
**Runtime flow:** `submitRun`→queue→`scheduleOnce` admits→`advanceRun`/`advanceWithRun` loop→`executeReadyUnit`→apply result→retry/finalize; recovery: `recoverOnStartup`→`recoverIncompleteRuns`→re-advance.
**Limitations:** single-node; static DAG; recovery is resume- not replay-based; `RunInterrupted` event never emitted (recovery emits `RunResumed`); `createRetrySchedule` dead code; container cancellation is fiber-interrupt only; RunUpdates pub/sub is in-memory.
**Safe report claims:** full lifecycle incl. retry, two cancellation modes, and crash recovery; scheduler with concurrency limits and fairness; durable queue surviving restart.

### 5.5 Executor and container execution

**Implemented:** single-method Executor service; `LocalContainerExecutor` (`docker run --rm`); workspace bind-mount + path-escape guard; stdout/stderr capture; output (64 KB, text/JSON), artifact (base64), report collection; Docker-infra-failure detection (exit 125 / daemon-unreachable); deterministic `testLayer`.
**Main files / symbols:** `src/engine/executor.ts` (`Executor`, `LocalContainerExecutor`, `DispatchRequest`, `ExecutorResult`).
**Runtime flow:** orchestrator builds `DispatchRequest` → `execute` → docker spawn → capture → collect from workspace → `ExecutorResult`.
**Limitations:** Docker only (no host/other runtimes); emits succeeded/failed only; no execution-local timeout/cancellation; artifacts/logs carried in-memory as base64 in the result (memory pressure); secret masking happens later in the orchestrator; `--env NAME` passthrough (value from child-process env); Bun-specific `Bun.file`.
**Safe report claims:** clean single-method container executor producing a normalized result; path-escape prevention. **Avoid** claiming container-native timeout/cancellation or streaming.

### 5.6 Runtime state, event history, artifacts, and logs

**Implemented:** three-store model (memory + durable); JSONB state blob; append-only event log (26 event classes); S3 payloads + Postgres metadata; transactional state+event writes; TTL + per-run GC; resume recovery; 9 migrations.
**Main files / symbols:** `src/engine/stores/*.ts`, `src/runtime/storage.ts`, `src/runtime/storage-codecs.ts`, `src/domain/{runtime-state,events,artifacts}.ts`.
**Runtime flow:** create→persist state+event (txn); advance→update state + append events + register payloads (S3 outside txn); GC loop deletes expired payloads + metadata.
**Limitations:** unbounded JSONB blob growth; metadata duplicated in state + tables; **no Event Log GC**; S3 writes not transactional; client-side event sequencing.
**Safe report claims:** State Store is the operational source of truth; Event Log gives ~two-dozen typed milestone events; payloads in S3 with retention GC; resume-based recovery. **Avoid** "lean/scalable state" claims.

### 5.7 Engine service / API contract

**Implemented:** `Engine` facade (~21 fields, ≈19 operations: validate, plan, start/submit (definition & plan), cancel, retry, list, inspect, stream(s), read events/artifacts/logs, read/delete payloads, gc, version); HTTP server with ~32 routes; SSE; error mapping; health probes; HTTP client mirroring the interface.
**Main files / symbols:** `src/engine/interface.ts`, `src/service/server.ts`, `src/service/client.ts`, `src/service/contracts.ts`.
**Runtime flow:** client → route handler → Engine method → subsystem; responses via Schema codecs; SSE via PubSub→`text/event-stream`.
**Limitations:** no `resumeRun`; no pagination; in-memory project filtering; no per-unit/attempt query; SSE no-ops when RunUpdates absent; no auth.
**Safe report claims:** single canonical Engine contract consumed identically in-process and over HTTP; presentation DTOs separated from canonical `WorkflowRunState`. **Avoid** claiming Engine-owned composite reads, resume, auth, or pagination.

### 5.8 CLI

**Implemented:** 9 top-level commands / multiple subcommands (validate, plan, run, runs list/show/events/artifacts/artifact/logs/log/cancel/retry, artifacts delete, logs delete, bindings add/list, projects list, secrets set/list/delete); remote + local modes; `--export`/`--workspace`/`--inputs`/`--project` flags; terminal-state polling; structured text rendering.
**Main files / symbols:** `src/cli/index.ts`, `src/cli/local.ts`.
**Runtime flow:** parse args → load+materialize workflow → Engine operation → render; local mode wraps this in an in-process HTTP service lifecycle.
**Limitations:** local mode is HTTP loopback (not embedded); no SSE/streaming output (polls every 250 ms); no resume command; only `EngineUnavailable` is caught (other errors propagate raw); plan shows diagnostics **count** only; sample executor data hardcoded for demo unit ids; no config-file or workflow auto-discovery.
**Safe report claims:** all CLI commands go through the Engine contract; two modes; dynamic workflow loading. **Avoid** "embedded engine" and "SSE in CLI".

### 5.9 Dashboard

**Implemented:** React 19 SPA, 4 routes; projects list + create (local/GitHub); run detail with DAG pipeline (SVG curves, stage columns); job detail (overview/logs/artifacts/timeline, attempt selector); secrets & bindings tabs (CRUD); SSE-driven live refresh; **all views fetch real API data**; standalone proxy + (test-only) in-process handler factories.
**Main files / symbols:** `src/dashboard/{app,server,api,handlers,proxy-handlers,reads,types}.tsx?`, `src/dashboard/views/*`, `src/dashboard/components/run-pipeline.tsx`.
**Runtime flow:** browser → Bun dashboard server → `createDashboardProxyHandlers` → engine service API → engine.
**Limitations:** only the proxy topology is deployed (`createDashboardHandlers` not wired); no global "all runs" page; no pagination; dark-mode only; loading = plain text; no component-level/visual tests; `deriveStages` computes stages client-side; binding edit/delete absent.
**Safe report claims:** real-data React dashboard with DAG visualization, per-attempt logs/artifacts, and cancel/retry/GC controls; SSE live updates. **Avoid** claiming responsiveness, pagination, workflow-definition viewer, or comprehensive UI tests.

### 5.10 GitHub / project integration

**Implemented:** App JWT + installation-token caching; HMAC-SHA256 webhook verification; push/installation/installation_repositories handling (push = full pipeline); binding CRUD; stable `projectId` derivation from repo identity persisted across entities; durable webhook dedupe (`ON CONFLICT DO NOTHING`) + in-flight fiber dedupe; per-project source snapshots (download/extract/reuse, count-based retention, default 5); Check Run create + lifecycle sync from RunUpdates.
**Main files / symbols:** `src/github/*.ts`, `src/domain/{github,project}.ts`.
**Runtime flow:** webhook → verify → 202 + enqueue → drain → match bindings → trigger filter → snapshot → load/materialize → `plan`+`submitRun` → persist delivery → register Check Run → sync on updates.
**Limitations:** **async queue is in-memory (lost on crash)**; push only (no PR); no OAuth (clientId/secret unused); snapshot retention count-only (no TTL/janitor); GitHub projects derived from bindings (no standalone projects table); binding update/delete limited.
**Safe report claims:** complete signed push-trigger pipeline with durable dedupe, project-isolated snapshots, and Check Run sync. **Avoid** claiming PR triggers, durable webhook processing, OAuth, or TTL snapshot retention.

### 5.11 Secrets / configuration / security boundaries

**Implemented:** `SecretStore` (memory + Postgres); **AES-256-GCM** encryption via Web Crypto (Postgres layer); required `SECRETS_MASTER_KEY` (base64 32-byte); name validation; project-scoped composite keys; deferred resolution at dispatch; post-execution **log** redaction; `Config.redacted` for sensitive env; CLI/API/dashboard surfaces that never display values.
**Main files / symbols:** `src/secrets/store.ts`, `src/domain/secrets.ts`, `src/runtime/config.ts`, `src/engine/orchestrator.ts` (resolution + redaction), `src/engine/executor.ts` (env injection).
**Runtime flow:** set→validate→encrypt→Postgres; plan keeps `SecretRef`; dispatch resolves via SecretStore → `DispatchRequest.env` + `secretEnvNames`; executor injects via `--env`; logs redacted before persistence.
**Limitations:** in-memory store is **plaintext**; redaction covers logs only (**not** artifacts, reports, or failure messages — which can contain stdout/stderr); no audit trail; no key rotation; secrets are plaintext in the engine process and container env during execution; no production-layer guardrail.
**Safe report claims:** encrypted-at-rest, project-scoped secrets with deferred resolution and log redaction; sensitive config redacted. **Avoid** "production-grade", "redacted everywhere", "audit logging", or "key rotation".

### 5.12 Testing and validation

**Implemented:** ~148 tests across 22 files using `@effect/vitest` (`it.effect`, `it.live`, sync `it`); deterministic test layers (`Executor.testLayer`, in-memory stores, `TestClock`, `TestConsole`); gated Docker (`RUN_DOCKER_TESTS`) and storage (`RUN_STORAGE_TESTS`) integration tests; 1 full E2E; zero skipped/todo/only tests; zero TODO/FIXME annotations.
**Main files / symbols:** `tests/*.test.ts(x)`, `vitest.config.ts`.
**Limitations:** **no CI pipeline**; **no coverage**; only 1 gated E2E; no performance/security tests; dashboard has only smoke (`renderToStaticMarkup`) tests; GitHub API stubbed.
**Safe report claims:** broad, layered, all-active automated suite using Effect testing patterns. **Avoid** "comprehensive E2E", "full coverage", "CI/CD pipeline", or "production-ready quality".

---

## 6. User-visible workflows confirmed by code

### Workflow A: Author a workflow in TypeScript
**Status:** IMPLEMENTED
**User path:** write a `.ts` file exporting `default`/`workflow` built with `Workflow.make`/`Job.make`.
**Internal path:** `WorkflowModuleLoader.load` → `lowerWorkflowAuthoring` → `DslMaterializer.materialize`.
**Evidence:** `src/dsl/public.ts`, `loader.ts`, `materializer.ts`; `examples/demo-workflow.ts`.
**Limitations:** explicit path required; no fragments/matrix.

### Workflow B: Validate a workflow
**Status:** IMPLEMENTED
**User path:** `bun run index.ts validate <module>` → prints `workflow <id> is valid`.
**Internal path:** materialize → `Engine.validate` → `Planner.validate`.
**Evidence:** `src/cli/index.ts:125-136`, `src/engine/planner.ts`.
**Limitations:** validation errors propagate as raw Effect failures (minimal rendering).

### Workflow C: Plan a workflow
**Status:** IMPLEMENTED
**User path:** `bun run index.ts plan <module>` → prints units, dependency edges, diagnostics **count**.
**Internal path:** `Engine.plan` → `Planner.plan` → `ExecutionPlan`.
**Evidence:** `src/cli/index.ts:138-146,503-511`.
**Limitations:** individual diagnostics never rendered (always empty anyway).

### Workflow D: Run a workflow locally
**Status:** IMPLEMENTED (with the embedding caveat)
**User path:** `bun run local run <module> --workspace <dir> [--inputs <json>]`.
**Internal path:** `index.local.ts` → `runWithLocalService` boots in-process `Bun.serve()` engine → CLI runs as HTTP client → `submitDefinition`+poll → render summary → stop server.
**Evidence:** `src/cli/local.ts:22-37`, `src/service/server.ts`, `src/cli/index.ts:148-167`.
**Limitations:** in-process HTTP loopback, **not** a direct embedded Engine call; requires Docker for real execution.

### Workflow E: Inspect a run via CLI
**Status:** IMPLEMENTED
**User path:** `runs list [--project]`, `runs show <id>`, `runs events <id>`, `runs artifacts/logs <id>`, `runs artifact/log <ref>`.
**Internal path:** Engine read methods → stores.
**Evidence:** `src/cli/index.ts:169-288`.
**Limitations:** separate commands (no combined timeline); no SSE; no pagination.

### Workflow F: Inspect a run via dashboard
**Status:** IMPLEMENTED
**User path:** open dashboard → project → run → DAG pipeline / timeline / job → logs/artifacts.
**Internal path:** SPA → proxy → 4 Engine reads → `mapRunDetail` DTO.
**Evidence:** `src/dashboard/views/run-page.tsx`, `handlers.ts`/`proxy-handlers.ts`, `reads.ts`.
**Limitations:** per-project only (no global runs page); dark-mode only.

### Workflow G: View logs / artifacts / timeline
**Status:** IMPLEMENTED
**User path:** job detail tabs (per attempt); download raw.
**Internal path:** `readLogPayload`/`readArtifactPayload` → S3; events → Event Log.
**Evidence:** `src/dashboard/views/job-page.tsx`, `src/engine/stores/artifact-store.ts`.
**Limitations:** text/binary detection only; no streaming.

### Workflow H: Self-hosted service startup
**Status:** IMPLEMENTED
**User path:** `bun run infra:up` then `bun run server` (+ optional `bun run dashboard`); or `docker compose up --build`.
**Internal path:** `server.ts` → migrations → recovery → Check Run watcher → artifact GC → `Bun.serve()`.
**Evidence:** `server.ts`, `src/service/server.ts`, `compose.yml`.
**Limitations:** requires Postgres + MinIO; single node.

### Workflow I: GitHub-triggered run
**Status:** IMPLEMENTED (push only; async durability PARTIAL)
**User path:** add a binding (`bindings add github ...`), push to the repo → run is queued, Check Run appears.
**Internal path:** webhook → verify → 202 + in-memory queue → drain → match → snapshot → materialize → `submitRun` → Check Run sync.
**Evidence:** `src/github/integration.ts`, `check-runs.ts`, `source-snapshots.ts`, `src/service/server.ts:143-172`.
**Limitations:** push only; queue lost on crash (mitigated by idempotency + GitHub re-delivery).

### Workflow J: Secrets usage
**Status:** IMPLEMENTED
**User path:** `secrets set <project> <KEY> --from-env <VAR>`; reference via `Job.secret(...)` in a workflow.
**Internal path:** encrypt+store → plan keeps `SecretRef` → resolve at dispatch → inject as container env → redact logs.
**Evidence:** `src/secrets/store.ts`, `src/engine/orchestrator.ts` (resolution/redaction).
**Limitations:** redaction = logs only; in-memory store plaintext.

---

## 7. Testing and validation evidence

| Test area | Evidence | What it verifies | Gaps |
| --------- | -------- | ---------------- | ---- |
| Planner | `tests/planner.test.ts` (~12) | Validation errors, cycle detection, triggers, retry/timeout, path-escape rejection | Diagnostics never asserted (none produced) |
| Orchestrator + scheduler | `tests/orchestrator.test.ts` (~28), `tests/project-scheduler.test.ts` (~5) | Lifecycle, retry/backoff (TestClock), cancellation, recovery, concurrency caps, secret scoping/redaction | No `timed_out` flow through Engine interface |
| Executor | `tests/executor.test.ts` (~7) | Test layer + Docker env/exit/artifacts; infra-failure detection | Real-Docker tests gated off by default |
| DSL / loader | `tests/dsl-materializer.test.ts` (~9), `tests/workflow-loader.test.ts` (~5) | Normalization, error cases, secret refs, export resolution | Limited negative-path coverage |
| Engine interface | `tests/engine-interface.test.ts` (~10) | validate/plan/start/submit/cancel flows | No `retryRun` test through interface |
| Service HTTP | `tests/service.test.ts` (~10, `it.live`) | Real HTTP request/response boundary, secrets API | — |
| Dashboard | `tests/dashboard-ui.test.tsx`, `dashboard-handlers.test.ts`, `dashboard-proxy-handlers.test.ts` (~18) | Smoke render, handler integration, proxy forwarding | No component/DOM/visual tests |
| GitHub | `tests/github-*.test.ts` (~11, 5 files) | Auth, webhooks, dedupe, signature, snapshots, Check Run mapping | GitHub API stubbed; no snapshot GC test |
| Artifact GC | `tests/artifact-gc.test.ts` (~4) | Expiry, fresh-skip, manual deletion | — |
| Storage integration | `tests/storage.integration.test.ts` (~4) | Round-trip, recovery, 1 full E2E | Gated by `RUN_STORAGE_TESTS`/Docker |
| Domain / config | `tests/contracts.test.ts` (~5), `tests/storage-config.test.ts` (~2) | Branded ids, events, `Config.redacted` | — |

- **Frameworks:** `vitest` 4 + `@effect/vitest`; `effect/testing` (`TestClock`, `TestConsole`); `@effect/platform-node-shared` for real Docker spawning.
- **Covered:** all major subsystems; deterministic Effect tests; gated real-infra integration.
- **Not covered:** code coverage, CI, performance, security, true UI component tests.
- **Safe testing claims:** ~148 active tests across 22 files; layered design; Effect testing best practices. **Avoid:** comprehensive E2E, full coverage, built-in CI, production-grade quality.

---

## 8. Safe claims for the final coursework report

**Product / system purpose**
- A code-first CI/CD prototype where pipelines are authored as native TypeScript and compiled to a static execution DAG.
- Self-hostable on a single node via Docker Compose (Postgres + MinIO).

**Architecture**
- Clean three-layer design (DSL → Engine → Interface) mirrored in the source tree.
- The DSL↔Engine boundary is the schema-typed `NormalizedWorkflowDefinition`; the Planner→Orchestrator boundary is the `ExecutionPlan`.
- Built entirely on Effect v4 services/layers, enabling swappable in-memory vs durable backends.

**Implementation**
- Standalone Planner with DFS cycle detection and reference/path validation producing a deterministic static DAG.
- Full run lifecycle: admission control (global + per-project caps, oldest-first), DAG readiness + conditions + skip, container dispatch, retry with backoff/jitter, best-effort & fail-fast cancellation, resume-based crash recovery.
- Container execution via `docker run --rm` with workspace bind-mounts and path-escape protection.
- Three-store persistence (State/Event/Artifact) with transactional state+event writes and retention GC; 9 schema migrations.
- Engine facade (~19 operations) consumed identically in-process and over HTTP, with SSE streaming and health probes.
- Encrypted-at-rest, project-scoped secrets with deferred resolution and log redaction.
- GitHub push-trigger pipeline with durable webhook dedupe, project-isolated source snapshots, and Check Run sync.

**User workflows**
- Author/validate/plan/run/inspect via CLI; inspect runs, DAG, logs, artifacts, and timeline via the dashboard; trigger runs from GitHub pushes.

**Testing**
- ~148 automated tests across all subsystems, fully active, using Effect testing patterns and gated real-infra integration.

**Deployment**
- Single-node self-hosted via Dockerfile + Compose; auto-migrations on startup; three operating modes.

---

## 9. Claims to avoid or phrase carefully

| Avoid claiming | Safer wording |
| -------------- | ------------- |
| "Monorepo" | "Single-project Bun repository with one aliased `@effect-cicd/dsl` subpackage." |
| "Local mode embeds the Engine in-process" | "Local mode boots the engine service in the same process via `Bun.serve()` and drives it over an HTTP loopback." |
| "Production-ready / production-grade" | "A functional prototype (v0.1.0) demonstrating an end-to-end CI/CD pipeline." |
| "Has a CI pipeline" | "No CI configuration is present in the repository (a noted limitation)." |
| "Rich planner diagnostics" | "The Planner reports the first validation error; its diagnostics arrays exist but are currently unpopulated." |
| "Reusable fragments / static matrix expansion" | "Workflow reuse is via plain TypeScript composition; matrix expansion is not implemented." |
| "Container-native timeout/cancellation" | "Timeout and cancellation are orchestrator/fiber-driven; the container is killed via process-handle teardown, not `docker kill`." |
| "Lean / scalable runtime state" | "Runtime state is stored as a single JSONB blob that grows with attempts/metadata; suitable for prototype scale." |
| "Secrets are fully secure / redacted everywhere" | "Secrets are encrypted at rest and redacted in persisted logs; artifacts, reports, and failure messages are not redacted; the in-memory store is plaintext." |
| "Complete GitHub/CI platform integration" | "GitHub push triggers with durable dedupe and Check Run sync; pull-request triggers and OAuth are not implemented; the async webhook queue is in-memory." |
| "Engine-owned composite inspection reads" | "The dashboard composes run detail from four separate Engine reads (BFF-style)." |
| "Resume control operation" | "Recovery is automatic on startup; there is no user-invoked resume operation." |
| "Dashboard data may be partly mocked" | "All dashboard views fetch real API data; only the CLI seeds sample executor results for the demo workflow." |
| "Two deployed dashboard topologies" | "The dashboard is deployed as a standalone proxy; an in-process handler factory exists but is only exercised in tests." |
| "Comprehensive E2E / full coverage" | "Broad unit/integration tests with one gated end-to-end test; no coverage measurement." |

---

## 10. Limitations and future work

**Prototype scope limitations**
- Single-node only; no hosted mode, multi-node, worker pools, or marketplace integrations (DEFERRED).
- Docker is the only execution substrate; no host or alternative-runtime execution.
- GitHub: push triggers only; no PR triggers, no OAuth flow.

**Architectural limitations**
- Runtime state is a single JSONB blob → not query-friendly, grows unbounded; no Event Log GC.
- Only state+event writes are transactional; S3 payload writes are outside the transaction.
- Plan identity is `plan:<workflowId>` with no content hash/version.
- Dashboard cannot embed the Engine in a deployed mode (asymmetric vs the CLI).

**Implementation shortcuts**
- Planner diagnostics arrays always empty; `PlanningFailed` and `RunInterrupted` are dead/unemitted.
- `createRetrySchedule` is dead code.
- `packages/dsl` duplicates `src/dsl` builder modules (two sources of truth).
- Executor carries artifact/log payloads in-memory as base64; `--env NAME` passthrough.

**UX / interface limitations**
- CLI: no streaming output, no resume, minimal error rendering, diagnostics shown as a count only.
- Dashboard: no global runs page, no pagination, dark-mode only, plain-text loading, no component/visual tests, no binding edit/delete.
- API: no auth (beyond webhook HMAC), no pagination, in-memory project filtering.

**Storage / scalability limitations**
- JSONB blob + duplicated metadata + no event retention will not scale to large/long workflows.
- RunUpdates pub/sub is in-memory (no persistence/backpressure).

**Security / secrets limitations**
- In-memory secret store is plaintext; redaction covers logs only; no audit trail; no key rotation; secrets present in process/container env at runtime.

**Testing limitations**
- No CI, no coverage, one gated E2E, no performance/security tests, GitHub API stubbed.

**Future work (natural extensions, grounded in the gaps above)**
- Normalize runtime state into relational tables; add Event Log retention.
- Populate planner diagnostics and a warning-severity model.
- Add a CI pipeline + coverage; broaden E2E and dashboard component tests.
- Extend triggers (PR, schedule); make the webhook queue durable.
- Redact artifacts/reports/failure messages; add secret key rotation and audit logging.
- Consolidate the duplicated DSL package.

---

## 11. Suggested report structure mapping

| Final report section | What to use from this context | Strong evidence areas | Caution |
| -------------------- | ----------------------------- | --------------------- | ------- |
| Реферат | §1 executive summary; one-paragraph capability + boundary statement | §1, §2 | Keep it prototype-framed. |
| Вступ | Problem: code-first CI/CD; goals; prototype scope | §1, §2 | Avoid "production". |
| Аналіз предметної області | CI/CD domain, why code-first DSL, single-node model | §2, §4.1 | Distinguish intent (docs) from build. |
| Огляд технологій | Bun, Effect v4, TypeScript, React/Tailwind, Postgres, MinIO, Docker | §2, §4 | Note Effect v4 is beta. |
| Проєктування системи | Three-layer architecture, boundaries, state machines, persistence model | §4 (all), §5.3-5.6 | Mark diagnostics/embedding caveats. |
| Реалізація системи | Module-by-module implementation | §5 (all), §3 matrix | Use exact numbers (26 events, 9 migrations, ≈19 ops). |
| Практичне застосування | User workflows, CLI/dashboard/GitHub usage, deployment | §6, §4.5 | Local mode = HTTP loopback. |
| Тестування | Test strategy, layered tests, gated integration | §7 | No CI/coverage. |
| Обмеження та подальший розвиток | Honest limitations + future work | §10 | Phrase as prototype constraints. |
| Висновки | What was achieved vs scope | §1, §8 | Grounded, no over-claim. |
| Додатки | Tables/figures/listings | §12, §13 | Reference real files only. |

---

## 12. Suggested figures, tables, and appendices

| Artifact | Purpose | Source / evidence | Notes |
| -------- | ------- | ----------------- | ----- |
| 3-layer architecture diagram | Show DSL → Engine → Interface + storage | `src/` tree, §4 | Annotate single-node. |
| DSL → Engine pipeline diagram | Author→materialize→plan→run flow | §4.1-4.3, §6A-D | Boundary types labeled. |
| Engine subsystem diagram | Planner/Orchestrator/RunController/Executor + stores | §4.2 | Show executor boundary. |
| Run lifecycle state diagram(s) | Run (8) / unit (10) / attempt (7) states + retry/cancel/recover | `src/domain/runtime-state.ts`, §5.4 | Strong, well-defined. |
| Persistence model diagram | State (JSONB) / Event Log / Artifact (S3+metadata); txn boundary | §4.4 | Mark S3-outside-txn. |
| CLI command table | Full command/flag/Engine-method reference | §5.8, `src/cli/index.ts` | 9 top-level cmds. |
| API route summary table | ~32 routes, method/path/schema, error→status map | `src/service/server.ts` | No auth/pagination note. |
| Dashboard screenshots | Projects, run DAG, job logs/artifacts, timeline, secrets/bindings | `src/dashboard/views/*` | Real data; dark mode. |
| Migrations table | 0001–0009 with purpose | `src/runtime/storage.ts` | Nine migrations. |
| Event types table | 26 event classes grouped by phase | `src/domain/events.ts` | Note `RunInterrupted` unemitted. |
| Test coverage table | Subsystem × test count | §7 | ~148 tests; no coverage metric. |
| Deployment topology diagram | 3 modes + Compose stack | §4.5, `compose.yml` | Local = HTTP loopback. |
| GitHub push pipeline diagram | webhook→verify→match→snapshot→submit→Check Run | §5.10, `src/github/*` | In-memory queue caveat. |
| Secret flow diagram | `Secret.ref`→plan→resolve→`--env`→redact | §5.11 | Redaction = logs only. |

---

## 13. Evidence index

| Topic | Key files / symbols | Why important |
| ----- | ------------------- | ------------- |
| Entrypoints / modes | `index.ts`, `index.local.ts`, `server.ts`, `dashboard.ts`; `src/cli/local.ts:22-37` | Defines the four operating modes; local-mode truth. |
| Layer composition | `src/runtime/layers.ts` (`makeServiceEngineLayer`, `makeInMemoryEngineLayer`, `makeDurableStorageLayer`) | Durable vs in-memory wiring. |
| DSL & materialization | `src/dsl/public.ts`, `materializer.ts`, `loader.ts`; `src/domain/workflow-definition.ts` | DSL→Engine boundary. |
| Planner | `src/engine/planner.ts` (`validate`, `plan`, `hasCycle`, `createPlan`); `src/domain/execution-plan.ts` | Validation + static DAG; empty diagnostics at `:327,:337`. |
| Orchestrator / scheduler | `src/engine/orchestrator.ts`, `run-controller.ts`, `run-updates.ts`; `src/domain/runtime-state.ts` | Lifecycle, retry, cancel, recovery, admission. |
| Executor | `src/engine/executor.ts` (`LocalContainerExecutor`, `DispatchRequest`, `ExecutorResult`) | Container execution + result capture. |
| Persistence | `src/engine/stores/*.ts`, `src/runtime/storage.ts` (migrations 0001-0009, `state_json` JSONB), `storage-codecs.ts` | State/Event/Artifact model. |
| Events | `src/domain/events.ts` (26 classes) | Timeline/audit; `RunInterrupted` unemitted. |
| Engine contract / API | `src/engine/interface.ts` (~21 fields), `src/service/server.ts` (~32 routes), `client.ts` | Control + inspection surface. |
| CLI | `src/cli/index.ts` | All user commands. |
| Dashboard | `src/dashboard/server.ts`, `proxy-handlers.ts`, `handlers.ts`, `reads.ts`, `views/run-page.tsx`, `components/run-pipeline.tsx` | Proxy topology + real-data UI. |
| GitHub | `src/github/integration.ts`, `check-runs.ts`, `source-snapshots.ts`, `binding-store.ts`, `trigger-delivery-store.ts`; `src/domain/project.ts` | Trigger pipeline + dedupe + snapshots. |
| Secrets / config | `src/secrets/store.ts` (AES-256-GCM), `src/runtime/config.ts` (`Config.redacted`), redaction in `orchestrator.ts` | Security boundary. |
| Tests | `tests/**` (22 files), `vitest.config.ts` | Quality evidence; no CI/coverage. |
| Packaging | `Dockerfile`, `compose.yml`, `compose.demo.yml`, `docs/self-hosting.md` | Self-hosted deployment. |
