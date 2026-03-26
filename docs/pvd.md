# PVD

## 1. Summary

A code-first CI/CD platform with a native TypeScript workflow model and its own execution engine.

Its defining properties are local workflow development and self-hosted operation. The long-term direction is to replace the CI/CD layer of platforms such as GitHub Actions and GitLab CI, while remaining separate from source control. Hosted control-plane and hosted execution modes may be added later without changing the product’s identity.

## 2. Product Vision

The system is a primary CI/CD product, not an add-on to existing YAML-based CI systems.

It enables teams to define CI/CD workflows in a native TypeScript DSL, execute them through its own engine, and operate them across local, self-hosted, and later hosted modes. It is built for the people who author and maintain CI/CD workflows, especially teams that require local workflow development, workflow inspection, and control over execution.

Its identity is defined by a code-native workflow model and by an operating model in which local and self-hosted use are first-class.

## 3. Category and Positioning

The system belongs to the CI/CD platform market.

It is positioned as a code-first CI/CD product with its own workflow model and execution engine. Relative to YAML-centered systems, it offers a different definition model and a different development and operating model. Relative to code-first delivery tools, it is intended to grow from an execution-oriented entry point into a complete CI/CD platform.

It is neither a thin abstraction over existing CI systems nor only a programmable execution utility.

## 4. Core Product Principles

- Workflow definition is native to the system. The workflow model is a first-class part of the product, not a compatibility layer over external configuration formats.
- Local workflow development is a product requirement. Routine iteration, validation, and understanding should not depend on a remote-first loop.
- Self-hosted operation is a primary operating model. The system must be operable in customer-controlled environments as a complete product.
- Hosted operation remains within long-term scope. Hosted control-plane and hosted execution modes may be added without changing the product’s identity.
- Inspection must be workflow-aware, not limited to logs. Users should be able to understand workflow behavior as a structured system.
- Reuse is native to the workflow model. Reusable workflow logic is defined and composed inside the system without implying portability across external CI engines.

## 5. End-State Product Shape

If the vision is fulfilled, the system has a complete identity as a CI/CD platform.

It provides a native TypeScript workflow system and a product-owned execution model. It supports workflow authoring, execution, inspection, and operational control within one system. It operates in local and self-hosted environments and may also be offered through hosted modes. Over time, it reaches the level of completeness required to serve as the primary CI/CD layer for teams that would otherwise use established CI/CD platforms.

## 6. Strategic Wedge

The initial wedge is local-first and self-hosted.

This serves the users most affected by remote-first workflow development, configuration-centered definition models, and limited control over execution. Local workflow development reduces iteration overhead. Self-hosted operation addresses requirements for execution control and environment ownership.

This wedge is the entry point, not the long-term limit of the product.

## 7. Long-Term Scope Boundaries

The system may expand into a broader CI/CD platform, including hosted surfaces and wider operational workflows consistent with being a primary CI/CD system.

It is not intended to become source control. It is not intended to be a GitOps or infrastructure provisioning product as a primary category. It is not intended to be a general-purpose automation system outside the CI/CD domain.
