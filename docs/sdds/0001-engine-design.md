# SDD: Engine

## 1. Summary

The Engine is the product-owned execution subsystem for the prototype CI/CD product. It receives a normalized workflow definition from the DSL layer, validates it, derives an explicit execution plan, creates and advances workflow runs, dispatches isolated execution units, persists current runtime state, records execution history, manages artifact and log payload boundaries, and exposes Engine-owned control and inspection capabilities to the Interface layer.
The prototype Engine is single-node in both local and self-hosted modes. It uses the same planning, orchestration, execution, state, history, artifact, and inspection semantics in both modes.

## 2. Scope

This SDD covers the prototype Engine subsystem only.
It covers:

- Engine responsibilities and boundaries.
- Internal Engine structure.
- Planner, Orchestrator, Executor, State Store, Event Log, and Artifact Store responsibilities.
- Conceptual Engine-facing interfaces.
- Runtime data flow.
- Conceptual runtime state categories.
- Hard subsystem invariants.
- Prototype operational concerns.
- Lower-level technical questions left open for implementation design.
  It does not cover:
- Final DSL syntax.
- DSL authoring APIs.
- Interface UI design.
- Hosted deployment design.
- Full multi-node worker design.
- Exact storage technology.
- Exact transport protocols.
- Exact persistence schemas.
- Exact scheduling algorithms.
- Exact artifact formats or retention policy.
- Implementation file, package, or module layout.

## 3. Responsibilities

The Engine is responsible for:

- Receiving normalized workflow definitions from the DSL layer.
- Validating normalized workflow definitions against Engine rules.
- Deriving explicit execution plans before workflow execution starts.
- Creating workflow runs from execution plans.
- Owning workflow-run lifecycle semantics.
- Determining execution-unit readiness from the static DAG.
- Applying dependency satisfaction rules, runtime conditions, retries, cancellation, and terminal outcome rules where supported.
- Dispatching ready execution units to the Executor.
- Receiving normalized execution results from the Executor.
- Persisting authoritative current runtime state.
- Recording append-only execution history.
- Storing artifact, log, and large output payloads separately from current runtime state.
- Maintaining artifact and log metadata/references needed for inspection.
- Exposing Engine-owned control operations to the Interface layer.
- Exposing Engine-owned inspection/read capabilities to the Interface layer.
  The Engine is not responsible for:
- Interpreting arbitrary TypeScript workflow authoring code.
- Owning final DSL syntax or authoring ergonomics.
- Acting as source control.
- Acting as an external CI compatibility layer.
- Providing hosted control-plane infrastructure in the prototype.
- Providing distributed scheduling or multi-node worker coordination in the prototype.
- Letting Interface surfaces access persistence internals directly.

## 4. Internal Structure

The Engine has six accepted top-level subsystems:

- Planner
- Orchestrator
- Executor
- State Store
- Event Log
- Artifact Store
  No separate top-level query, BFF, scheduler, worker-pool, or hosted-control subsystem is introduced by this SDD.

### Planner

Primary purpose: convert normalized workflow definitions into explicit execution plans.
Owned responsibilities:

- Accept the normalized workflow definition produced by the DSL layer.
- Validate the definition against Engine-level rules.
- Validate static DAG constraints.
- Validate execution-unit identity, dependency references, and graph reachability rules required by the prototype.
- Validate declared inputs, outputs, artifacts, reports, runtime conditions, and supported execution policies.
- Canonicalize Engine-facing workflow structure where needed for deterministic planning.
- Derive an explicit execution plan before execution starts.
- Produce diagnostics that can be surfaced through Engine-owned reads.
- Preserve source and declaration metadata useful for inspection when supplied by the DSL layer.
  Non-responsibilities:
- The Planner does not evaluate arbitrary TypeScript authoring code.
- The Planner does not own DSL syntax.
- The Planner does not execute workflow units.
- The Planner does not determine runtime readiness after a run starts.
- The Planner does not mutate the plan during prototype execution.
- The Planner does not own retry, cancellation, or final run outcome semantics.
  Direct interactions:
- Receives normalized workflow definitions from the Engine boundary.
- Returns execution plans to the Orchestrator or to Engine control operations.
- May cause planning diagnostics to be exposed through Engine inspection capabilities.
- Does not write authoritative runtime state except through Engine-controlled run creation flow if the implementation chooses to persist plan snapshots with runs.

### Orchestrator

Primary purpose: own workflow-run semantics and advance workflow runs.
Owned responsibilities:

