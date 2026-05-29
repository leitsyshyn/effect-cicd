# ADR 0002: Runtime State, Event History, and Artifact Model

## Status

Accepted

## Context

The prototype needs workflow-aware execution, inspection, and recovery.

Workflow definitions are converted into explicit execution plans before execution. Workflow runs are executed as static DAGs. The Orchestrator owns workflow-run semantics and execution-unit state transitions.

The Engine has three relevant persistence boundaries:

```text
State Store
Event Log
Artifact Store
```

Runtime state must support orchestration and inspection. Execution history must explain what happened. Artifact and log payloads must not bloat operational state.

This ADR decides the relationship between runtime state, execution history, artifacts, logs, and recovery. It does not define exact schemas, storage engines, database choices, artifact formats, retention policies, or queue implementations.

## Decision

The prototype will use a lean operational-state model with structured milestone history.

The State Store persists current runtime state and is the operational source of truth for orchestration, control, inspection, and resume-based recovery.

The Event Log records append-only milestone events for history, audit, debugging, and timeline inspection. It is not the operational source of truth.

The Artifact Store owns artifact payloads, log payloads, and large output payloads.

Current runtime state stores references, compact summaries, and operational metadata. It does not store raw artifacts, full logs, large outputs, or complete historical transition sequences.

Recovery is resume-based. The Engine resumes from persisted current runtime state. It does not replay the Event Log to reconstruct operational state.

## Rationale

The Orchestrator needs direct answers to operational questions:

```text
What is the current workflow run state?
Which execution units are ready?
Which units are blocked?
Which units are running?
Which units failed?
Which dependencies are satisfied?
What should happen next?
```

A durable current-state record answers these questions directly.

A replay-based model would require event ordering, replay correctness, projection versioning, idempotency, partial-write handling, and event schema stability before the prototype needs them.

The selected model preserves useful execution history without making history operationally load-bearing.

Separating artifact and log payloads from current state keeps runtime state small, durable, and directly usable by the Orchestrator. Artifact storage can then evolve independently for larger payloads, retention, remote storage, or hosted execution.

## Consequences

### Positive

The Orchestrator can resume and continue workflow runs without replaying events.

The State Store remains operationally complete but lean.

The Event Log can support timeline inspection, audit, debugging, and future analytics without becoming accidental event sourcing.

The Artifact Store becomes a clear payload boundary for artifacts, logs, and large outputs.

CLI and dashboard inspection can combine current runtime state, milestone history, execution plan data, and artifact/log references through Engine-owned reads.

The model preserves future paths to richer event streams, richer read models, multi-node execution, hosted deployment, and possible future replay analysis.

### Negative

The implementation must maintain consistency across state updates, event appends, and artifact registrations.

Some information may exist in more than one form: current state for operation, events for history, and artifact metadata for payload access.

The Event Log will not be sufficient for recovery unless a future ADR explicitly changes the recovery model.

The prototype must decide which summaries belong in current state versus the Artifact Store or Event Log.

## Alternatives Considered

A thin State Store with a minimal Event Log was rejected. It would be fast to build but too weak for inspection and recovery.

A rich State Store with broad event history and indexed artifact metadata was rejected for the prototype. It provides stronger inspection earlier, but risks over-modeling before Engine behavior is proven.

An event-sourcing-adjacent model with near-complete events was rejected. It preserves stronger replay optionality but adds complexity and risks making replay implicitly load-bearing.

Full event sourcing was rejected. The accepted model uses current runtime state as operational truth and resume-based recovery.

Storing full logs and artifact payloads in current state was rejected. It would make operational state heavy and blur storage responsibilities.

Log-only inspection was rejected. Inspection must be workflow-aware, not only stream-oriented.

## Open Questions

1. What exact fields belong in minimum current runtime state?
2. What exact milestone event types are required for the prototype?
3. What artifact metadata is canonical in the Artifact Store versus copied into current state?
4. Are logs modeled as artifacts, artifact-like payloads, or a separate log stream concept?
5. How are state updates, event appends, and artifact registrations made consistent?
6. How much attempt-level history belongs in current state versus the Event Log?
7. What read models are needed for CLI and dashboard inspection?
8. What payload retention assumptions are acceptable for the prototype?
9. What storage interface is needed so local storage can later evolve into self-hosted or hosted storage?
10. What event versioning discipline is needed without overbuilding?

## Guardrails

1. Do not make the State Store so thin that recovery requires Event Log replay.
2. Do not make the Event Log so rich that the prototype becomes accidental event sourcing.
3. Do not put artifact payloads, full log payloads, or large outputs in current runtime state.
4. Do not make events the operational source of truth.
5. Do not allow the Executor to write authoritative workflow state directly.
6. Do not allow CLI or dashboard inspection to depend on persistence internals.
7. Do not encode local-only assumptions into the state/history/artifact model.
8. Do not require a specific storage technology at the architectural level.
9. Do not define exact schemas in this ADR.
10. Treat artifact storage as a separate Engine boundary even if implemented simply at first.

## Decision Summary

Use durable current runtime state as operational truth.

Use append-only milestone events as execution history.

Store artifact, log, and large output payloads separately.

Recover by resuming from current runtime state, not by replaying events.
