# Dagger Research

## 1. Summary

Dagger is positioned as a code-first platform for software delivery automation rather than a YAML-based CI system. Its core model is a typed API for composing containerized operations, packaged through functions and modules. The product promise is local-to-CI parity, reusable workflow logic, and trace-native observability.

The main user-facing mental model is not a pipeline file. It is a programmable workflow graph over typed artifacts such as containers, directories, files, services, secrets, and caches. Authoring is hybrid: users write imperative code or shell-like commands, but execution follows graph semantics, lazy evaluation, and cache reuse.

Execution is split between a session layer that mediates host resources and a runner or engine that executes containers and manages cache. Dagger runs locally, inside existing CI systems, and through Dagger Cloud features. In the consulted material, this makes Dagger look more like a programmable execution layer for delivery automation than a full incumbent-style CI control plane.

The strongest signals are local and CI parity, reusable typed workflow components, and observability built around traces, causal structure, timing, cache visibility, and interactive debugging. The main constraints are privileged engine requirements, Linux-centric runtime assumptions, incomplete clarity around SDK maturity and cloud boundaries, and execution semantics that can be non-obvious when side effects interact with lazy evaluation.

## 2. Current Positioning

### Identity

Dagger presents itself as a platform for automating software delivery across local development, CI, and cloud contexts. The central message is that delivery workflows should be written in code, run in containers, and behave consistently across environments.

### Audience

The primary audience is broader than CI administrators alone. Official materials describe value for platform and CI owners who want standardized reusable workflows, for application developers who want to run the same validation locally, and for teams managing large monorepos or polyglot codebases. Recent positioning also includes agentic or AI-assisted CI use cases.

### Differentiation

Its differentiation is framed against script-heavy or YAML-heavy CI. The emphasis is on programmable workflows, local-first execution, reproducibility through sandboxed typed inputs, and observability through trace data rather than logs alone.

### Consistency

The high-level positioning is consistent across the official website, documentation, and repository. Lower-level materials are less consistent on support taxonomy, Dagger Cloud boundaries, and some detailed capability descriptions.

## 3. Core Product Model

### Primitives

The user-facing model is built around typed objects and callable functions. Core types include containers, directories, files, services, secrets, cache volumes, and Git repositories. Functions are units of computation that take typed inputs and return typed outputs. Modules package functions and extend the available API when loaded. Toolchains package modules for direct use through the CLI. Checks are argument-free functions intended for validation in local and CI contexts.

### Graph

The underlying model is explicit in the API internals: a GraphQL query represents a workflow, object IDs represent state, and evaluation is lazy until a requested value forces execution. Internally, requests are compiled into a DAG of lower-level operations with caching and parallelization.

### Output

In practical terms, a Dagger user is building a typed computation graph over content-addressed workflow artifacts, then exposing useful parts of that graph as functions, checks, modules, or toolchains.

## 4. Authoring Model

### Languages

Official materials describe eight SDKs, and the repository contains corresponding SDK directories. However, official pages do not describe support level and maturity consistently across languages. The clearest conclusion is that language availability is broad, while support guarantees are less clearly normalized.

### Modes

Dagger supports three main authoring modes. The primary mode is imperative authoring through SDKs, where users write functions in a general-purpose language and package them as modules. A second mode is Dagger Shell, which provides a shell-like interface that translates commands into Dagger API requests. A third mode is direct GraphQL interaction through the CLI or any GraphQL client.

The authoring model is therefore hybrid. Users write imperative code or shell pipelines, but the resulting execution model remains graph-based, lazy, and content-addressed.

### Reuse

Reuse is centered on modules. Modules are source-code packages, versioned in Git, referenced locally or remotely, and pinned by default. The model is explicitly Git-native. Cross-language module consumption is a stated feature, and public discovery is supported through Daggerverse. Toolchains provide a more consumable layer for teams that want reusable checks and functions without writing module code first.

### Structure

Dagger constrains general-purpose code mainly through typed inputs and outputs, explicit host resource modeling, module configuration, and code generation workflows such as `dagger develop`. This is less structured than a fixed pipeline DSL, but more structured than unrestricted scripting.

## 5. Execution Model

### Architecture

Execution is split between a client, a session, and a runner. The client is user code or CLI usage. The session serves the GraphQL API and mediates host interaction, including directory synchronization, socket proxying, secret availability, and source pinning within the lifetime of a session. The runner executes containers, resolves sources, pushes images, and manages cache.

### Contexts

In local use, the CLI or SDK starts a session and provisions or connects to a runner, typically through a local container runtime. The same function model is then used from a laptop.