- Create workflow runs from execution plans.
- Initialize run-level and execution-unit current state.
- Evaluate readiness using the static DAG in the execution plan.
- Apply dependency satisfaction rules.
- Apply runtime conditions where supported.
- Apply retry policy where supported.
- Apply cancellation semantics where supported.
- Dispatch ready execution units to the Executor.
- Receive normalized Executor results.
- Decide valid execution-unit state transitions.
- Decide valid workflow-run state transitions.
- Determine terminal workflow-run outcome.
- Coordinate State Store updates, Event Log appends, and artifact/log registration.
- Resume incomplete workflow runs from persisted current state after restart.
- Treat interrupted in-progress execution units according to the prototype recovery policy.
  Non-responsibilities:
- The Orchestrator does not run commands or manage low-level container lifecycle.
- The Orchestrator does not interpret arbitrary TypeScript.
- The Orchestrator does not store artifact or log payloads directly.
- The Orchestrator does not let events replace current state as operational truth.
- The Orchestrator does not implement worker pools, remote dispatch, leases, heartbeats, or distributed scheduling in the prototype.
- The Orchestrator does not expose persistence internals to the Interface layer.
  Direct interactions:
- Consumes execution plans from the Planner.
- Reads and writes current runtime state through the State Store.
- Appends milestone events through the Event Log.
- Dispatches execution units to the Executor through the explicit Orchestrator/Executor boundary.
- Receives normalized execution results from the Executor.
- Registers artifact/log references and metadata through the Artifact Store boundary.
- Serves Engine-owned control and inspection capabilities indirectly by composing state, plan, history, and artifact references.

### Executor

Primary purpose: run isolated execution units and report normalized execution results.
Owned responsibilities:

- Prepare the isolated execution environment for a single execution unit.
- Execute the unit payload defined by the execution plan.
- Capture execution-local logs.
- Collect declared outputs.
- Collect artifact metadata.
- Capture execution-local failure information.
- Return a normalized execution result to the Engine.
- Keep container-specific mechanics inside the Executor boundary.
- Provide enough result metadata for the Orchestrator to apply workflow semantics.
  Non-responsibilities:
- The Executor does not own workflow graph interpretation.
- The Executor does not evaluate dependency satisfaction.
- The Executor does not decide whether a unit is ready.
- The Executor does not own retry policy.
- The Executor does not own cancellation policy, except for carrying out execution-local cancellation requests from the Orchestrator where supported.
- The Executor does not determine final workflow-run outcome.
- The Executor does not mutate authoritative runtime state directly.
- The Executor does not expose Interface-facing read models.
- The Executor does not implement a generic multi-substrate framework in the prototype.
  Direct interactions:
- Receives dispatch requests from the Orchestrator.
- Returns normalized execution results to the Orchestrator.
- Produces or streams log/artifact payloads through the Engine’s artifact/log storage boundary as defined by the implementation.
- Does not directly write State Store state or Event Log history.

### State Store

Primary purpose: persist authoritative current operational state.
Owned responsibilities:

- Persist current workflow-run state.
- Persist current execution-unit state.
- Persist current execution-attempt state needed for resume, inspection, and control.
- Persist compact artifact/log/output references and summaries needed for operation and inspection.
- Persist enough plan/run association data to support inspection and resume.
- Provide reads needed by the Orchestrator to answer operational questions.
- Provide reads needed by Engine-owned inspection capabilities.
- Support resume-based recovery without Event Log replay.
  Non-responsibilities:
- The State Store does not store full artifact payloads.
- The State Store does not store full log payloads.
- The State Store does not store large output payloads.
- The State Store does not serve as append-only history.
- The State Store does not define workflow-run semantics.
- The State Store does not expose raw persistence internals to CLI or dashboard surfaces.
  Direct interactions:
- Read and written by the Orchestrator.
- Read by Engine-owned inspection capabilities.
- Coordinates conceptually with Event Log and Artifact Store writes, but remains the source of operational truth.

### Event Log

Primary purpose: record append-only milestone execution history.
Owned responsibilities:

- Append significant execution events.
- Preserve historical ordering sufficient for timeline inspection and debugging.
- Record run-level lifecycle milestones.
- Record execution-unit lifecycle milestones.
- Record attempt-level milestones where required.
- Record artifact/log registration milestones where useful for inspection.
- Record failure, cancellation, retry, and completion milestones where supported.
- Provide historical reads for Engine-owned inspection capabilities.
  Non-responsibilities:
