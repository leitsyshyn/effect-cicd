# ADR 0001: Prototype Execution Model

## Status

Accepted

## Context

The prototype uses native TypeScript workflow definitions, explicit execution plans, and static DAG workflows.

The Engine owns workflow execution and runtime state. The Planner derives execution plans. The Orchestrator owns workflow-run semantics, dependency evaluation, dispatch decisions, retries, cancellation, and state transitions. The Executor runs isolated execution units and reports normalized execution results.

Containerized execution is the default execution substrate. Runtime state is the operational source of truth. Execution history is append-only history, not the operational source of truth. Recovery is resume-based, not replay-based durable execution.

This ADR decides the prototype execution model. It does not decide deployment topology, storage schemas, worker protocols, transport APIs, scheduling algorithms, or hosted infrastructure.

## Decision

The prototype will use a single-node embedded container Executor behind an explicit Orchestrator / Executor boundary.

The Orchestrator dispatches execution units to the Executor. The Executor runs execution units in isolated containerized environments and returns normalized execution results.

The Orchestrator and Executor may be packaged in the same process or deployable unit, but they remain separate Engine responsibilities.

The prototype will not implement a worker pool, remote dispatch, worker registration, worker leases, heartbeats, distributed scheduling, multi-node assignment, or multi-node recovery.

The prototype will not use direct host execution as the default substrate.

The prototype will not introduce a broad substrate-neutral execution framework. Containerized execution is the only implemented substrate. Container-specific mechanics must remain inside the Executor and must not leak into Orchestrator semantics.

## Rationale

A full multi-node worker system is too expensive for the prototype. It would require worker registration, assignment, leases, heartbeats, remote dispatch, distributed failure handling, remote log and artifact transfer, and worker-loss recovery before the core Engine loop is proven.

Directly placing container execution inside Orchestrator logic would create the wrong coupling. The Orchestrator would begin to own execution mechanics instead of workflow semantics.

The selected model preserves the critical boundary without implementing fake distributed infrastructure.

The core rule is:

```text
The Orchestrator interprets execution units.
The Executor runs execution units.
```

The Orchestrator decides readiness, dispatch, retries, cancellation policy, state transitions, and workflow outcome. The Executor prepares the isolated environment, runs the unit, captures logs, collects outputs, records artifact metadata, captures execution-local failure information, and returns an execution result.

This keeps the prototype lean while preserving a clear path to later worker-based execution.

## Consequences

### Positive

The prototype remains implementable.

The Engine can support the core execution loop: plan, create run, evaluate DAG readiness, dispatch execution unit, execute in container, collect result, persist runtime state, record history, store artifact references, and expose inspection data.

Container mechanics stay inside the Executor. Workflow semantics stay inside the Orchestrator.

The design avoids fake distributed abstractions while preserving a path to worker-based self-hosted execution.

The design avoids making host-specific behavior the default execution model.

### Negative

The prototype does not validate multi-node execution behavior.

The prototype does not test worker-loss recovery, distributed scheduling, remote artifact transfer, worker registration, leases, or heartbeats.

The implementation must still build a minimal container execution lifecycle.

The Orchestrator / Executor boundary must be actively preserved. If the Orchestrator starts managing low-level container lifecycle directly, the future worker path is weakened.

Execution attempt metadata may be needed earlier than in a purely linear toy runner.

## Alternatives Considered

Full multi-node worker pool in the prototype was rejected for scope. It models the future architecture more directly, but introduces distributed execution concerns before the single-node Engine loop is proven.

Direct host execution as the default was rejected. It simplifies the earliest spike but weakens isolation, reproducibility, and local/self-hosted parity.

A generic substrate-neutral execution framework was rejected for the prototype. There is only one real substrate now: containerized execution.

Kubernetes-only execution was rejected as the prototype default. It adds deployment complexity and narrows the product shape too early.

Using an external CI system as the Executor was rejected because the product owns execution.

Replay-based durable execution was rejected because the accepted recovery model is resume from persisted current runtime state.

## Open Questions

1. What exact execution-unit lifecycle states are required?
2. What minimum execution attempt metadata should be persisted?
3. How should interrupted running units be represented after restart?
4. What cancellation behavior is required in the prototype?
5. What retry behavior is required in the prototype?
6. What minimum local concurrency should the embedded Executor support?
7. Should host execution be explicitly excluded from V1 or left as a later development-only escape hatch?
8. Which parts of the Executor boundary must be stable before introducing a separate worker process?

## Guardrails

1. Do not let the Orchestrator manage low-level container lifecycle mechanics.
2. Do not let the Executor own workflow graph interpretation, dependency evaluation, retry policy, cancellation policy, or final workflow outcome.
3. Do not let the Executor mutate authoritative runtime state directly.
4. Do not introduce worker-pool concepts until there is a real worker topology.
5. Do not make host execution the default execution substrate.
6. Do not introduce a generic multi-substrate framework before there is more than one real substrate.
7. Do not leak container-specific mechanics into workflow planning, state transitions, or Interface read models.
8. Preserve normalized Executor results so a future worker-backed Executor can be introduced without rewriting Orchestrator semantics.

## Decision Summary

Use a single-node embedded container Executor with an explicit Orchestrator / Executor boundary.

Containerized execution is the prototype default. Multi-node workers, direct host execution as default, and broad substrate abstraction are deferred.
