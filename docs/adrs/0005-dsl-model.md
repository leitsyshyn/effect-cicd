# ADR: DSL ↔ Engine Boundary

## Status

Accepted

## Context

The product uses a native TypeScript workflow definition model and a product-owned execution engine.

The system architecture has three layers:

```text
DSL
Engine
Interface
```

The DSL layer owns workflow authoring. It defines how users express workflow structure, reuse, and composition in TypeScript.

The Engine layer owns workflow execution. It validates workflow definitions, derives explicit execution plans, orchestrates workflow runs, executes isolated execution units, maintains runtime state, records execution history, and manages artifact/log payload boundaries.

The Interface layer owns control and inspection surfaces. It interacts with the Engine through Engine-owned operations and Engine-backed reads.

The existing architecture fixes these constraints:

- workflow definitions are native to the product and authored in TypeScript;
- local and self-hosted operation use the same workflow model and Engine model;
- workflows are initially static DAGs;
- workflow definitions are turned into explicit execution plans before execution;
- the Planner derives execution plans;
- the Orchestrator owns workflow-run semantics and execution-unit state transitions;
- the Executor runs isolated execution units and does not interpret workflow semantics;
- runtime state is the operational source of truth;
- recovery is resume-based, not replay-based durable execution;
- later controlled plan expansion may be possible, but the prototype is based on a static-plan foundation.

This ADR decides the architectural boundary between the DSL layer and the Engine layer.

It does not define final DSL syntax, exact TypeScript APIs, exact normalized workflow schema, exact execution-plan schema, or the full DSL subsystem design.

## Decision

The prototype will use a TypeScript-native declaration builder DSL that materializes into a normalized workflow definition before entering the Engine.

The DSL layer is responsible for evaluating authoring-time TypeScript declarations, resolving authoring-time composition, and producing a normalized workflow definition.

The Engine receives the normalized workflow definition. The Planner validates and converts it into an explicit execution plan.

The DSL must not hand arbitrary TypeScript workflow code, live builder objects, or executable authoring state to the Engine.

The DSL must not produce execution plans directly. Execution-plan derivation remains an Engine Planner responsibility.

The architectural boundary is:

```text
TypeScript declaration DSL
  -> normalized workflow definition
  -> Planner
  -> execution plan
  -> Orchestrator
  -> Executor
```

The normalized workflow definition is the stable conceptual boundary between authoring and planning.

## Rationale

A TypeScript-native declaration builder gives the product a code-first authoring model without reducing the workflow model to YAML-like configuration.

The builder form supports normal TypeScript reuse and composition while still requiring the workflow graph to be complete before planning starts.

This preserves the static DAG prototype model and keeps the Engine independent from final DSL syntax.

The selected boundary also preserves the distinction between workflow definition and execution plan:

```text
Workflow definition:
  normalized authoring intent produced by the DSL layer

Execution plan:
  executable structure derived by the Engine Planner
```

This distinction is necessary because the Planner owns Engine planning semantics. If the DSL produced execution plans directly, planning semantics would move into the DSL layer and weaken the Engine boundary.

The selected boundary also keeps runtime semantics out of the DSL. The DSL declares workflow structure and metadata. The Orchestrator owns runtime readiness, dependency satisfaction, retries, cancellation, execution-unit transitions, and final workflow outcome.

## Boundary Responsibilities

### DSL Layer Responsibilities

The DSL layer owns authoring semantics.

It is responsible for:

- TypeScript workflow declaration;
- authoring-time workflow composition;
- authoring-time reuse;
- static graph construction;
- static expansion where supported;
- unit declaration;
- dependency declaration;
- input, output, artifact, report, and metadata declaration;
- runtime-condition declaration as workflow metadata;
- source-location and diagnostic metadata where available;
- materializing a normalized workflow definition.

The DSL layer may provide ergonomic authoring constructs, but those constructs must lower into the normalized workflow definition before Engine planning starts.

### Normalized Workflow Definition Responsibilities

The normalized workflow definition is the Engine-facing representation of workflow intent.

It should conceptually contain:

- workflow identity;
- workflow metadata;
- trigger declarations;
- execution-unit declarations;
- dependency edges;
- declared inputs and outputs;
- declared artifact and report metadata;
- declared runtime conditions;
- declared retry, timeout, and execution policies where supported;
- source metadata useful for diagnostics and inspection;
- no unresolved authoring-only constructs.