- The Event Log is not the operational source of truth.
- The Event Log is not replayed to reconstruct current runtime state in the prototype.
- The Event Log does not replace State Store state.
- The Event Log does not store artifact or log payloads.
- The Event Log does not define valid state transitions.
- The Event Log does not expose raw persistence internals to the Interface layer.
  Direct interactions:
- Written by the Orchestrator when significant transitions or outcomes occur.
- Read by Engine-owned inspection capabilities for timelines, audit, and debugging.
- May reference artifacts, logs, runs, units, attempts, and state transitions by identity.

### Artifact Store

Primary purpose: own payload storage for artifacts, logs, and large outputs.
Owned responsibilities:

- Store artifact payloads.
- Store log payloads or log payload segments, depending on implementation.
- Store large output payloads that should not be embedded in current runtime state.
- Maintain artifact/log metadata needed for retrieval and inspection.
- Return stable artifact/log references to be stored in current state and events.
- Keep payload storage separate from workflow runtime state.
- Preserve a storage boundary that can evolve from local prototype storage to self-hosted and hosted storage later.
  Non-responsibilities:
- The Artifact Store does not own workflow-run lifecycle.
- The Artifact Store does not decide execution-unit state transitions.
- The Artifact Store does not decide whether artifacts are valid workflow outputs except through metadata supplied by Engine semantics.
- The Artifact Store does not replace the State Store for operational state.
- The Artifact Store does not replace the Event Log for history.
  Direct interactions:
- Receives artifact/log payloads or registration requests from Engine-controlled execution flows.
- Returns references and metadata to the Orchestrator.
- Provides retrieval capability behind Engine-owned inspection reads.
- Is referenced by State Store records and Event Log events.

## 5. Interfaces

Interfaces in this SDD are conceptual subsystem-facing boundaries. They do not imply REST, gRPC, GraphQL, in-process calls, queues, or any other transport.

### DSL to Engine Input

Input: normalized workflow definition.
The normalized workflow definition must conceptually contain:

- Workflow identity.
- Workflow metadata.
- Trigger declarations where relevant.
- Execution-unit declarations.
- Dependency edges.
- Declared inputs and outputs.
- Declared artifact/report metadata.
- Declared runtime conditions.
- Declared retry, timeout, and execution policies where supported.
- Source metadata useful for diagnostics and inspection.
- No unresolved authoring-only constructs.
- No live DSL builder objects.
- No arbitrary executable TypeScript authoring state.
  The Engine treats this input as workflow intent, not as an execution plan.

### Planner Output

Output: explicit execution plan.
The execution plan must conceptually contain:

- Plan identity/version.
- Workflow identity and metadata required for execution.
- Complete static DAG of execution units.
- Canonical execution-unit identities.
- Dependency edges and dependency semantics.
- Unit execution payload descriptors.
- Unit inputs, outputs, artifacts, and log expectations.
- Runtime conditions and supported policies in Engine-understandable form.
- Source/diagnostic metadata needed for inspection.
- Planning diagnostics or validation errors when planning fails.
  The execution plan is the boundary between workflow definition and execution.

### Orchestrator to Executor Dispatch

Dispatch request: execution-unit invocation.
A dispatch request must conceptually include:

- Workflow-run identity.
- Execution-unit identity.
- Attempt identity or attempt number.
- Execution payload descriptor from the execution plan.
- Resolved inputs and references needed by the unit.
- Relevant environment and isolation requirements.
- Artifact/log/output capture expectations.
- Timeout or cancellation-relevant execution policy where supported.
- Correlation metadata needed to attach results to the correct run, unit, and attempt.
  The dispatch request must not require the Executor to interpret the workflow DAG.

### Executor Result Contract

Result: normalized execution result.
An Executor result must conceptually include:

- Workflow-run identity.
- Execution-unit identity.
- Attempt identity or attempt number.
- Terminal execution-local outcome.
- Exit/status information where applicable.
- Execution-local failure information.
- Captured output summaries.
- Artifact metadata and references, or metadata needed to register artifacts.
- Log references, log segments, or metadata needed to register logs.
- Timing information useful for inspection.
- Executor diagnostic information useful for debugging.
  The result reports what happened inside isolated execution. The Orchestrator decides what that means for workflow state.

### State Store Boundary

Write boundary:

- Create run current state.
- Update run current state.
- Update execution-unit current state.
- Update execution-attempt current state.
- Store compact references to artifacts, logs, outputs, and failure summaries.
- Store current cancellation/retry/resume-relevant metadata.
  Read boundary:
