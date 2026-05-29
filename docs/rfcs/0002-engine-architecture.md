# RFC 0002: Engine Architecture

## 1. Summary

This RFC defines the architecture of the Engine layer.

The Engine layer is responsible for:

- turning workflow definitions into explicit execution plans
- orchestrating workflow runs
- executing isolated execution units
- maintaining durable current runtime state
- recording execution history
- storing artifact payloads and artifact metadata

The Engine layer is composed of these subsystems:

- Planner
- Orchestrator
- Executor
- State Store
- Event Log
- Artifact Store

## 2. Context

RFC 0001 defines the overall system architecture and assigns execution responsibility to the Engine layer.

This RFC narrows the Engine layer only.

The following engine decisions are fixed:

- workflows are initially static DAGs
- workflow definitions are turned into explicit execution plans before execution
- containerized execution is the default execution model
- persisted current runtime state is the operational source of truth
- append-only execution history is recorded, but is not the operational source of truth
- recovery is based on resume from persisted state, not replay-based durable execution
- the architecture must preserve a path to multi-node, worker-based self-hosted operation
- the architecture must preserve a path to hosted deployment without changing engine semantics

## 3. Core Concepts

### Execution Plan

The explicit executable plan derived from a workflow definition.

### Workflow Run

A single execution of an execution plan.

### Execution Unit

A discrete unit of execution within a workflow run.

### Runtime State

The authoritative current execution record for workflow runs and execution units.

### Execution Event

An append-only historical record of a significant execution transition or outcome.

### Artifact

A payload produced or consumed by execution and referenced from runtime state.

## 4. Engine Responsibilities

The Engine layer is responsible for:

- validating and normalizing workflow definitions
- deriving explicit execution plans
- managing workflow run lifecycle
- determining execution-unit readiness and transitions
- dispatching execution units for isolated execution
- persisting authoritative current runtime state
- recording append-only execution history
- storing artifact payloads and artifact metadata
- exposing engine operations and engine-backed inspection data to the Interface layer

The Engine layer does not own source control, general-purpose automation outside CI/CD, or external CI systems as its primary execution model.

## 5. High-Level Engine Architecture

### Planner

Responsibility: validate workflow definitions, normalize workflow structure, and derive explicit execution plans.

### Orchestrator

Responsibility: own workflow-run lifecycle, execution-unit state transitions, dependency satisfaction, retries, cancellation, and dispatch decisions.

### Executor

Responsibility: execute isolated execution units and report outcomes, logs, outputs, and artifact metadata back to the Engine.

### State Store

Responsibility: persist the authoritative current operational state of workflow runs and execution units.

### Event Log

Responsibility: record append-only execution events for history, audit, and inspection.

### Artifact Store

Responsibility: store artifact payloads and artifact metadata referenced by workflow runs and execution units.

## 6. Engine Interaction Model

The Planner receives a workflow definition and produces an execution plan.

The Orchestrator creates and advances a workflow run from that execution plan.

The Orchestrator determines which execution units are ready, dispatches them to the Executor, and applies valid state transitions as outcomes are reported.

The Executor performs isolated execution and returns:

- execution outcome
- logs
- outputs
- artifact metadata
- execution-local failure information

The State Store persists current runtime state.

The Event Log records append-only execution history.

The Artifact Store persists artifact payloads and associated metadata.

The Interface layer interacts with the Engine through engine-owned operations and engine-backed read models. It does not access persistence internals directly.

## 7. Execution Modes

### Local

The Engine executes workflow runs in a local environment under direct user control.

### Self-Hosted

The Engine executes workflow runs through a customer-operated deployment on customer-controlled infrastructure.

### Mode Relationship

Local and self-hosted are operating modes of the same Engine model.

## 8. Engine Invariants

- Workflow definitions are validated and turned into explicit execution plans before execution.
- Workflow runs and execution units are orchestrated by the product-owned Engine.
- The Orchestrator owns workflow-run semantics and execution-unit state transitions.
- The Executor does not own workflow semantics.
- Current runtime state is the authoritative operational source of truth.
- Execution history is append-only and does not replace current runtime state as the operational source of truth.
- Artifact payloads are stored separately from current runtime state; current state stores references and metadata, not heavy payloads.
- Local and self-hosted operation use the same engine model.
- Containerized execution is the default execution model.
- Recovery resumes from persisted current state and does not rely on replay-based durable execution.
- Hosted deployment may change topology and packaging, but must not redefine planning, orchestration, execution, or state semantics.
- Later evolution may introduce controlled plan expansion, but must not replace the static-plan foundation with arbitrary runtime flow semantics.

## 9. Scope

This RFC defines:

- the responsibilities of the Engine layer
- the major engine subsystems
- the interaction model across engine subsystems
- the split between current state, history, and artifacts
- the engine implications of local and self-hosted operation
- the architectural paths that must be preserved

This RFC does not define:

- exact plan schema
- exact runtime state schema
- exact event schema
- exact storage implementation
- exact scheduling algorithm
- exact worker protocol
- exact artifact format or retention policy
- detailed deployment topology
- implementation sequencing

## 10. Tradeoffs

- Explicit execution plans improve inspectability and control, but add a planning boundary the Engine must maintain.
- Separating orchestration from execution improves clarity and future scale paths, but increases coordination complexity.
- Treating current runtime state as authoritative simplifies control and recovery, but requires durable state management.
- Recording append-only history improves inspection and auditability, but adds a second persistence path beside current runtime state.
- Separating artifact payload storage from current state keeps runtime state lean, but introduces explicit artifact references and storage coordination.
- Preserving a path to multi-node self-hosted and hosted deployment prevents over-optimization for a narrow single-process runtime.

## 11. Unresolved Technical Questions

- What is the minimum execution-unit granularity required for stable orchestration, useful control, and useful inspection?
- What runtime state is the minimum required to support recovery and workflow-aware inspection?
- What execution events must always be recorded, and what events can remain optional?
- What ownership model is required to preserve a later path to multi-node worker-based execution?
- Which deployment-facing interfaces must be formalized so hosted deployment can be added without changing engine semantics?
- Which controlled forms of plan expansion are compatible with the static-plan foundation?

## 12. Related ADRs

Likely follow-up ADRs:

- Explicit execution plan as the boundary between workflow definition and execution
- Static DAG workflows as the initial engine model
- Orchestrator as the owner of workflow-run semantics
- Executor as an isolated execution subsystem
- State Store as the authoritative operational source of truth
- Event Log as append-only execution history
- Artifact Store as a separate payload boundary
- Resume-based recovery as the initial recovery model
- Containerized execution as the default execution model
- Preservation of a path to multi-node self-hosted and hosted deployment
- Controlled plan expansion without abandoning the static-plan foundation
