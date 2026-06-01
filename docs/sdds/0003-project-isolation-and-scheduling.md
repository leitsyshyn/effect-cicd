# SDD: Project Isolation and Scheduling

## Summary

This phase makes the single-node persistent engine credible for multiple repositories on one self-hosted deployment.

Current scope:

- one GitHub repository == one project
- durable project identity on bindings, runs, snapshots, and GitHub trigger metadata
- persistent queued run submission
- single-node scheduler and admission control
- global and per-project concurrency limits
- fairness across projects
- durable GitHub delivery dedupe
- project-aware inspection and filtering
- project-scoped snapshot retention

Out of scope for this phase:

- deployment environments
- worker pools or distributed scheduling
- hosted control plane
- dashboard redesign
- DSL redesign

## Project Model

- A project is identified by a stable `projectId`.
- For GitHub-bound repositories, `projectId` is derived as:
  - `project:github:repo:<repositoryId>` when GitHub repository id is available
  - `project:github:<owner>/<name>` as the fallback
- No standalone `projects` table is introduced in this phase.
- `projectId` is persisted on:
  - GitHub bindings
  - workflow runs
  - GitHub run links
  - GitHub trigger delivery dedupe records
  - snapshot metadata

Manual or non-GitHub runs still persist a `projectId`; when no explicit project metadata exists, the workflow id is used as the fallback project scope.

## Queue and Scheduler Model

- `Engine.submitRun` creates a durable run in `queued` status.
- Submission returns immediately after the queued run is persisted.
- The scheduler lives inside `RunController` in the single service process.
- The scheduler starts queued runs by forking the existing orchestrator flow.
- Queue state survives process restarts because queued runs are stored in `workflow_runs`.
- On startup:
  - queued runs remain queued
  - previously running runs are recovered through existing resume/interruption logic
  - the scheduler re-admits any queued work

## Concurrency Policy

Two typed settings control admission:

- `MAX_CONCURRENT_RUNS`
- `MAX_CONCURRENT_RUNS_PER_PROJECT`

Semantics:

- if the global limit is reached, additional runs remain queued
- if a project's limit is reached, additional runs for that project remain queued
- queued runs are not rejected by the scheduler

Defaults are conservative single-node defaults:

- `MAX_CONCURRENT_RUNS=1`
- `MAX_CONCURRENT_RUNS_PER_PROJECT=1`

## Fairness Policy

The scheduler uses:

- oldest queued run first
- constrained by per-project caps

Implementation detail:

- queued runs are ordered by `createdAt`
- the scheduler scans in order and starts the first runs that fit both the global and per-project limits
- once one project reaches its cap, later queued runs from other projects can still start

This keeps the policy explicit and small while preventing one project from monopolizing all slots.

## GitHub Idempotency and Dedupe

GitHub webhook dedupe is durable.

- A `github_trigger_deliveries` table stores idempotency records.
- Dedupe key rules:
  - preferred: `github:<bindingId>:delivery:<deliveryId>`
  - fallback when delivery id is absent: `github:<bindingId>:push:<repositoryId>:<ref>:<commitSha>`
- Dedupe is binding-scoped, so one delivery may still legitimately trigger different bindings.
- Duplicate deliveries return the existing run reference with `deduped=true` instead of creating a second run.

## Snapshot and Workspace Isolation

GitHub snapshots are stored under a project-aware path:

```text
<GITHUB_WORKSPACE_ROOT>/<provider>/<sanitized projectId>/<commitSha>
```

Consequences:

- different repositories with the same commit sha do not collide
- workspaces are project-scoped
- snapshot reuse never crosses project boundaries

## Snapshot Retention

Snapshot cleanup is intentionally small.

- `GITHUB_SNAPSHOT_RETENTION_PER_PROJECT` controls how many recent snapshots are retained per project
- cleanup runs after a new snapshot is materialized
- cleanup is project-local and best-effort

Default:

- `GITHUB_SNAPSHOT_RETENTION_PER_PROJECT=5`

Limitation:

- retention is count-based, not TTL-based
- cleanup is triggered on snapshot creation, not by a background janitor

## Inspection and CLI

Project-aware inspection surfaces added in this phase:

- service API: `GET /api/runs?projectId=<projectId>`
- service API: `GET /api/projects`
- CLI: `runs list --project <projectId>`
- CLI: `projects list`

Run inspection output now shows `projectId` explicitly.

## Notes

- This remains a single-node scheduler.
- There are no worker leases, heartbeats, or distributed claims.
- The model is intentionally explicit so later worker or hosted phases can build on durable queue and project metadata without reworking the current engine contract.
