# SDD: DSL

## 1. Summary

The DSL subsystem is the product-owned TypeScript authoring subsystem for defining CI/CD workflows in the prototype. It lets authors declare workflow structure, reuse, composition, execution units, dependencies, inputs, outputs, artifacts, reports, conditions, and supported policies.

The DSL materializes authoring-time declarations into a normalized workflow definition. The normalized workflow definition is handed to the Engine Planner. The DSL does not produce execution plans, does not execute workflows, and does not pass live TypeScript builder state into the Engine.

## 2. Scope

This SDD covers:

- Prototype DSL authoring model.
- Authoring-time composition and reuse.
- Static graph construction.
- Static expansion where supported.
- Materialization into normalized workflow definitions.
- DSL-side normalization.
- DSL-side validation and diagnostics.
- Source metadata capture.
- Authoring-time versus runtime semantic boundaries.

This SDD does not cover:

- Final long-term DSL evolution beyond the prototype.
- Execution planning internals.
- Orchestration internals.
- Executor behavior.
- Interface UI design.
- Exact TypeScript syntax reference.
- Exact normalized workflow schema as a formal specification.
- Implementation file, package, or module layout.
- Transport or persistence protocols.

## 3. Responsibilities

The DSL subsystem is responsible for:

- Providing the author-facing workflow declaration model.
- Supporting TypeScript-native authoring-time composition and reuse.
- Constructing a static workflow graph from declarations.
- Supporting static expansion where the expanded graph is complete before planning.
- Declaring execution units.
- Declaring dependency edges.
- Declaring inputs, outputs, artifacts, reports, and metadata.
- Declaring runtime conditions as Engine-understandable metadata.
- Declaring retry, timeout, cancellation, and execution policies where supported by the prototype.
- Capturing source metadata useful for diagnostics and inspection where available.
- Producing DSL-side diagnostics for authoring errors and unsupported patterns.
- Materializing a normalized workflow definition for the Engine.
- Ensuring the normalized workflow definition contains no unresolved authoring-only constructs.

The DSL subsystem is not responsible for:

- Producing execution plans.
- Validating all Engine planning rules.
- Executing workflows.
- Dispatching execution units.
- Evaluating dependency readiness at runtime.
- Applying retry or cancellation semantics at runtime.
- Determining workflow-run outcomes.
- Managing runtime state, event history, logs, or artifacts.
- Interpreting execution-time outputs to create new units in the prototype.
- Passing live builder objects or arbitrary executable authoring state into the Engine.
- Creating different workflow semantics for local and self-hosted modes.

## 4. Internal Structure

The DSL subsystem is conceptually structured around the following responsibilities.

### Author-Facing Declaration Model

Primary purpose: provide the user-facing model for declaring CI/CD workflows in TypeScript.

Owned responsibilities:

- Represent a workflow as declared structure, not as immediate execution.
- Let authors declare execution units.
- Let authors declare dependencies between execution units.
- Let authors declare workflow-level and unit-level metadata.
- Let authors declare inputs, outputs, artifacts, reports, conditions, and policies.
- Let authors use TypeScript for authoring-time organization, constants, helpers, and composition.
- Keep authored declarations separate from Engine execution plans.

Non-responsibilities:

- It does not execute declared units.
- It does not decide runtime readiness.
- It does not mutate the graph during workflow execution.
- It does not expose author-facing syntax as the Engine contract.

### Reusable Fragment and Composition Model

Primary purpose: support native reuse and composition while preserving static graph materialization.

Owned responsibilities:

- Allow reusable workflow fragments to declare units, dependencies, metadata, and policies.
- Allow fragments to be composed into larger workflow declarations during authoring.
- Allow parameterization by authoring-time values.
- Ensure composed fragments resolve into ordinary workflow declarations before Engine planning.
- Preserve enough origin metadata to explain where materialized units came from where useful.

Non-responsibilities:

- It does not preserve reusable fragments as runtime-executed functions.
- It does not allow runtime state to decide graph shape in the prototype.
- It does not hide dependency edges in side effects that cannot be materialized.
- It does not define Engine runtime semantics.

### Static Expansion Model

Primary purpose: expand supported authoring-time constructs into a complete static graph before planning.

Owned responsibilities:

- Support static expansion only from values known during authoring/materialization.
- Expand repeated or parameterized declarations into explicit execution-unit declarations.
- Produce stable unit identities or identity metadata sufficient for diagnostics and planning.
- Detect unsupported dynamic expansion patterns.
- Ensure all generated units and edges are present before the Planner runs.