- Read run current state.
- Read execution-unit current state.
- Read attempt state.
- Read dependency state needed for readiness evaluation.
- Read state required for Engine-owned inspection.
- Read incomplete runs during restart/resume.
  State Store reads and writes are Engine-internal. Interface surfaces must use Engine-owned inspection capabilities instead.

### Event Log Append Boundary

Append boundary:

- Append planning-related milestone events where useful.
- Append run-created, run-started, run-completed, run-failed, run-canceled events.
- Append unit-ready, unit-dispatched, unit-started, unit-completed, unit-failed, unit-skipped, unit-canceled events as required by the prototype event set.
- Append attempt-started, attempt-completed, attempt-failed events where attempt modeling is implemented.
- Append retry-scheduled and retry-exhausted events where retry is implemented.
- Append artifact/log registered events where useful for inspection.
- Append recovery/resume milestones where useful for debugging.
  Event appends must be append-only. They must not be required to reconstruct operational state.

### Artifact Registration and Storage Boundary

Payload boundary:

- Store artifact payloads.
- Store log payloads.
- Store large output payloads.
- Return stable references for persisted state and history.
- Maintain payload metadata such as producer unit, attempt, name, type, size, timestamps, and retrieval information where available.
  Registration boundary:
- Register metadata for artifacts/logs produced by execution.
- Associate artifact/log references with the producing run, unit, and attempt.
- Return compact metadata suitable for State Store and Event Log references.
  Current runtime state may store references and compact summaries, not payloads.

### Engine Control Operations Exposed to Interface

The Engine exposes control operations that affect workflow-run lifecycle. The minimum conceptual control surface includes:

- Validate a normalized workflow definition.
- Plan a normalized workflow definition.
- Start a workflow run from a valid normalized workflow definition or execution plan.
- Cancel a workflow run where cancellation is implemented.
- Resume incomplete workflow runs after restart where recovery is implemented.
- Retry failed units or runs where retry semantics are implemented.
  The exact initial set remains an implementation question, but all control operations must preserve Engine-owned semantics. CLI and dashboard surfaces must not implement their own run lifecycle rules.

### Engine Inspection Capabilities Exposed to Interface

The Engine exposes inspection/read capabilities over Engine-owned state, history, plans, artifacts, and logs. The minimum conceptual inspection surface includes:

- List workflow runs.
- Read workflow-run status and outcome.
- Read execution plan structure for a run.
- Read execution-unit states and dependencies.
- Read progress and readiness/blocking information.
- Read failure summaries and failure locations.
- Read attempt information where attempts are modeled.
- Read execution timeline from Event Log history.
- Read artifact metadata and retrieval references.
- Read log metadata and retrieval references.
- Read compact output summaries.
- Read diagnostics from validation/planning where available.
  Inspection composition is Engine-owned. The Interface layer may present data differently, but must not access State Store, Event Log, Artifact Store, Planner, Orchestrator, or Executor internals directly.

## 6. Data Flow and State

### Main Data Flow

1. The DSL layer materializes a normalized workflow definition.
2. The Engine receives the normalized workflow definition.
3. The Planner validates the normalized workflow definition.
4. The Planner derives an explicit execution plan.
5. The Orchestrator creates a workflow run from the execution plan.
6. The Orchestrator initializes current runtime state in the State Store.
7. The Orchestrator records run creation/start milestones in the Event Log.
8. The Orchestrator evaluates execution-unit readiness from the static DAG.
9. The Orchestrator dispatches ready execution units to the Executor.
10. The Executor runs each dispatched unit in an isolated containerized environment.
11. The Executor captures logs, outputs, artifact metadata, timing, and execution-local failure information.
12. The Executor returns a normalized execution result to the Orchestrator.
13. The Engine stores artifact, log, and large output payloads through the Artifact Store boundary.
14. The Orchestrator updates authoritative current runtime state in the State Store.
15. The Orchestrator appends execution milestones to the Event Log.
16. The Orchestrator repeats readiness evaluation and dispatch until the workflow run reaches a terminal state.
17. The Interface layer reads Engine-owned inspection views composed from current state, execution plan data, event history, and artifact/log references.

### Minimum Conceptual Runtime State Model

Workflow-run state must include:

- Run identity.
- Associated workflow identity.
- Associated execution plan identity or plan snapshot reference.
- Current run status.
- Current run outcome where terminal.
- Start, update, and completion timing.
- Cancellation/resume metadata where applicable.
- Aggregate progress summary.
- Failure summary where applicable.
- References to run-level artifacts/logs where applicable.
  Execution-unit state must include:
