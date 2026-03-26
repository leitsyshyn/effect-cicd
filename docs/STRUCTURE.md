# Documentation Structure

## Scope

This file defines the documentation types used in this repository, their ownership, and their required structure.

## Layout

```text
README.md
AGENTS.md
docs/
  STRUCTURE.md
  pvd.md
  prd.md
  mrds/
  rfcs/
  adrs/
  sdds/
```

## Document Types

### PVD

Path: `docs/pvd.md`  
Owns: long-term product vision.

Must contain:

- Summary
- Product vision
- Category and positioning
- Core product principles
- End-state product shape
- Strategic wedge
- Long-term scope boundaries

May contain:

- Planning implications, if they are product-level constraints rather than roadmap or implementation guidance

Must not contain:

- architecture
- subsystem design
- implementation detail
- release plan
- roadmap

### PRD

Path: `docs/prd.md`  
Owns: current product definition.

Must contain:

- Summary
- Problem
- Objectives
- Target user and primary workflow
- V1 scope
- Out of scope
- Success criteria
- Open product questions

Must not contain:

- architecture
- subsystem design
- implementation detail
- long-term vision beyond what is needed to frame the current product

### MRD

Path: `docs/mrds/`  
Owns: market research and alternative landscape analysis.

Must contain:

- Summary
- Scope of analysis
- Market categories
- Alternative matrix
- Tool profiles
- Landscape patterns
- Gaps and opportunities
- Implications
- Open questions
- Sources

Must not contain:

- product definition
- architecture
- implementation detail
- solution design

### RFC

Path: `docs/rfcs/`  
Owns: system-level technical design.

Must contain:

- Summary
- Context
- Core concepts
- High-level architecture
- System or engine model
- Architectural invariants
- Architecture-level scope
- Tradeoffs
- Unresolved technical questions
- Related ADRs

Must not contain:

- product scope management
- detailed subsystem design
- isolated decisions better expressed as ADRs

### SDD

Path: `docs/sdds/`  
Owns: design of one subsystem.

Must contain:

- Summary
- Scope
- Responsibilities
- Internal structure
- Interfaces
- Data flow and state
- Key invariants
- Operational concerns
- Open technical questions
- Related ADRs

Must not contain:

- product-level scope
- unrelated system-wide architecture

Creation rule: create only when the RFC is not sufficient.

### ADR

Path: `docs/adrs/`  
Owns: one architectural decision.

Must contain:

- Title
- Status
- Context
- Decision
- Consequences

Optional:

- Alternatives considered

Must not contain:

- broad design overview
- multiple unrelated decisions

## Ownership Rules

- Long-term product direction belongs in the PVD.
- Current product scope and success criteria belong in the PRD.
- Market and competitor research belongs in MRDs.
- System-wide technical design belongs in RFCs.
- Subsystem design belongs in SDDs.
- Atomic architectural decisions belong in ADRs.

If content could fit more than one document type, place it in the highest-level document that can own it without mixing concerns.

## Update Rules

- Update the PVD when long-term product direction, positioning, or durable product principles change.
- Update the PRD when current product scope, goals, or success criteria change.
- Update an MRD when market framing, alternative analysis, or research conclusions change.
- Update an RFC when system architecture or boundaries change.
- Update an SDD when a subsystem design changes.
- Add or supersede an ADR when an architectural decision is made or replaced.

## Creation Order

1. MRD
2. PVD
3. PRD
4. RFC
5. ADRs
6. SDDs, if needed

## Naming

- Use lowercase paths.
- Use kebab-case file names.
- Number RFCs and ADRs.
- Keep `docs/pvd.md` as the canonical PVD unless versioning becomes necessary.
- Keep `docs/prd.md` as the canonical PRD unless versioning becomes necessary.