Non-responsibilities:

- It does not support execution-time graph mutation.
- It does not support lazy execution semantics.
- It does not create units from execution-time outputs.
- It does not defer graph-shape decisions to the Orchestrator or Executor.

### Materialization Step

Primary purpose: transform authoring declarations into an Engine-facing normalized workflow definition.

Owned responsibilities:

- Evaluate authoring-time declaration constructs.
- Resolve reusable fragments and static composition.
- Resolve static expansion where supported.
- Collect declared units, dependencies, inputs, outputs, artifacts, reports, conditions, policies, and metadata.
- Remove live authoring constructs from the Engine-facing representation.
- Produce a complete normalized workflow definition.
- Produce materialization diagnostics when authoring constructs cannot be resolved.

Non-responsibilities:

- It does not derive an execution plan.
- It does not perform runtime scheduling.
- It does not execute unit payloads.
- It does not hand live builder state to the Engine.

### DSL-Side Normalization

Primary purpose: produce a stable conceptual representation of workflow intent for the Engine Planner.

Owned responsibilities:

- Convert authored declarations into normalized workflow-definition categories.
- Canonicalize declaration structure where needed to remove authoring-syntax details.
- Preserve authoring intent without preserving authoring implementation mechanics.
- Represent dependency edges explicitly.
- Represent runtime conditions and policies declaratively.
- Represent reusable fragments as materialized units and metadata, not as runtime constructs.
- Ensure the output is independent from final author-facing syntax details.

Non-responsibilities:

- It does not canonicalize into an execution plan.
- It does not apply Engine scheduling rules.
- It does not decide final runtime state transitions.
- It does not define persistence format.

### DSL-Side Validation and Diagnostics

Primary purpose: catch authoring-layer problems before Planner validation.

Owned responsibilities:

- Detect invalid use of the declaration model.
- Detect unresolved authoring-only constructs.
- Detect duplicate or ambiguous declarations where visible at DSL level.
- Detect references to undeclared authoring symbols where visible at DSL level.
- Detect unsupported dynamic graph construction patterns.
- Detect malformed declaration metadata before Planner execution where possible.
- Emit diagnostics with source metadata where available.
- Distinguish warnings from errors where useful.

Non-responsibilities:

- It does not replace Planner validation.
- It does not own final static DAG validation if that validation depends on Engine rules.
- It does not decide whether a workflow can be executed after planning.
- It does not validate runtime environment availability.

### Source Metadata Capture

Primary purpose: preserve useful authoring context for diagnostics and inspection.

Owned responsibilities:

- Capture workflow declaration locations where available.
- Capture execution-unit declaration locations where available.
- Capture dependency, condition, policy, artifact, and report declaration locations where useful.
- Preserve fragment/composition origin metadata where useful.
- Attach diagnostic metadata to normalized workflow definitions without making source metadata required for runtime semantics.

Non-responsibilities:

- It does not make source location the source of workflow identity.
- It does not require Interface-specific presentation shapes.
- It does not expose TypeScript implementation details as Engine semantics.

### Runtime Condition and Policy Declarations

Primary purpose: represent runtime behavior as declarations that the Engine can understand.

Owned responsibilities:

- Represent runtime conditions as structured declarations.
- Represent retry, timeout, and cancellation policies where supported.
- Keep policy declarations attached to workflow or execution-unit declarations as appropriate.
- Ensure declarations are materialized into the normalized workflow definition.

Non-responsibilities:

- It does not evaluate runtime conditions during authoring.
- It does not encode runtime control flow as arbitrary TypeScript execution.
- It does not apply retry, timeout, or cancellation behavior at runtime.
- It does not decide final workflow outcome.

## 5. Interfaces

Interfaces in this SDD are conceptual. They do not imply exact method signatures, transport protocols, schemas, or package boundaries.

### Authored Workflow Declaration

The authored workflow declaration is what the user writes conceptually in TypeScript.

It may contain:

- Workflow declaration.
- Execution-unit declarations.
- Dependency declarations.
- Authoring-time composition helpers.
- Reusable fragments.
- Static expansion over authoring-time values.
- Inputs and outputs.
- Artifact and report declarations.
- Runtime condition declarations.
- Retry, timeout, cancellation, and execution policy declarations where supported.
- Metadata and source-associated information.

The authored workflow declaration is not the Engine contract.

### Materialized DSL Output

The DSL materializes authored declarations into a normalized workflow definition.

Materialization removes:

- Live builder objects.
- Authoring-only helper state.
- Unresolved reusable fragments.
- Arbitrary executable TypeScript state.
- Authoring syntax details not needed by the Engine.