- Unit identity.
- Run identity.
- Current unit status.
- Dependency relationships or references needed for readiness evaluation.
- Dependency satisfaction state.
- Runtime condition status where applicable.
- Current or latest attempt reference.
- Retry/cancellation metadata where applicable.
- Timing summary.
- Output summary.
- Artifact/log references.
- Failure summary where applicable.
  Execution-attempt state must include:
- Attempt identity or attempt number.
- Run identity.
- Unit identity.
- Attempt status.
- Dispatch metadata.
- Start and finish timing.
- Execution-local outcome.
- Failure information where applicable.
- Artifact/log/output references produced by the attempt.
- Retry relationship to prior or subsequent attempts where applicable.
  Artifact state/metadata must include:
- Artifact identity or reference.
- Producing run, unit, and attempt where applicable.
- Artifact name or logical role.
- Artifact type/category.
- Compact metadata needed for inspection.
- Payload reference managed by the Artifact Store.
- Availability status.
- Creation timing.
- Size/checksum/provenance metadata where supported.
  Log state/metadata must include:
- Log identity or reference.
- Producing run, unit, and attempt where applicable.
- Payload or segment references managed by the Artifact Store.
- Compact availability/status metadata.
- Timing or ordering metadata needed for inspection.
- Summary information where useful.
- No full log payload embedded in current runtime state.
  History/event state must include:
- Event identity.
- Run identity.
- Unit identity where applicable.
- Attempt identity where applicable.
- Event type.
- Event timestamp or ordering marker.
- Compact event payload.
- References to artifacts/logs where relevant.
- Correlation metadata useful for timeline inspection.
  The State Store owns current operational state. The Event Log owns append-only history. The Artifact Store owns payloads and payload metadata. These categories may reference each other, but they must not collapse into one storage responsibility.

## 7. Key Invariants

- The Planner must derive an explicit execution plan before workflow execution starts.
- The prototype executes static DAG workflows; all execution units and dependency edges are known before execution starts.
- The DSL produces normalized workflow definitions; the Engine does not interpret arbitrary TypeScript authoring code.
- The DSL does not produce execution plans directly; execution-plan derivation remains Planner-owned.
- The Orchestrator owns workflow-run lifecycle semantics, readiness evaluation, dependency satisfaction, retries, cancellation, state transitions, and final run outcome.
- The Executor runs isolated execution units and returns normalized execution results; it does not own workflow semantics.
- The Executor must not mutate authoritative runtime state directly.
- The Orchestrator/Executor boundary remains mandatory even when both are packaged together.
- The State Store is the authoritative operational source of truth for orchestration, control, inspection, and resume-based recovery.
- The Event Log is append-only history for audit, timeline, debugging, and inspection; it is not operational truth.
- Recovery resumes from persisted current runtime state and does not replay the Event Log to reconstruct operational state.
- Artifact, log, and large output payloads are not embedded in current runtime state.
- Current runtime state stores payload references, compact summaries, and operational metadata only.
- Interface surfaces use Engine-owned control operations and Engine-backed reads; they do not access persistence internals directly.
- Local and self-hosted modes use the same Engine model, execution semantics, runtime state semantics, and inspection model.
- The prototype remains single-node and does not implement worker pools, remote dispatch, worker registration, leases, heartbeats, distributed scheduling, or multi-node recovery.
- Containerized execution is the default prototype execution substrate, and container-specific mechanics must remain inside the Executor.
- The design must preserve a path to later separate workers, multi-node self-hosted execution, and hosted deployment without redefining Engine semantics.

## 8. Operational Concerns

### Restart and Resume Behavior

The Engine must recover by reading persisted current runtime state from the State Store. It must not replay Event Log history to reconstruct operational state.
On restart, the Engine must identify incomplete workflow runs and determine whether they are resumable, terminal, or require recovery handling. The Orchestrator is responsible for applying the recovery policy.

### In-Progress Units After Restart

Execution units that were in progress when the Engine stopped require explicit treatment. The prototype must define whether such units become failed, interrupted, retryable, canceled, or unknown after restart.
The Executor must not be treated as the authoritative source of workflow state after restart. The Orchestrator must reconcile persisted current state with the known prototype execution model and advance state through valid transitions.

### Log Collection and References

