# effect-cicd

Install dependencies:

```bash
bun install
```

## Prerequisites

- Bun
- Docker Desktop or Docker Engine with `docker compose`
- Docker daemon running locally

## Local Infra

Start Postgres + MinIO:

```bash
bun run infra:up
```

Stop infra:

```bash
bun run infra:down
```

Optional logs:

```bash
bun run infra:logs
```

Environment setup:

```bash
cp .env.demo .env
```

Default local infra values:

- Postgres: `postgres://ci:secret@localhost:5432/effect_cicd`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`
- Artifact bucket: `effect-cicd-artifacts`

## Demo Assets

- Workflow module: `./examples/demo-workflow.ts`
- Demo workspace: `./examples/demo-project`

The demo workflow runs three real containerized units against the mounted demo workspace:

1. `build`
2. `test`
3. `package`

The package step writes a real artifact at `dist/release.json`, which is persisted to MinIO and indexed in Postgres.

## MVP Demo Walkthrough

Validate the workflow:

```bash
bun run index.ts validate ./examples/demo-workflow.ts
```

Plan the workflow:

```bash
bun run index.ts plan ./examples/demo-workflow.ts
```

Run the workflow against the real workspace:

```bash
bun run index.ts run ./examples/demo-workflow.ts --workspace ./examples/demo-project
```

Expected run output shape:

```text
run: run:plan:workflow:demo:mvp:...
status: succeeded
workspace: /.../examples/demo-project
units:
unit:build succeeded
unit:test succeeded
unit:package succeeded
```

Inspect persisted runs:

```bash
bun run index.ts runs list
```

Show one run:

```bash
bun run index.ts runs show <runId>
```

Show workflow events:

```bash
bun run index.ts runs events <runId>
```

Show artifact metadata:

```bash
bun run index.ts runs artifacts <runId>
```

Show log metadata:

```bash
bun run index.ts runs logs <runId>
```

Read one persisted log payload:

```bash
bun run index.ts runs log <logRef>
```

Read one persisted artifact payload:

```bash
bun run index.ts runs artifact <artifactRef>
```

## Dashboard MVP

Start the local dashboard:

```bash
bun run dashboard
```

For hot reload during dashboard development:

```bash
bun run dashboard:dev
```

Default dashboard URL:

- `http://localhost:3001/`

Optional port override:

```bash
DASHBOARD_PORT=4000 bun run dashboard
```

The dashboard runs in the same Bun process as the local Engine. The browser React app does not access Postgres or MinIO directly. It talks only to local in-process bridge routes, which call Engine inspection methods:

- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/events`
- `GET /api/runs/:runId/logs`
- `GET /api/logs/:logRef`
- `GET /api/runs/:runId/artifacts`
- `GET /api/artifacts/:artifactRef`

Dashboard routes:

- `/` recent runs list
- `/runs/:runId` run detail, stage layout, unit inspection panel

The pipeline view derives stage-like columns from DAG depth. It does not change Engine execution semantics or introduce a stage model into the runtime.

Current dashboard limitations:

- Live streaming updates are not implemented yet. Use refresh to reload persisted state.
- Dependency relations are shown textually per job card rather than drawn as SVG connector lines.
- Artifact payload viewing assumes payload retrieval succeeds through the existing Engine artifact read path.
- Workflow and unit display names fall back to ids when richer persisted names are unavailable.

For the demo workflow, `runs artifact <artifactRef>` should print JSON like:

```json
{
  "name": "effect-cicd-demo-project",
  "entrypoint": "dist/index.js",
  "bytes": 123,
  "generatedBy": "effect-cicd-demo"
}
```

## Workspace Behavior

- `run <workflow-module> --workspace <path>` mounts that directory into the container at `/workspace`.
- If `--workspace` is omitted, the CLI defaults to the directory containing the workflow module.
- Relative `workingDirectory` values in workflow commands resolve under `/workspace`.

## Test Commands

Typecheck and unit/in-memory tests:

```bash
bun run typecheck
bun run test
```

Storage-backed integration tests with local infra:

```bash
RUN_STORAGE_TESTS=1 bun run test
```

Real Docker + Postgres + MinIO end-to-end showcase test:

```bash
RUN_STORAGE_TESTS=1 RUN_DOCKER_TESTS=1 bun run test
```

Or use the convenience script for storage-backed tests:

```bash
bun run test:storage
```

## Notes

- The CLI is Engine-backed. It does not read Postgres or MinIO directly.
- The dashboard is also Engine-backed and runs in the same local Bun process as the Engine.
- Run state and events are persisted in Postgres.
- Log and artifact payloads are persisted in MinIO.
- Current runtime state stores metadata and refs only, not full payloads.