Materialization preserves:

- Workflow intent.
- Explicit units.
- Explicit dependencies.
- Declared metadata.
- Declared runtime conditions and policies.
- Declared inputs, outputs, artifacts, and reports.
- Source and diagnostic metadata where available.

### Planner Input

The Planner receives the normalized workflow definition.

The normalized workflow definition must conceptually contain:

- Workflow identity.
- Workflow metadata.
- Trigger declarations where relevant.
- Execution-unit declarations.
- Explicit dependency edges.
- Declared inputs.
- Declared outputs.
- Declared artifact metadata.
- Declared report metadata.
- Declared runtime conditions.
- Declared retry, timeout, cancellation, and execution policies where supported.
- Source metadata useful for diagnostics and inspection.
- Diagnostic metadata where useful.
- Version or compatibility metadata where required by implementation design.

The Planner treats this input as workflow intent. It validates the definition against Engine rules and derives an execution plan.

### Execution Plan Distinction

An execution plan is the Planner output, not the DSL output.

The execution plan is Engine-owned and may contain:

- Engine-canonical execution structure.
- Planner-derived execution-unit details.
- Planner-derived dependency semantics.
- Engine-understandable execution payload descriptors.
- Planner diagnostics.
- Execution metadata needed by the Orchestrator and Executor.

The DSL must not produce this plan directly.

### DSL Diagnostics

The DSL may produce diagnostics before the Planner runs.

Diagnostic categories include:

- Invalid declaration usage.
- Unsupported authoring-time pattern.
- Unresolved fragment or composition output.
- Invalid static expansion input.
- Duplicate or ambiguous authoring names where detectable.
- Missing required authoring declarations.
- Malformed metadata declarations where detectable.
- Unsupported condition or policy declaration shape.
- Source metadata capture limitations where useful.

Planner diagnostics remain separate and cover Engine validation and execution-plan derivation failures.

## 6. Data Flow and State

### Main Data Flow

1. The author writes a TypeScript workflow declaration.
2. Authoring-time helpers compose reusable fragments.
3. Supported static expansion resolves into explicit declarations.
4. The DSL materialization step evaluates authoring-time declarations.
5. DSL-side validation emits authoring diagnostics where applicable.
6. DSL-side normalization produces a normalized workflow definition.
7. The normalized workflow definition is handed to the Engine Planner.
8. The Planner validates the normalized workflow definition and derives an execution plan.

### DSL State

DSL state is authoring/materialization state only.

It may include transient builder state, fragment references, composition state, source metadata, and diagnostics while the workflow is being materialized. This state must not cross the Engine boundary as live objects or executable authoring state.

### Normalized Workflow Definition Categories

#### Workflow identity and metadata

- Workflow name or identity.
- Human-readable metadata.
- Version or compatibility metadata where required.
- Source metadata where available.

#### Execution-unit declarations

- Unit identity.
- Unit metadata.
- Unit payload declaration.
- Unit-level inputs, outputs, artifacts, reports, conditions, and policies.
- Source metadata where available.

#### Dependency edges

- Explicit edges between declared units.
- Dependency metadata where supported.
- No hidden dependency edges that require runtime discovery.

#### Inputs and outputs

- Workflow-level inputs and outputs where supported.
- Unit-level inputs and outputs.
- Declared output names and metadata.
- No assumption that execution-time outputs create new units.

#### Artifact and report declarations

- Declared artifact names or roles.
- Declared artifact metadata.
- Declared report metadata.
- Producer unit association where applicable.
- No artifact payloads.

#### Runtime conditions

- Structured condition declarations.
- Unit or workflow association where applicable.
- Metadata sufficient for the Planner and Orchestrator to understand supported condition semantics.
- No arbitrary TypeScript runtime control flow.

#### Policy declarations

- Retry policy declarations where supported.
- Timeout policy declarations where supported.
- Cancellation policy declarations where supported.
- Execution policy metadata where supported.
- No runtime application of policies by the DSL.

#### Source and diagnostic metadata

- Source locations where available.
- Fragment/composition origin metadata where useful.
- Diagnostic references where useful.
- Metadata for useful authoring feedback and workflow-aware inspection.

## 7. Key Invariants