Logs must be captured by or through the Executor boundary and stored through the artifact/log payload boundary. Current runtime state may contain log references, availability metadata, and compact summaries, but not full log payloads.
Inspection reads should be able to relate logs to run, unit, and attempt identity.

### Artifact Handling Assumptions

Artifacts and large outputs are stored separately from current runtime state. The Artifact Store returns references that can be persisted in State Store records and Event Log events.
The prototype may use simple storage packaging, but the conceptual boundary must remain intact so local storage can evolve into self-hosted or hosted storage later.

### Local Concurrency Assumptions

The prototype is single-node. Local concurrency may exist within that node, but it must be bounded by Orchestrator and Executor semantics.
Concurrency decisions must not introduce distributed worker concepts. If multiple execution units run concurrently, the Orchestrator still owns readiness, dispatch, state transitions, and final outcome.

### Local vs Self-Hosted Process Assumptions

Local mode may start, embed, or invoke the Engine through the CLI. Self-hosted mode may run the same Engine model as a customer-operated single-node deployment.
These are packaging choices. They must not alter workflow semantics, execution-plan semantics, runtime state semantics, artifact/log boundaries, or Engine-owned Interface contracts.

### Debugging and Inspection Implications

The Engine must preserve enough current state, event history, plan data, artifact metadata, and log references to support workflow-aware inspection.
Inspection must not be log-only. It must allow users to understand structure, progress, dependency blocking, failures, attempts where modeled, artifacts, logs, and outcomes.

### Avoiding Local-Only Coupling

The prototype must avoid hard-coding local filesystem, local process, or CLI-only assumptions into Engine semantics.
Local mode may use simple local packaging, but:

- Workflow semantics must remain mode-independent.
- Artifact/log references must remain conceptual references, not user-interface assumptions.
- State/history/artifact boundaries must remain stable.
- Interface surfaces must use Engine-owned control and inspection capabilities.
- The Executor boundary must remain compatible with later worker packaging.

## 9. Open Technical Questions

The following lower-level questions remain open after the accepted ADRs and must be resolved during implementation design:

- What exact execution-unit lifecycle states are required for the prototype?
- What exact workflow-run lifecycle states are required?
- What execution-attempt model is required, including attempt identity, attempt numbering, and retry linkage?
- How should interrupted running units be represented after restart?
- What minimum event set is required for useful timeline inspection without turning the Event Log into operational truth?
- What consistency model is required across State Store updates, Event Log appends, and Artifact Store registrations?
- Which state/event/artifact writes must be atomic from the Engine’s perspective?
- What exact control operations are required for the first useful CLI and dashboard flows?
- What exact inspection reads are required for the first useful CLI and dashboard flows?
- What artifact/log reference model is sufficient for local mode while preserving self-hosted and hosted paths?
- Are logs modeled as artifacts, artifact-like payloads, or a distinct payload category inside the Artifact Store boundary?
- What compact summaries belong in current runtime state versus Event Log history versus Artifact Store metadata?
- What validation failures are reported by DSL materialization versus Planner validation?
- What source-location and diagnostic metadata must be preserved for useful inspection?
- What cancellation behavior is required in the prototype?
- What retry behavior is required in the prototype?
- What minimum local concurrency should the embedded Executor support?
- What storage interface discipline is needed so local storage does not become a local-only semantic dependency?
- When does separate worker packaging become justified beyond the embedded Executor seam?
- What signals indicate the prototype needs real worker topology rather than only the current Orchestrator/Executor boundary?
  These questions do not reopen the accepted architecture decisions.

## 10. Related ADRs

Relevant accepted ADRs:

- ADR 0001: Prototype Execution Model
- ADR 0002: Runtime State, Event History, and Artifact Model
- ADR 0003: Engine / Interface Contract
- ADR 0004: Single-Node Prototype Deployment Topology
- ADR 0005: DSL ↔ Engine Boundary
  Related accepted RFCs:
- RFC 0001: System Architecture
- RFC 0002: Engine Architecture

### Implementation-Shaping Points Captured

- The Planner owns validation and execution-plan derivation; the DSL only supplies a normalized workflow definition.
- The Orchestrator owns workflow semantics; the Executor only runs isolated units and returns normalized results.
- The State Store is operational truth; the Event Log is append-only history; the Artifact Store owns payloads.
- Recovery is resume-based from current state, not replay-based from events.
- Interface surfaces must use Engine-owned control and inspection capabilities, not persistence internals.
- The prototype stays single-node while preserving the Orchestrator/Executor seam for later worker-based execution.
