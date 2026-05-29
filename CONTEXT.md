# CONTEXT

Agent source of truth. Follow this unless user gives newer accepted docs. Do not reopen locked direction. Do not add architecture beyond scope.

## Product

- Category: code-first CI/CD platform.
- Identity: native TypeScript workflow model + product-owned execution engine.
- Primary modes: local, self-hosted.
- Future allowed: hosted control plane, hosted execution, multi-node workers.
- Product boundary: not source control, not GitOps-first, not infrastructure provisioning-first, not general automation outside CI/CD.
- Wedge: local workflow development, self-hosted operation, workflow-aware inspection.
- Target user: engineers authoring and maintaining build, test, package, verification, delivery workflows.
- V1 success: same workflow model runs locally and self-hosted; users can define, run, inspect, debug.

## Architecture

- Layers: DSL, Engine, Interface.
- DSL purpose: authoring model.
- Engine purpose: execution model.
- Interface purpose: control and inspection surfaces.
- Local/self-hosted difference: operating environment only, not semantics.
- Runtime state: authoritative execution record for structure, progress, failures, outcomes.

## DSL Locked Decisions

- Authoring language: TypeScript declaration builder DSL.
- DSL output: normalized workflow definition.
- Engine input: normalized workflow definition.
- Planner output: execution plan.
- DSL must not produce execution plans.
- Engine must not interpret arbitrary TypeScript authoring code.
- Live builder objects never cross into Engine.
- Authoring-time TypeScript allowed for helpers, constants, reusable fragments, static loops, static conditionals, composition.
- Runtime workflow behavior represented as declarations: dependencies, conditions, retry, timeout, cancellation, inputs, outputs, artifacts, reports, metadata.
- Prototype graph complete before planning.
- Execution-time outputs must not create units.
- Runtime graph mutation deferred.
- Normalized workflow definition independent from final DSL syntax.
- Reusable fragments materialize into explicit units, edges, metadata, optional origin info.
- Static expansion must use authoring-time-known values only.

## Normalized Workflow Definition

Contains conceptual categories, not formal schema:

- workflow identity
- workflow metadata
- trigger declarations where relevant
- execution-unit declarations
- dependency edges
- declared inputs
- declared outputs
- artifact declarations
- report declarations
- runtime conditions
- retry/timeout/cancellation/execution policies where supported
- source metadata for diagnostics and inspection where available
- compatibility/version metadata if implementation requires

Must not contain:

- unresolved authoring constructs
- executable authoring state
- execution plan data
- artifact/log payloads

## Engine Locked Decisions

- Engine validates normalized workflow definitions.
- Planner derives explicit execution plans before execution.
- Workflows are static DAGs in prototype.
- Orchestrator owns workflow-run lifecycle, readiness, dependency satisfaction, transitions, retries, cancellation, final outcome.
- Executor runs isolated execution units and returns normalized results.
- Executor does not own workflow graph interpretation, retry policy, cancellation policy, dependency evaluation, final outcome, authoritative state mutation.
- Containerized execution is prototype default.
- Orchestrator/Executor boundary mandatory even when same process/package.
- Prototype uses single-node embedded container Executor.
- No worker pool, remote dispatch, worker registration, leases, heartbeats, distributed scheduling, multi-node assignment, multi-node recovery.
- Do not build broad substrate-neutral execution framework before second real substrate exists.

## Engine Subsystems

- Planner: validate Engine-facing workflow intent, canonicalize as needed, derive executable plan, emit planning diagnostics.
- Orchestrator: create/advance runs, evaluate DAG readiness, dispatch units, apply results, coordinate state/history/artifact writes, resume incomplete runs.
- Executor: prepare isolated environment, execute unit payload, capture logs, collect outputs/artifact metadata/failure info, report normalized result.
- State Store: durable current operational truth for runs, units, attempts, compact references, summaries, recovery.
- Event Log: append-only milestone history for timeline, audit, debugging, inspection.
- Artifact Store: payload boundary for artifacts, logs, large outputs, plus metadata/references.

## Execution Plan

Engine-owned artifact derived by Planner. Conceptual content:

