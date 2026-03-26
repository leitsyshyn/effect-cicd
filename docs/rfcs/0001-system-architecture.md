# RFC 0001: System Architecture

## 1. Summary

This RFC defines the high-level architecture of a code-first CI/CD product with a native TypeScript workflow DSL, a product-owned execution engine, and product-owned control and inspection surfaces.

The system has three architectural layers:

- DSL
- Engine
- Interface

The system supports two execution modes:

- local
- self-hosted

Local and self-hosted are operating modes of the same system. The architecture must also preserve a path to later hosted modes without redefining the workflow model or execution model.

## 2. Context

The product vision defines the system as a primary CI/CD product, not an add-on to YAML-based CI systems. Its defining properties are a native TypeScript workflow model, product-owned execution, local-first workflow development, self-hosted operation as a first-class mode, workflow-aware inspection, and native reuse within the workflow model.

The product requirements define the current product around a native TypeScript workflow DSL, local execution through a CLI, a dashboard for inspection and control, self-hosted operation on customer-controlled infrastructure, and the same workflow model for local and self-hosted use.

This RFC defines the system shape required by those constraints. It does not define detailed engine internals, storage design, scheduling design, deployment topology, protocol design, UI design, or implementation sequence.

## 3. Core Concepts

### Workflow Definition

A CI/CD workflow authored in the product's TypeScript DSL.

### Execution Plan

The engine-derived executable form of a workflow definition.

### Workflow Run

A single execution of an execution plan.

### Execution Unit

A discrete unit of execution within a workflow run and a corresponding unit of inspection.

### Execution Engine

The product-owned runtime that validates workflow definitions, derives execution plans, executes workflow runs, and maintains runtime state.

### Runtime State

The authoritative execution record for workflow structure, progress, failures, and outcomes.

## 4. High-Level Architecture

### DSL Layer

Primary purpose: authoring model.

Responsibility: define the native TypeScript workflow model, including workflow structure, reuse, and composition.

### Engine Layer

Primary purpose: execution model.

Responsibility: validate workflow definitions, derive execution plans, execute workflow runs, and maintain runtime state for control and inspection.

### Interface Layer

Primary purpose: control and inspection surfaces.

Responsibility: expose execution control and workflow-aware inspection through product surfaces such as the CLI and dashboard, using engine operations and engine-owned runtime state.

## 5. Execution Modes

### Local

Local mode executes workflows in a user-operated local environment for development, validation, and diagnosis.

### Self-hosted

Self-hosted mode executes workflows through a customer-operated deployment of the product on customer-controlled infrastructure.

### Mode Relationship

Local and self-hosted are operating modes of the same system. They share the same workflow definition model, execution model, and inspection model. They differ in operating environment, not in product identity or architectural layer structure.

The architecture must permit later hosted control-plane and hosted execution modes without redefining these system boundaries.

## 6. System Model

A workflow is defined in the DSL layer as a workflow definition.

The engine layer validates the workflow definition and derives an execution plan.

The engine executes the execution plan as a workflow run composed of execution units.

As execution proceeds, the engine produces and updates runtime state.

The interface layer reads runtime state for workflow-aware inspection and issues control operations against engine-managed workflow runs.

The same model applies in local and self-hosted operation. A workflow definition authored for local development remains a workflow definition for self-hosted execution. An execution plan remains an engine concern. A workflow run remains the unit of execution. Runtime state remains the basis for control and inspection.

## 7. Architectural Invariants

- Workflow definition is native to the product and expressed through the TypeScript DSL.
- Reuse and composition are native to the workflow model, not compatibility layers over external CI formats.
- Execution is product-owned. The system is not a wrapper over external CI engines and is not an add-on to YAML-based CI systems.
- Workflow definition, execution plan, workflow run, execution unit, and runtime state form one shared system model across all product surfaces and execution modes.
- Local and self-hosted execution are modes of the same system and must preserve semantic consistency of workflow definition, execution, and inspection.
- Runtime state is authoritative for workflow-aware inspection and operational control.
- The interface layer operates over engine-managed execution and engine-owned runtime state; it does not define an independent execution model.
- The system is scoped to CI/CD workflows. It does not include source control, general-purpose automation outside CI/CD, or external CI systems as the primary execution model.
- The architecture must preserve a path to later hosted modes without changing the workflow model or execution model.

## 8. Scope

This RFC defines:

- the system boundary
- the core execution and inspection model
- the three-layer architecture
- the distinction between architectural layers and execution modes
- the shared model required across local and self-hosted operation
- the requirement to preserve a path to later hosted modes

This RFC does not define:

- exact DSL syntax
- detailed engine subsystem decomposition
- exact runtime state schema
- exact storage design
- exact scheduling design
- exact execution-unit granularity
- exact interface protocols
- exact dashboard UX
- exact self-hosted deployment topology
- implementation sequencing

## 9. Tradeoffs

A product-owned workflow model and execution engine produce a more coherent system for authoring, execution, inspection, and reuse, but they expand system scope relative to integrating with existing CI platforms.

Using one shared model across local and self-hosted operation improves parity and reduces conceptual fragmentation, but it constrains environment-specific specialization.

Treating runtime state as authoritative for inspection enables workflow-aware visibility and control, but it requires the engine to maintain an explicit execution record rather than relying on transient process behavior alone.

Preserving a path to later hosted modes keeps the architecture aligned with long-term product direction, but it limits architecture choices that would hard-code the current operating modes.

## 10. Unresolved Technical Questions

- What is the minimum stable execution semantics required to make local behavior a reliable predictor of self-hosted behavior?
- What runtime state model is sufficient for workflow-aware inspection without prematurely fixing internal engine structure?
- What execution-unit granularity is required for useful control and inspection while keeping the execution model stable?
- What interface-to-engine boundary should be formalized so that CLI and dashboard remain interchangeable surfaces over the same runtime model?
- What deployment-facing engine boundaries are required now so that self-hosted topologies and later hosted modes can vary without changing the workflow model?

## 11. Related ADRs

Likely follow-up ADRs:

- Native TypeScript DSL as the workflow definition model
- Product-owned execution as the primary execution model
- Runtime state as the basis for workflow-aware inspection and control
- Local and self-hosted operation as execution modes of one system
- Interface-to-engine boundary for control and inspection surfaces
- Hosted-mode extensibility without workflow-model change