The normalized workflow definition is not the execution plan.

### Planner Responsibilities

The Planner is an Engine subsystem.

It is responsible for:

- validating the normalized workflow definition against Engine rules;
- canonicalizing workflow structure where required;
- validating static DAG constraints;
- validating dependency references;
- validating execution-unit requirements;
- validating supported policy declarations;
- deriving an explicit execution plan.

The Planner must not depend on final DSL syntax.

### Orchestrator Responsibilities

The Orchestrator owns workflow-run semantics.

It is responsible for:

- creating and advancing workflow runs from execution plans;
- evaluating execution-unit readiness;
- applying dependency satisfaction rules;
- applying retry and cancellation semantics;
- applying runtime conditions;
- dispatching ready execution units;
- applying valid runtime state transitions;
- determining final workflow outcome.

The Orchestrator must not depend on TypeScript authoring constructs.

### Executor Responsibilities

The Executor runs isolated execution units.

It is responsible for:

- preparing the isolated execution environment;
- executing commands or unit payloads;
- capturing logs;
- collecting outputs;
- collecting artifact metadata;
- reporting execution-local failure information;
- returning normalized execution results.

The Executor must not own workflow graph interpretation, dependency evaluation, retry policy, cancellation policy, or final workflow outcome.

## Authoring-Time vs Runtime Semantics

The DSL may use TypeScript during authoring to construct the workflow definition.

Authoring-time TypeScript may be used for:

- helper functions;
- reusable workflow fragments;
- static loops over known values;
- static construction of related units;
- composition of declared units;
- shared constants;
- static configuration assembly.

Authoring-time TypeScript must not be used to express runtime workflow control flow in the prototype.

Runtime workflow behavior must be represented as declared workflow metadata that the Planner and Orchestrator can understand.

For example:

- a conditional unit should exist in the static graph with a declared runtime condition;
- retry behavior should be declared as execution-unit policy metadata;
- dependencies should be explicit in the normalized workflow definition;
- execution-time outputs must not create new units in the prototype.

The prototype workflow graph must be complete before the Planner derives the execution plan.

## Static DAG Requirement

The prototype uses static DAG workflows.

This means:

- all execution units are known before execution starts;
- all dependency edges are known before execution starts;
- the Planner can derive an explicit execution plan before execution starts;
- the Interface layer can inspect planned workflow structure before and during execution;
- the Orchestrator executes a plan rather than discovering arbitrary new graph structure at runtime.

Static authoring-time expansion is allowed if it resolves before planning.

Runtime plan mutation is not part of the prototype boundary.

Later controlled plan expansion may be designed separately, but it must be explicit, inspectable, and compatible with the static-plan foundation.

## TypeScript Expressiveness

The DSL may use TypeScript as an authoring language.

Compatible TypeScript expressiveness includes:

- functions that declare reusable workflow fragments;
- constants and configuration objects;
- static loops over authoring-time values;
- static conditional construction based on authoring-time configuration;
- composition helpers that return symbolic workflow references;
- module-level reuse across workflow files.

Incompatible prototype behavior includes:

- using execution-time outputs to create new units;
- using runtime state to alter the graph shape;
- treating workflow unit declarations as immediate execution;
- hiding dependency edges in arbitrary side effects;
- requiring the Engine to evaluate or interpret arbitrary TypeScript authoring code;
- allowing local/self-hosted mode to produce different workflow semantics from the same workflow definition.

The DSL SDD must define the exact allowed and disallowed authoring patterns.

## Decision Consequences

### Positive

The product gets a code-first authoring model without making the Engine depend on final DSL syntax.

The Engine receives a stable normalized workflow definition.

The Planner remains the owner of execution-plan derivation.

The prototype can preserve static DAG planning.

Workflow-aware inspection is easier because planned units, dependencies, conditions, policies, artifacts, and source metadata can be known before execution starts.

Local and self-hosted modes can use the same workflow definition and Engine model.

The design leaves room for richer DSL ergonomics later without changing the Engine boundary.

The design leaves room for controlled plan expansion later without making runtime mutation part of the prototype.

### Negative