In CI, Dagger is generally embedded inside another orchestrator. The CI system starts a job, installs or invokes the CLI, and the CLI provisions or attaches to an engine before executing functions or checks. Dagger is therefore CI-system-agnostic at the orchestration layer and opinionated at the workflow execution layer.

In cloud contexts, Dagger Cloud provides hosted inspection surfaces and managed execution for selected validation workflows. Traces provides hosted run inspection. Checks provides managed execution for a specific validation model. Modules and related catalog surfaces provide hosted visibility into reusable components.

### Constraints

Dagger remains strongly container-runtime dependent. The engine is BuildKit-based, requires privileged or root capabilities, and does not support Windows container builds. Remote runner connectivity is possible, but transport security is delegated to the operator rather than handled end-to-end by the product.

Graph execution and cache reuse are central to performance. Dagger caches layers, volumes, and function results, and it can skip work when cached results are valid. Because evaluation is lazy, side-effecting steps may not run unless outputs are demanded or execution is forced explicitly.

## 6. Developer Workflow

### Entry

Users can start with toolchains and checks, initialize a module and write code, or explore the API through Dagger Shell. These paths converge on the same execution model.

### Iteration

The local workflow is a first-class part of the product story. Users can run checks locally, iterate in the shell, and reduce repeated argument passing through local defaults in `.env` files. The documented workflow is author, run, inspect, and repeat locally before pushing into CI.

Module development is codegen-oriented. `dagger develop` is part of the normal workflow for updating bindings, templates, and engine targeting. This introduces a more explicit regeneration loop than conventional library-only development.

### Validation

Checks are the main validation unit. They are designed to run the same way locally and in CI, including through Dagger Cloud Checks where applicable.

Debugging support includes interactive terminals inserted into workflows, interactive failure drop-in through CLI flags, trace visualization in terminal and web UI, and direct engine troubleshooting through debug mode and engine logs.

A workflow caveat is the session snapshot model. Local directory state is frozen on first use within a session, so some edit-and-rerun scenarios depend on session boundaries.

## 7. Observability and Control

### Traces

Observability is a core product surface rather than a secondary integration. The CLI TUI is presented as a live OpenTelemetry trace visualizer. Dagger Cloud Traces provides browser-based inspection of individual function invocations from local or CI runs. Official materials also state that traces can be exported to standard OpenTelemetry backends.

### Inspection

The inspection model centers on traces, logs, timing, cache visibility, and causal structure across function execution. Dagger Cloud also classifies traces by context, such as local versus CI, and uses repository metadata to attach run context. Dagger exposes both terminal and web-based run inspection surfaces.

### Control

The documented control surface is more operational than orchestration-heavy. Users can switch progress display modes, enter interactive debugging, open trace URLs, inspect and prune cache, and control cleanup timing on interruption. First-class retry semantics at the Dagger layer are not clearly documented in the consulted material.

## 8. Extensibility and Operational Model

### Extensibility

Extensibility is centered on modules. Loading a module extends the available API in a session. Module code runs inside the engine and can call both core APIs and dependency modules. Remote module consumption from Git repositories is part of the normal model, not an edge case. Toolchains package this reuse model for easier consumption.

Observability is also extensible. User code can emit custom spans that appear in Dagger inspection surfaces.

### Operations

The core engine and CLI are open source and publicly developed. Dagger Cloud is the commercial layer, with plan-based pricing and hosted features around observability, managed Checks, and module visibility.

Operationally, Dagger assumes a containerized execution substrate, a root-capable engine runtime, persistent cache storage for performance, and explicit operator responsibility for secure remote runner transport. Secret handling is positioned as safe by default and integrates with multiple secret providers.

## 9. Strengths

Dagger is strongest where its product model aligns directly with common CI friction. Local and CI parity is structural rather than rhetorical because the same execution model is used in both contexts. The typed workflow surface is richer than a step list and gives users a stable vocabulary for containers, files, services, secrets, and caches.

Modules and toolchains make reuse operationally straightforward, especially in Git-centric environments. Observability is unusually integrated into the runtime model. Trace-native inspection, causal visibility, timing data, cache visibility, and interactive debugging form a coherent developer workflow rather than a set of bolt-on features.

The product is also clear in one important market sense: it operates as a programmable execution layer for delivery automation. That makes it a direct code-first alternative without requiring it to look like a classic CI control plane.

## 10. Limitations

Dagger is opinionated in ways that limit adoption. The privileged engine requirement is a concrete blocker in locked-down environments. The runtime model is Linux-centric, with no Windows container build support. Remote execution security is not handled end-to-end by the product.

Detailed materials also send mixed signals in places. Support level and maturity across SDKs are not described consistently. Dagger Cloud boundaries are visible at a high level but not fully normalized in detailed materials. Shared cache behavior beyond the documented surface is also not fully clear.

