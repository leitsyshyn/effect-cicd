# PRD

## 1. Summary

A local-first CI/CD product for defining, running, and inspecting CI/CD workflows in TypeScript.

The product provides a native TypeScript workflow definition DSL, its own execution engine, local execution through a CLI, a dashboard for inspection and control, and self-hosted operation on customer-controlled infrastructure.

The product is scoped to CI/CD workflows. It supports build, test, packaging, verification, and delivery workflows.

## 2. Problem

CI/CD workflow development is still dominated by a remote-first loop. Users change workflow logic, trigger remote runs, wait for execution, and inspect failures after the fact.

As workflows grow, logic becomes split across configuration, shell scripts, packaged actions, and state handoffs between steps or jobs. This makes workflows harder to understand, harder to change safely, and harder to debug.

Existing CI/CD products often provide remote run visibility, but weak full-workflow local parity. Workflow authors therefore spend too much time validating changes indirectly in remote systems instead of working in a fast local development loop.

## 3. Objectives

The primary objective is to let teams define, run, inspect, and debug CI/CD workflows locally, then operate the same workflows on self-hosted deployments of the product.

Supporting objectives:

- Improve diagnosis of workflow behavior and failures.
- Reduce fragmentation of workflow logic by keeping it in one native workflow model with built-in reuse and composition.
- Give teams direct control over CI/CD execution on infrastructure they manage.

## 4. Target user and primary workflow

### Target user

Engineers who author and maintain CI/CD workflows and need a faster, more controllable workflow development loop than remote-first CI systems provide.

### Primary workflow

The user defines a workflow in TypeScript, runs it locally, inspects and debugs the run through the product’s CLI and dashboard, and then runs the same workflow on a self-hosted deployment of the product.

## 5. V1 scope

V1 includes:

- A native TypeScript workflow definition DSL with built-in reuse and composition.
- Local workflow execution through a CLI.
- Self-hosted deployment of the product for CI/CD execution on customer-controlled infrastructure.
- The same workflow model for local and self-hosted execution.
- A dashboard for workflow inspection and operational control, including visibility into workflow structure, execution progress, failures, and outcomes.

V1 is complete only if a team can define workflows in the DSL, run them locally, inspect and debug them through the product’s control surfaces, and run the same workflows on a self-hosted deployment of the product.

## 6. Out of scope

### Product non-goals

- Source control.
- General-purpose automation outside CI/CD workflows.
- GitOps or infrastructure provisioning as the primary product category.
- Kubernetes-native positioning as the primary product identity.

### V1 exclusions

- Hosted control plane.
- Managed execution infrastructure.
- External CI workflow systems as the primary execution model.
- Broad marketplace or integration breadth as a competitive surface.

## 7. Success criteria

V1 is successful if the following are true.

### Local/self-hosted parity

Teams can validate local workflow behavior as a reliable predictor of behavior on self-hosted deployments of the product, with minimal behavioral divergence between local and self-hosted execution.

### Faster diagnosis

Teams can understand and debug workflow failures faster than in their current CI/CD workflow loop, using the product’s inspection surfaces instead of relying primarily on remote rerun cycles.

### Less fragmented workflow logic

Teams can keep workflow logic in one coherent workflow model, with less dependence on scattered configuration, ad hoc scripts, and disconnected handoff mechanisms.