The DSL implementation must define a materialization step instead of passing builder state directly into the Engine.

The DSL must distinguish authoring-time TypeScript from runtime workflow semantics.

Some unrestricted TypeScript patterns must be rejected or constrained.

The first DSL SDD must define enough authoring rules to prevent ambiguous graph construction.

The normalized workflow definition becomes an important internal contract and will need versioning discipline.

## Alternatives Considered

### Declarative TypeScript Object Model

A purely declarative TypeScript object model was considered.

It has the lowest implementation complexity and strongest static analyzability. It maps directly to a normalized workflow definition.

It was not selected as the primary boundary because it risks making the authoring experience feel too close to configuration assembly. It also weakens the product’s code-native authoring identity compared with a declaration builder.

It remains a possible lower-level representation or compatibility surface.

### Imperative TypeScript Authoring with Extraction

A more imperative TypeScript authoring model was considered.

It would allow users to write workflow definitions that look closer to ordinary programs. However, it creates ambiguity between authoring-time execution, graph construction, and workflow runtime execution.

It also increases the risk of hidden dynamic plan behavior, weak static analyzability, and unclear inspection semantics.

It was rejected for the prototype boundary.

### DSL Produces Execution Plans Directly

Having the DSL produce execution plans directly was considered and rejected.

The Planner is the Engine subsystem responsible for deriving explicit execution plans. If the DSL produces plans directly, planning semantics move into the DSL layer and the Engine boundary becomes unclear.

The DSL produces normalized workflow definitions. The Planner produces execution plans.

### Engine Executes TypeScript Workflow Code Directly

Direct execution of arbitrary TypeScript workflow code by the Engine was rejected.

It would collapse the DSL and Engine boundary, make execution planning implicit, weaken inspection, and contradict the requirement that workflow definitions are converted into explicit execution plans before execution.

### Runtime Plan Mutation as Prototype Default

Runtime graph mutation was rejected as the prototype default.

It may be useful later as controlled plan expansion, but it introduces planning, inspection, ordering, state, and recovery complexity before the static Engine loop is proven.

### External CI Configuration as the Engine-Facing Model

External CI configuration was rejected as the Engine-facing workflow model.

The product owns its workflow model and execution engine. External CI formats must not become the primary authoring or Engine-facing representation.

## Open Questions

1. What exact normalized workflow definition schema is required for the prototype?
2. Which validations belong in DSL materialization versus Planner validation?
3. What source-location metadata should the DSL preserve for diagnostics and inspection?
4. How should reusable workflow fragments be represented after materialization?
5. Which static expansion patterns should the first DSL support?
6. Should matrix-like expansion be explicit in the DSL or expressed through ordinary TypeScript helpers?
7. How should runtime conditions be represented in the normalized workflow definition?
8. What retry, timeout, and cancellation policy declarations are needed in the first version?
9. How should workflow-definition compatibility and versioning be handled?
10. Should normalized workflow definitions be persisted as run artifacts, stored in runtime state, or treated only as Planner inputs?
11. What minimum DSL diagnostics are required for a useful authoring loop?
12. What later ADR or SDD should define controlled plan expansion?

## Guardrails

1. Do not pass live DSL builder objects into the Engine.
2. Do not let the DSL produce execution plans directly.
3. Do not let the Engine interpret arbitrary TypeScript authoring code.
4. Do not let execution-time outputs create new units in the prototype.
5. Do not hide runtime workflow semantics inside authoring-time TypeScript control flow.
6. Do not allow the Executor to own dependency evaluation, retry policy, cancellation policy, or workflow outcome.
7. Do not let local and self-hosted modes use different workflow semantics.
8. Do not make the normalized workflow definition depend on final DSL syntax.
9. Do not make runtime plan mutation part of the prototype.
10. Preserve the static-plan foundation so later controlled expansion can be introduced deliberately.

## Decision Summary

Use a TypeScript-native declaration builder DSL.

The DSL materializes to a normalized workflow definition.

The Engine receives the normalized workflow definition.

The Planner derives the explicit execution plan.

The Orchestrator owns runtime workflow semantics.

The Executor runs isolated execution units.

The prototype does not support arbitrary runtime graph mutation or direct execution of TypeScript workflow code by the Engine.