The execution model can be non-obvious for users who expect step-by-step pipelines. Cache invalidation behavior and lazy execution semantics can surprise users, especially when side effects are involved.

## 11. Tradeoffs

Dagger gains performance, composability, and reuse by treating workflows as graph execution over typed state. The tradeoff is a less familiar execution model than sequential pipeline stages. Users must understand demand-driven evaluation, graph semantics, and content-addressed reuse.

The session and runner split improves portability and reproducibility, but it introduces an operational substrate that teams must understand and maintain even when their visible workflow is simple.

The product also shifts emphasis away from incumbent-style CI control-plane features and toward programmable execution, reusable components, and trace-oriented inspection. This sharpens the product model, but it also leaves some orchestration expectations outside the core Dagger layer.

## 12. Implications

Dagger sets a clear baseline for direct code-first delivery automation. Local-first parity is not optional. A competing product in this category will be judged on whether the same workflow logic behaves the same way locally and under CI orchestration.

Typed workflow primitives are also part of the category expectation. Containers, files, services, secrets, and caches are presented as first-class workflow objects rather than incidental implementation details.

Observability expectations are elevated. Trace-native inspection, causal structure, timing, cache visibility, and interactive debugging are part of the comparison set once Dagger is in scope.

The document also suggests several constraint areas that should remain explicit in later product definition. Users may expect reusable Git-addressable workflow components, explicit host-resource and secret boundaries, and an OSS-core plus hosted-control-plane packaging model. At the same time, user expectations may remain less settled around privileged runtime assumptions, cache and side-effect semantics, remote execution security posture, and normalized support guarantees across languages.

## 13. Open Questions

The first unresolved question is Dagger Cloud scope. The available material distinguishes hosted traces from managed Checks, but the exact boundary between bring-your-own-compute and Dagger-managed execution is not described consistently.

The second unresolved question is cache behavior beyond the current documentation surface. Earlier official material referenced distributed caching, while current materials emphasize trace visibility and managed caching for Checks. The present status of shared cache capabilities across self-hosted engines remains unclear.

The third unresolved question is SDK maturity. Broad language availability is clear. Support level, compatibility guarantees, and maturity by language are not.

The fourth unresolved question is observability export configuration. High-level materials describe export to external OpenTelemetry backends, but the detailed operator path is not made clear in the consulted sources.

The fifth unresolved question is workflow control semantics above simple invocation. Retries, backoff, and similar control constructs are not clearly documented as first-class product concepts.

## 14. Sources

### Official documentation

- <https://docs.dagger.io/>
- <https://docs.dagger.io/use-cases>
- <https://docs.dagger.io/getting-started/concepts/>
- <https://docs.dagger.io/getting-started/types/>
- <https://docs.dagger.io/getting-started/api/sdk/>
- <https://docs.dagger.io/getting-started/api/cli/>
- <https://docs.dagger.io/getting-started/quickstarts/basics/>
- <https://docs.dagger.io/getting-started/quickstarts/ci>
- <https://docs.dagger.io/getting-started/ci-integrations/github-actions>
- <https://docs.dagger.io/getting-started/ci-integrations/gitlab-ci>
- <https://docs.dagger.io/core-concepts/functions>
- <https://docs.dagger.io/core-concepts/toolchains>
- <https://docs.dagger.io/core-concepts/checks>
- <https://docs.dagger.io/features/programmability/>
- <https://docs.dagger.io/features/reusability>
- <https://docs.dagger.io/features/caching/>
- <https://docs.dagger.io/features/sandbox>
- <https://docs.dagger.io/features/secrets>
- <https://docs.dagger.io/features/local-defaults>
- <https://docs.dagger.io/features/shell/>
- <https://docs.dagger.io/features/observability/>
- <https://docs.dagger.io/reference/api/internals/>
- <https://docs.dagger.io/api/reference/>
- <https://docs.dagger.io/reference/cli/>
- <https://docs.dagger.io/reference/troubleshooting/>
- <https://docs.dagger.io/reference/configuration/cache>
- <https://docs.dagger.io/reference/configuration/cloud>
- <https://docs.dagger.io/reference/configuration/custom-runner/>
- <https://docs.dagger.io/faq/>

### Official repository

- <https://github.com/dagger/dagger>
- <https://github.com/dagger/dagger/blob/main/core/docs/d7yxc-operator_manual.md>
- <https://github.com/dagger/dagger/tree/main/sdk>

### Official website and blog

- <https://dagger.io/>
- <https://dagger.io/cloud/>
- <https://dagger.io/blog/module-catalog-insights/>
- <https://dagger.io/blog/new-dagger-cloud-pricing>
