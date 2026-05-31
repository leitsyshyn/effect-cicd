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
- Run state and events are persisted in Postgres.
- Log and artifact payloads are persisted in MinIO.
- Current runtime state stores metadata and refs only, not full payloads.
