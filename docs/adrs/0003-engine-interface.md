# ADR 0003: Engine / Interface Contract

## Status

Accepted

## Context

The system has three architectural layers:

```text
DSL
Engine
Interface
```

The Engine owns workflow execution, runtime state, execution history, artifact metadata, and inspection composition.

The Interface layer exposes product control and inspection through surfaces such as the CLI and dashboard.

The Interface must not become a persistence client. CLI and dashboard surfaces must share canonical Engine semantics even if they present data differently.

This ADR decides the architectural contract between the Engine and Interface layers. It does not define transport protocols, endpoint lists, exact method names, schemas, package layout, BFF design, CQRS design, frontend architecture, or storage implementation.

## Decision

The prototype will use an Engine-owned control and inspection contract.

The CLI and dashboard interact with the Engine through Engine-owned operations and Engine-backed reads.

The Interface layer must not access State Store, Event Log, Artifact Store, Planner internals, Orchestrator internals, or Executor internals directly.

The contract has two architectural responsibilities:

```text
Control:
  operations that affect workflow-run lifecycle

Inspection:
  Engine-owned views over workflow execution
```

Control includes operations such as validating, planning, starting, canceling, resuming, or retrying workflow runs where those capabilities are implemented.

Inspection includes workflow-aware views of run status, execution plan structure, execution-unit state, progress, failures, events, logs, artifacts, and outcomes.

The control/inspection split is an architectural responsibility split. It does not require separate services, CQRS, nested API objects, a BFF, projections, or interface-specific adapters in the prototype.

## Rationale

The Engine owns execution semantics. The Interface owns presentation, user interaction, and product control surfaces.

If CLI or dashboard code reads persistence internals directly, storage shapes become the de facto product contract. That would weaken Engine ownership and make future topology, storage, and inspection changes harder.

A stable Engine-owned contract keeps execution semantics canonical across surfaces.

The selected model also preserves implementation optionality. The system may later introduce BFF-style composition, CQRS-style internals, read projections, streaming APIs, remote APIs, or interface-specific adapters. Those mechanisms remain valid only if they preserve the Engine boundary.

## Consequences

### Positive

CLI and dashboard share canonical Engine semantics.

The Engine remains the owner of workflow-run lifecycle, execution-unit semantics, runtime state, history, artifact metadata, and inspection composition.

Persistence schemas and storage implementation remain hidden behind the Engine boundary.

The prototype can start with a simple in-process or local contract without locking out future remote APIs, projections, streaming reads, or BFF-style composition.

Future interfaces can reuse the same control and inspection semantics.

### Negative

The Engine must expose enough control and inspection capability to prevent Interface code from bypassing it.

Some read composition must live in or behind the Engine earlier than it would in a quick UI-driven prototype.

The team must avoid treating presentation-specific DTOs as the only canonical Engine read model.

Interface-specific shaping may still be needed later for dashboard-heavy inspection views.

## Alternatives Considered

A thin Engine facade was rejected as the architectural decision. It may be simple to implement, but it is too weak unless it clearly owns control and inspection semantics.

Direct Interface access to persistence internals was rejected. It couples product surfaces to storage implementation.

Interface-owned execution semantics were rejected. CLI and dashboard must not define workflow lifecycle, execution-unit transitions, retry behavior, cancellation behavior, failure semantics, or recovery semantics.

Separate unrelated CLI and dashboard contracts were rejected. The surfaces may present data differently, but must share canonical Engine semantics.

Mandatory BFF or query subsystem was rejected as a prototype requirement. It may be introduced later if useful.

Mandatory code-level CQRS was rejected. Control and inspection are architectural responsibilities, not required implementation modules.

## Open Questions

1. What exact Engine operations are needed for the first useful CLI flow?
2. What exact Engine reads are needed for the first useful dashboard inspection flow?
3. Should resume be included in the initial control surface or deferred until recovery behavior is implemented?
4. Should retry be included in the initial control surface or deferred until retry semantics are designed?
5. What inspection concepts must be canonical across CLI and dashboard?
6. When would interface-specific read shaping become justified?
7. When would materialized read models or projections become justified?
8. Should live run updates be part of the initial inspection contract or deferred?
9. What artifact and log references are required for useful inspection?
10. Which follow-up ADR should decide transport or protocol shape if needed?

## Guardrails

1. Do not let CLI or dashboard access raw State Store, Event Log, or Artifact Store internals.
2. Do not let CLI or dashboard define workflow-run lifecycle semantics.
3. Do not let CLI or dashboard define execution-unit transition semantics.
4. Do not make presentation-specific DTOs the only canonical Engine read model.
5. Do not require a BFF, CQRS, projections, streaming, or remote API in this ADR.
6. Do not forbid BFF, CQRS, projections, streaming, or remote API as future implementation choices.
7. Do not require separate CLI/dashboard adapters at the beginning.
8. Do not block separate CLI/dashboard adapters if later justified.
9. Do not define exact endpoint lists, transport protocols, or storage schemas in this ADR.
10. Preserve local/self-hosted consistency at the Engine contract boundary.

## Decision Summary

Use an Engine-owned control and inspection contract.

CLI and dashboard consume Engine-owned workflow lifecycle operations and Engine-backed inspection reads.

The Interface layer must not access persistence internals or define execution semantics.
