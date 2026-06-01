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

Start the persistent engine service:

```bash
bun run server
```

Health check:

```bash
curl http://127.0.0.1:3000/healthz
```

All CLI commands below assume the CLI talks to the running service:

```bash
export ENGINE_BASE_URL=http://127.0.0.1:3000
```

You can use either `bun run cli ...` or `bun run index.ts ...` for the CLI examples below.

Validate the workflow:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts validate ./examples/demo-workflow.ts
```

Plan the workflow:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts plan ./examples/demo-workflow.ts
```

Run the workflow against the real workspace:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts run ./examples/demo-workflow.ts --workspace ./examples/demo-project
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
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs list
```

Show one run:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs show <runId>
```

Show workflow events:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs events <runId>
```

Show artifact metadata:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs artifacts <runId>
```

Show log metadata:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs logs <runId>
```

Read one persisted log payload:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs log <logRef>
```

Read one persisted artifact payload:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs artifact <artifactRef>
```

Cancel a run:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs cancel <runId>
```

Retry a terminal run as a new run:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs retry <runId>
```

## GitHub Push Triggers

Register a GitHub binding:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run cli bindings add github acme/widgets workflow.ts --clone-url /absolute/path/to/local-or-bare-repo --branch main
```

Optional binding flags:

- `--workspace-subdir <path>` run the workflow from a repository subdirectory inside the acquired snapshot
- `--webhook-secret <secret>` require a valid `X-Hub-Signature-256` signature for this binding
- `--access-token <token>` use a GitHub token for private repository clone access
- `--clone-url <url>` override the default `https://github.com/<owner>/<repo>.git`

List configured bindings:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run cli bindings list
```

Simulate a GitHub push locally:

```bash
curl -X POST http://127.0.0.1:3000/api/triggers/github \
  -H 'content-type: application/json' \
  -H 'x-github-event: push' \
  -d '{
    "ref": "refs/heads/main",
    "after": "<commit-sha>",
    "repository": {
      "name": "widgets",
      "full_name": "acme/widgets",
      "clone_url": "https://github.com/acme/widgets.git",
      "owner": { "login": "acme" }
    }
  }'
```

If the binding has a webhook secret, add:

```text
X-Hub-Signature-256: sha256=<hmac-of-raw-json-body>
```

Inspect the resulting run later:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run cli runs list
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run cli runs show <runId>
```

Snapshot acquisition behavior:

- The service acquires a git snapshot for the pushed commit SHA under `GITHUB_WORKSPACE_ROOT`.
- If `GITHUB_WORKSPACE_ROOT` is unset, the default root is `.effect-cicd/github` under the service working directory.
- Snapshot directories are commit-specific and deterministic: `<workspace-root>/<owner>/<repo>/<commit-sha>`.
- Existing snapshot directories are reused when the same commit is triggered again.
- The current prototype does not implement eviction or garbage collection for cached snapshots.

## Dashboard MVP

Start the dashboard proxy:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run dashboard
```

For hot reload during dashboard development:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run dashboard:dev
```

Default dashboard URL:

- `http://localhost:3001/`

Optional port override:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 DASHBOARD_PORT=4000 bun run dashboard
```

The dashboard runs as a separate client-facing Bun process. The browser React app still does not access Postgres or MinIO directly. It talks only to dashboard-local proxy routes, which call the engine service:

- `GET /api/runs`
- `GET /api/runs/stream`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/stream`
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

- Live updates use Server-Sent Events and refresh the runs list and run detail views automatically while the service is alive.
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
- If `--workspace` is omitted, the CLI sends the directory containing the workflow module to the service as persisted run execution context.
- Relative `workingDirectory` values in workflow commands resolve under `/workspace`.

## Service API

- `POST /api/workflows/validate`
- `POST /api/workflows/plan`
- `POST /api/bindings/github`
- `POST /api/triggers/github`
- `POST /api/runs`
- `POST /api/runs/:runId/cancel`
- `POST /api/runs/:runId/retry`
- `GET /api/bindings`
- `GET /api/runs`
- `GET /api/runs/stream`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/stream`
- `GET /api/runs/:runId/events`
- `GET /api/runs/:runId/logs`
- `GET /api/logs/:logRef`
- `GET /api/runs/:runId/artifacts`
- `GET /api/artifacts/:artifactRef`
- `GET /healthz`

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
- The CLI is a client of the persistent engine service in normal mode.
- The dashboard is a client/proxy of the persistent engine service in normal mode.
- The engine service owns startup recovery, control operations, inspection reads, run execution, cancellation, retry submission, and live update streaming.
- Run state and events are persisted in Postgres.
- Log and artifact payloads are persisted in MinIO.
- Current runtime state stores metadata and refs only, not full payloads.