- plan identity/version
- workflow identity/metadata required for execution
- complete static DAG
- canonical unit identities
- dependency semantics
- unit execution payload descriptors
- inputs/outputs/artifacts/log expectations
- runtime conditions/policies in Engine-understandable form
- source/diagnostic metadata useful for inspection

## Runtime Model

- Workflow run: one execution of one plan.
- Execution unit: discrete runnable node in plan.
- Execution attempt: one dispatch/execution try for a unit, if attempt modeling implemented.
- Executor result: outcome, logs, outputs, artifact metadata, local failure info, timing, correlation ids.
- State transitions valid only through Orchestrator.
- Interface reads composed by Engine, never persistence internals.

## Persistence Boundaries

- State Store is operational source of truth.
- Event Log is not operational truth.
- Artifact Store owns payloads.
- Current state stores references, compact summaries, operational metadata.
- Full logs, raw artifacts, large outputs excluded from current state.
- Recovery resumes from persisted current state.
- Recovery does not replay Event Log.
- Executor never writes authoritative workflow state directly.
- CLI/dashboard never access State Store, Event Log, Artifact Store internals.

## Interface Contract

- Engine owns control operations and inspection reads.
- Interface owns presentation and user interaction.
- Control examples: validate, plan, start, cancel, resume, retry where implemented.
- Inspection examples: run status, plan structure, unit state, progress, failures, events, logs, artifacts, outputs, diagnostics.
- No required REST/gRPC/GraphQL/BFF/CQRS/projections/streaming in prototype.
- Future read shaping allowed only behind Engine boundary.

## Deployment Topology

- Prototype topology: single node for local and self-hosted.
- Local: Engine run in user-operated environment, normally CLI-started/embedded/invoked.
- Self-hosted: same Engine model as customer-operated single-node deployment.
- Packaging choice must not change semantics.
- Preserve future path: embedded Executor -> local worker process -> worker pool -> hosted execution.
- Do not implement hosted control plane or managed execution infrastructure now.
- Do not hard-code local filesystem/process assumptions into workflow semantics.

## Operational Rules

- In-progress units after restart need explicit policy before implementation.
- Logs captured via Executor boundary and stored via Artifact Store boundary.
- Artifact references must remain mode-independent.
- Local concurrency may exist only within single-node semantics.
- Inspection must be workflow-aware, not log-only.
- Source metadata supports diagnostics/inspection, not runtime semantics.
- Normalized workflow compatibility/versioning must be considered before schema stabilizes.

## Prototype Non-Goals

- final DSL syntax
- marketplace/integration breadth
- hosted deployment design
- multi-node worker design
- external CI as primary executor
- Kubernetes-native identity
- direct host execution as default
- event sourcing
- runtime plan mutation
- lazy execution semantics
- exact storage technology locked by architecture docs
- exact transport protocol locked by architecture docs
- implementation file/module layout locked by design docs

## Implementation Decisions Still Needed

- normalized workflow definition schema
- execution plan schema
- workflow-run lifecycle states
- execution-unit lifecycle states
- attempt model
- retry/cancellation semantics
- interrupted-unit restart behavior
- minimum event set
- state/event/artifact consistency model
- artifact/log reference model
- first control surface
- first inspection surface
- local persistence packaging
- embedded container execution lifecycle
- DSL validation vs Planner validation split
- allowed static expansion patterns
- runtime condition representation
- policy declaration representation
- source-location metadata minimum
- initial project/tooling skeleton

## Existing Canonical Docs

- `docs/pvd.md`
- `docs/prd.md`
- `docs/rfcs/0001-system-architecture.md`
- `docs/rfcs/0002-engine-architecture.md`
- `docs/adrs/0001-execution-model.md`
- `docs/adrs/0002-runtime-state.md`
- `docs/adrs/0003-engine-interface.md`
- `docs/adrs/0004-deployment-topology.md`
- `docs/adrs/0005-dsl-model.md`
- `docs/sdds/0001-engine-design.md`
- `docs/sdds/0002-dsl-design.md`
- `docs/coursework-summary-uk.md`
