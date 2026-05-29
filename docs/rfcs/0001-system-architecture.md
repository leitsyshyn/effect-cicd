# RFC 0001: System Architecture

## 1. Summary

This RFC defines the system architecture of a code-first CI/CD product with:

- a native TypeScript workflow DSL
- a product-owned execution engine
- product-owned control surfaces

The system has three architectural layers:

- DSL
- Engine
- Interface

The system operates in two modes:

- local
- self-hosted

Both modes use the same workflow definition and execution model. The architecture preserves a path to hosted modes.

## 2. Context

The product is defined by these properties:

- native TypeScript workflow definition
- product-owned execution
- local-first workflow development
- self-hosted operation as a first-class mode
- workflow-aware inspection
- native reuse within the workflow model

This RFC defines the system shape required to support those properties.

## 3. Core Concepts

### Workflow Definition

A CI/CD workflow authored in the product’s TypeScript DSL.

### Workflow Run

A single execution of a workflow definition by the product-owned engine.

### Execution Engine

The runtime that executes workflow runs and maintains runtime state.

### Runtime State

The authoritative execution record for workflow structure, progress, failures, and outcomes.

### Execution Mode

An operating context in which the same workflow and execution model are used.

## 4. High-Level Architecture

### DSL Layer

Primary purpose: authoring model.

Responsibility: define the native workflow model, including workflow structure, reuse, and composition.

### Engine Layer

Primary purpose: execution model.

Responsibility: execute workflow runs and maintain runtime state for control and inspection.

### Interface Layer

Primary purpose: control and inspection surfaces.

Responsibility: expose execution control and workflow-aware inspection through product surfaces such as the CLI and dashboard.

## 5. Execution Modes

### Local

Local mode executes workflows in a user-operated local environment for development, validation, and diagnosis.

### Self-Hosted

Self-hosted mode executes workflows through a customer-operated deployment on customer-controlled infrastructure.

### Mode Relationship

Local and self-hosted are operating modes of the same system. They differ in operating environment, not in workflow model, execution model, or architectural layer structure.

## 6. System Model

A workflow is authored in the DSL layer and executed by the Engine layer.

The Engine layer manages workflow runs and runtime state.

The Interface layer exposes control and inspection over engine-managed workflow runs and runtime state.

The same system model applies in local and self-hosted operation.

## 7. Architectural Invariants

- Workflow definition is native to the product and expressed through the TypeScript DSL.
- Reuse and composition are native to the workflow model.
- Execution is product-owned.
- Local and self-hosted operation use the same workflow definition and execution model.
- Runtime state is authoritative for workflow-aware inspection and operational control.
- The Interface layer operates over engine-managed execution and engine-owned runtime state.
- Hosted modes may be added without redefining the workflow or execution model.

## 8. Scope

This RFC defines:

- the system boundary
- the three-layer architecture
- the distinction between architectural layers and execution modes
- the shared model across local and self-hosted operation
- the requirement to preserve a path to hosted modes

This RFC does not define:

- exact DSL syntax
- engine subsystem decomposition
- exact runtime state schema
- exact storage design
- exact interface protocols
- exact deployment topology
- implementation sequencing

## 9. Tradeoffs

- Product-owned execution increases system scope relative to integrating with existing CI platforms.
- A shared model across local and self-hosted operation improves consistency, but constrains environment-specific specialization.
- Runtime-state-based inspection improves visibility and control, but requires an explicit execution record.
- Preserving a path to hosted modes limits architecture choices that hard-code current operating modes.

## 10. Unresolved Technical Questions

- What system-level control contract must all interface surfaces share over the Engine layer?
- What deployment-facing boundaries must remain stable so hosted modes can be added without changing the workflow or execution model?
- What degree of semantic consistency across local and self-hosted operation must the system preserve?

## 11. Related ADRs

Likely follow-up ADRs:

- Native TypeScript DSL as the workflow definition model
- Product-owned execution as the primary execution model
- Runtime state as the basis for workflow-aware inspection and control
- Local and self-hosted operation as execution modes of one system
- Hosted-mode extensibility without workflow-model change
