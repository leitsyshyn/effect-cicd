# ADR 0004: Single-Node Prototype Deployment Topology

## Status

Accepted

## Context

Local mode and self-hosted mode are first-class modes of the same system.

Local mode is used for workflow development, validation, and diagnosis. Self-hosted mode is used for CI/CD execution in customer-controlled environments.

Both modes must use the same workflow model, execution plan model, Engine model, execution semantics, runtime state semantics, and inspection model.

ADR 0001 selects a single-node embedded container Executor behind an explicit Orchestrator / Executor boundary. ADR 0002 selects current runtime state as operational truth with resume-based recovery. ADR 0003 selects an Engine-owned control and inspection contract.

This ADR decides prototype deployment topology. It does not redefine execution semantics, runtime state, artifact storage, recovery, Interface contracts, or future worker architecture.

## Decision

The prototype will use a single-node deployment topology for both local mode and self-hosted mode.

In local mode, the Engine runs in a user-operated local environment, normally started, embedded, or invoked by the CLI.

In self-hosted mode, the same Engine model runs as a customer-operated single-node deployment on customer-controlled infrastructure.

The Engine and embedded LocalContainerExecutor may be packaged in the same process or deployable unit. That is a packaging choice, not a semantic distinction.

The Orchestrator / Executor boundary remains mandatory even when both are packaged together.

The prototype does not include a separate worker process as a required deployment component. It does not include worker pools, remote dispatch, worker registration, leases, heartbeats, distributed scheduling, multi-node assignment, hosted control plane, or managed execution infrastructure.

The main difference between local mode and self-hosted mode is operating environment, not Engine semantics.

## Rationale

A full worker-based deployment is not required to make the prototype conceptually meaningful.

The prototype needs to demonstrate a real Engine topology:

```text
Define workflow in TypeScript
Derive explicit execution plan
Create workflow run
Evaluate DAG readiness
Dispatch execution unit
Run execution unit in an isolated container
Collect result, logs, outputs, and artifact metadata
Persist runtime state
Record execution history
Expose workflow-aware inspection
```

A single-node topology is enough to demonstrate this loop.

The important boundary is the Executor seam, not a separate worker process. The Executor seam gives the system a worker-compatible execution boundary without requiring worker lifecycle, distributed queues, leases, heartbeats, remote dispatch, or multi-node recovery in the prototype.

This keeps the prototype operationally simple while preserving the path to later topologies:

```text
Prototype:
  Orchestrator -> embedded LocalContainerExecutor

Later single-node worker packaging:
  Orchestrator -> local Worker -> container execution

Later multi-node self-hosted:
  Orchestrator -> Worker pool -> container execution

Later hosted:
  hosted topology -> managed workers -> execution substrate
```

## Consequences

### Positive

The prototype remains operationally simple.

Local and self-hosted modes share one Engine model instead of diverging into separate implementations.

The design supports a complete local prototype and a customer-operated single-node self-hosted prototype.

The Executor boundary preserves a path to a separate worker process, multi-node self-hosted workers, and later hosted execution.

The topology does not force Kubernetes, hosted infrastructure, or external CI systems into the prototype.

Inspection remains Engine-backed and workflow-aware.

### Negative

The prototype does not validate multi-node topology behavior.

The prototype does not validate worker registration, worker leases, worker heartbeats, distributed queues, distributed scheduling, remote artifact transfer, or worker-loss recovery.

Self-hosted mode is initially single-node only.

The implementation must avoid local-only shortcuts that would make self-hosted mode a different system later.

The packaging model still needs lower-level decisions for local process lifecycle, self-hosted startup, and persistence location.

## Alternatives Considered

Separate local and self-hosted engines were rejected. Local and self-hosted are modes of the same system, not separate implementations.

A full multi-node worker topology was rejected for the prototype. It adds distributed execution concerns before the single-node Engine loop is proven.

A required separate worker process was rejected as the minimum topology. It may be introduced later, but the prototype only requires an embedded Executor behind a stable boundary.

A local-only CLI runner was rejected. It would bypass the Engine model and weaken local/self-hosted parity.

A hosted-first prototype was rejected. Hosted control plane and managed execution infrastructure are future topology concerns.

A Kubernetes-native prototype topology was rejected as the default. Kubernetes may be supported later, but it should not define the prototype shape.

An external CI backend was rejected because the product owns execution.

## Open Questions

1. Should local mode embed the Engine in the CLI process, start a local Engine process, or support both through the same Engine entrypoint?
2. What is the minimum Engine operation surface needed by both CLI and dashboard?
3. What is the minimum Engine read model needed for useful workflow-aware inspection?
4. What persistence packaging should local mode and self-hosted mode use?
5. What process lifecycle should the self-hosted single-node Engine use?
6. What command should start the self-hosted prototype deployment?
7. When should the embedded Executor be promoted into a separate local worker process?
8. What signals indicate that the prototype needs a real worker topology rather than only the Executor seam?

## Guardrails

1. Do not implement separate local and self-hosted Engines.
2. Do not implement local mode as a lightweight runner with different semantics.
3. Do not let CLI execution bypass Engine operations.
4. Do not let dashboard reads bypass Engine-owned read models.
5. Do not collapse the Orchestrator / Executor boundary because the topology is single-node.
6. Do not treat runtime state as incidental in-memory local execution state.
7. Do not embed artifact payloads directly into current runtime state.
8. Do not hard-code local filesystem assumptions into workflow semantics.
9. Do not couple self-hosted mode to a specific infrastructure platform.
10. Preserve a path to separate workers, multi-node self-hosted deployment, and later hosted modes.

## Decision Summary

Use a single-node deployment topology for the prototype.

Local mode runs the same Engine model in a user-operated local environment.

Self-hosted mode runs the same Engine model as a customer-operated single-node deployment.

The embedded LocalContainerExecutor remains behind an explicit Executor boundary.

Separate workers, worker pools, multi-node self-hosted execution, hosted control plane, and managed execution infrastructure are deferred.