- The DSL produces normalized workflow definitions, not execution plans.
- The Planner owns execution-plan derivation.
- The Engine owns runtime semantics.
- The workflow graph must be complete before planning starts.
- The prototype uses static DAG workflows.
- All execution units and dependency edges must be known before execution starts.
- Execution-time outputs do not create new units in the prototype.
- Runtime conditions are represented as declarations, not arbitrary TypeScript runtime control flow.
- Retry, timeout, and cancellation behavior are declared in the DSL but applied by the Engine where supported.
- The Engine does not interpret arbitrary TypeScript authoring code.
- The DSL must not pass live builder objects or executable authoring state into the Engine.
- The normalized workflow definition must be independent from final author-facing syntax details.
- Reusable fragments must resolve before the normalized workflow definition is handed to the Planner.
- Static expansion must resolve before the normalized workflow definition is handed to the Planner.
- Authoring-time TypeScript expressiveness must not undermine planning determinism.
- Authoring-time TypeScript expressiveness must not create different workflow semantics between local and self-hosted modes.
- Runtime graph mutation, lazy execution semantics, and direct Engine execution of TypeScript source are outside prototype scope.

## 8. Operational Concerns

### Authoring Diagnostics

The DSL must produce useful diagnostics early in the authoring loop. Diagnostics should identify authoring misuse, unsupported patterns, unresolved composition, invalid static expansion, and malformed declarations where detectable before Planner validation.

Diagnostics should be structured enough for CLI and dashboard surfaces to present them through Engine or Interface flows without depending on DSL internals.

### Source-Location Preservation

The DSL should preserve source locations where available for workflows, units, dependencies, conditions, policies, artifacts, and reports.

Source metadata is for diagnostics and inspection. It must not become required for runtime semantics.

### Compatibility and Versioning

The normalized workflow definition is an important boundary between DSL and Engine. It should carry enough compatibility metadata for the Planner to understand what version or shape it is receiving.

The SDD does not define the exact versioning mechanism, but implementation must avoid tying the Engine to unstable author-facing syntax details.

### Reusable Fragment Representation

Reusable fragments are authoring-time constructs. After materialization, they should appear as explicit workflow units, edges, metadata, and optional origin information.

The Engine should not need to execute fragments or understand fragment authoring mechanics.

### Controlled Static Expansion

Static expansion must be deterministic from authoring-time inputs. Expansion must not depend on execution-time state or execution-unit outputs.

Unsupported dynamic expansion patterns should fail during materialization or produce clear diagnostics before planning.

### Testing Implications

DSL materialization should be testable independently from Engine execution.

Important test categories include:

- Declaration materialization.
- Fragment composition.
- Static expansion.
- Dependency edge materialization.
- Condition and policy declaration materialization.
- Source metadata preservation.
- Diagnostics for unsupported authoring patterns.
- Normalized workflow definition stability.

### Preserving Inspectability and Planning Determinism

The DSL must avoid authoring patterns that make the workflow graph implicit, hidden, or dependent on runtime side effects.

Dependency edges, units, conditions, and policies must be visible in the normalized workflow definition so the Planner can validate them and the Interface can later inspect planned workflow structure through Engine-owned reads.

## 9. Open Technical Questions

The following lower-level DSL questions remain open after the accepted ADRs and must be resolved during implementation design:

- What exact normalized workflow definition schema is required for the prototype?
- Which validations belong in DSL materialization versus Planner validation?
- What exact static expansion patterns are allowed?
- Does the prototype include matrix-like expansion, and if so, how is it represented?
- How are runtime conditions represented in the normalized workflow definition?
- How are retry, timeout, and cancellation declarations represented?
- How are execution-unit payload declarations represented without becoming execution plans?
- How are reusable fragments identified after materialization?
- What fragment origin metadata is required for useful diagnostics and inspection?
- What source-location metadata is required for a useful authoring loop?
- What diagnostic severity model is required?
- How are normalized workflow definition compatibility and versioning handled?
- Are normalized workflow definitions persisted, transient, or optionally stored with workflow runs?
- What minimum diagnostics are required before invoking the Planner?
- What authoring patterns must be explicitly rejected in the prototype?
- How should unsupported dynamic graph construction be detected and explained?
- What metadata is needed so local and self-hosted materialization produce consistent semantics?

These questions do not reopen the accepted DSL/Engine boundary.

## 10. Related ADRs

Relevant accepted ADRs:

- ADR 0001: Prototype Execution Model
- ADR 0002: Runtime State, Event History, and Artifact Model
- ADR 0003: Engine / Interface Contract
- ADR 0004: Single-Node Prototype Deployment Topology
- ADR 0005: DSL ↔ Engine Boundary

Related accepted RFCs and SDDs:

- RFC 0001: System Architecture
- RFC 0002: Engine Architecture
- SDD: Engine
