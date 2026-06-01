# effect-cicd

Production deployment and operations guidance: `docs/self-hosting.md`

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

Single-command local path:

```bash
bun run local run ./examples/demo-workflow.ts --workspace ./examples/demo-project
```

`bun run local ...` boots the same HTTP engine service used in self-hosted mode, runs the CLI against it, then shuts it down.

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

`runs show` now includes workflow inputs, resolved workflow outputs, persisted reports, timeout outcomes, and cancellation causes when present.

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

## Workflow Semantics

The runtime now honors declared workflow triggers, workflow inputs, unit inputs, unit outputs, unit conditions, reports, per-unit timeouts, and run cancellation.

Detailed semantics and DSL examples live in `docs/workflow-semantics.md`.

Run a workflow with explicit workflow input values:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts run ./path/to/workflow.ts --workspace ./repo --inputs '{"release":"1.2.3"}'
```

Service/API submission with workflow inputs:

```bash
curl -X POST http://127.0.0.1:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{
    "plan": {"...":"planned execution omitted for brevity"},
    "options": {
      "workspacePath": "/absolute/workspace/path",
      "inputValues": {
        "release": "1.2.3"
      }
    }
  }'
```

Current semantics in brief:

- Trigger declarations are workflow-owned metadata. V1 supports `manual` and `GitHub push`.
- Workflows default to `manual` when no explicit trigger is declared.
- GitHub webhook execution requires both a repository binding and a matching workflow `GitHubPushTrigger` declaration.
- Declared workflow inputs are required when starting a run.
- Unit inputs must reference a workflow input or an upstream unit output explicitly.
- Unit conditions are engine-evaluated declarations. V1 supports trigger event, branch/ref/tag, workflow input equality, and upstream unit status.
- False conditions mark the unit `skipped` with a recorded reason; downstream units may still run when they explicitly depend on upstream terminal status conditions.
- Unit outputs are collected from workspace-relative files and support `json` or `text` values.
- Reports are collected from declared files and persisted as first-class report summaries plus artifact payloads.
- Per-unit timeouts end the unit in `timed_out`; the run reaches `timed_out` after remaining schedulable units finish or skip.
- Run cancellation is engine-owned, marks pending units `canceled`, and performs best-effort interruption of the running unit.
- Cancellation policy mode (`best-effort` or `fail-fast`) is enforced at runtime:
  - `best-effort` enters a `canceling` state before finalizing canceled.
  - `fail-fast` transitions directly to `canceled` without intermediate state.
- Output/report collection currently requires a mounted workspace.

## Secrets

Self-hosted secrets are now product-owned data stored separately from workflow run state and scoped per project.

Before starting the persistent service, set an application master key for secret encryption at rest:

```bash
export SECRETS_MASTER_KEY="$(openssl rand -base64 32)"
```

In workflow code, use explicit secret references in container env declarations:

```ts
import { containerCommand, secret, unit, workflow } from "./src/dsl/index.ts"

export default workflow({
  workflowId: "workflow:publish",
  name: "publish",
  metadata: {
    projectId: "project:acme-web",
  },
  units: [
    unit({
      unitId: "unit:publish",
      name: "publish",
      command: containerCommand({
        image: "oven/bun:1",
        command: ["bun", "publish"],
        env: {
          NPM_TOKEN: secret("NPM_TOKEN"),
        },
      }),
    }),
  ],
})
```

Set a secret through the CLI without putting the value on the command line:

```bash
export NPM_TOKEN=replace-me
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts secrets set project:acme-web NPM_TOKEN --from-env NPM_TOKEN
```

List stored secret metadata:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts secrets list project:acme-web
```

Delete a stored secret:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts secrets delete project:acme-web NPM_TOKEN
```

Direct service API:

```bash
curl -X POST http://127.0.0.1:3000/api/secrets \
  -H 'content-type: application/json' \
  -d '{"projectId":"project:acme-web","key":"NPM_TOKEN","value":"replace-me"}'

curl 'http://127.0.0.1:3000/api/secrets?projectId=project%3Aacme-web'

curl -X DELETE http://127.0.0.1:3000/api/secrets/project%3Aacme-web/NPM_TOKEN
```

What the current implementation guarantees:

- Secret values are stored in Postgres in encrypted form using `SECRETS_MASTER_KEY`.
- Secret names are isolated by `projectId`, so different projects can safely reuse names like `NPM_TOKEN`.
- Workflow definitions and execution plans keep `SecretRef` declarations, not resolved values.
- Runtime secret lookup uses workflow `metadata.projectId` when present, otherwise `workflowId`.
- Secret values are resolved only when building executor dispatch requests.
- Run state, event payloads, CLI inspection output, and dashboard inspection responses do not include resolved secret values.
- Persisted stdout/stderr logs redact injected secret values before storage.

Current limitations:

- Secret scope is single-node self-hosted/local; there is no hosted backend integration yet.
- Anyone who can read the process environment of the engine service and the configured master key can decrypt stored secrets.
- If a user command transforms a secret before printing it, the current deterministic redaction pass may not catch that derived value.

Typical uses for this phase:

- private repository access tokens
- package registry auth such as `NPM_TOKEN`
- deploy credentials injected as env vars
- signing or release tokens used by publish steps

## GitHub App CI Loop

The service now uses a GitHub App for auth, webhook verification, repository snapshot download, and Checks API updates.

### 1. Create the GitHub App

In GitHub:

1. Go to `Settings -> Developer settings -> GitHub Apps -> New GitHub App`.
2. Set `Webhook URL` to `https://<public-host>/api/github/webhooks`.
3. Set `Webhook secret` to the value you will use for `GITHUB_WEBHOOK_SECRET`.
4. Repository permissions:
5. `Contents: Read-only`
6. `Metadata: Read-only`
7. `Checks: Read and write`
8. Subscribe to webhook events:
9. `push`
10. `installation`
11. `installation_repositories`
12. Create the app.
13. Generate and download a private key.
14. Copy the App ID from the app page.

### 2. Configure the service

Set these environment variables before starting the engine service:

```bash
export GITHUB_APP_ID=1234567
export GITHUB_APP_PRIVATE_KEY="$(bun -e 'const text = await Bun.file("path/to/github-app.private-key.pem").text(); console.write(text.replace(/\n/g, "\\n"))')"
export GITHUB_WEBHOOK_SECRET=replace-me
export PUBLIC_BASE_URL=https://ci.example.com
```

Optional:

- `GITHUB_API_BASE_URL` for GHES or non-default API hosts later
- `GITHUB_WORKSPACE_ROOT` to override the snapshot cache root
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are reserved for later OAuth-style flows and are not required for push-triggered CI

Start infra and the service:

```bash
bun run infra:up
bun run server
```

### 3. Expose local webhooks during development

One simple option is `cloudflared`:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Take the generated `https://...trycloudflare.com` URL and set the GitHub App webhook URL to:

```text
https://<cloudflared-host>/api/github/webhooks
```

`ngrok` or `smee` also work as long as they forward raw request bodies unchanged.

### 4. Install the app on the repo or org

1. Open the GitHub App page.
2. Click `Install App`.
3. Choose the target org or user.
4. Install it on the specific repository or repositories you want to bind.
5. Note the installation id from the install page URL or via the GitHub API if needed.

### 5. Create a binding through the CLI

The CLI remains a client of the service:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 \
bun run cli bindings add github acme/widgets .effect/workflow.ts \
  --installation-id 12345678 \
  --branch main \
  --workspace-subdir packages/app
```

List bindings:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run cli bindings list
```

### 6. What happens on a real push

For an installed, bound, and trigger-enabled repository workflow, a GitHub `push` event now does this:

1. `POST /api/github/webhooks`
2. Verify `X-Hub-Signature-256` with `GITHUB_WEBHOOK_SECRET`
3. Resolve the installation + repository binding
4. Download the exact commit snapshot with an installation token using the GitHub archive API
5. Load and materialize the workflow from that snapshot
6. Confirm the workflow declares a matching `GitHubPushTrigger`
7. Submit the run to the persistent engine service
8. Create/update one workflow-level GitHub Check Run for the engine run
9. Persist the GitHub-to-run correlation for later updates and inspection

### 7. Simulate a push locally

Build a signed payload and send it to the real webhook endpoint:

```bash
BODY='{
  "ref": "refs/heads/main",
  "after": "0123456789abcdef0123456789abcdef01234567",
  "installation": { "id": 12345678 },
  "repository": {
    "id": 987654321,
    "name": "widgets",
    "full_name": "acme/widgets",
    "clone_url": "https://github.com/acme/widgets.git",
    "owner": { "login": "acme" }
  }
}'

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" -hex | sed 's/^.* //')

curl -X POST http://127.0.0.1:3000/api/github/webhooks \
  -H 'content-type: application/json' \
  -H 'x-github-event: push' \
  -H 'x-github-delivery: dev-delivery-1' \
  -H "x-hub-signature-256: sha256=$SIG" \
  -d "$BODY"
```

There is still a compatibility route at `POST /api/triggers/github`, but the real GitHub App route is `POST /api/github/webhooks`.

### 8. Inspect resulting runs

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run cli runs list
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run cli runs show <runId>
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run cli runs events <runId>
```

If `PUBLIC_BASE_URL` is configured, the GitHub Check Run `details_url` points to `/runs/<runId>` under that base URL.

### 9. Snapshot behavior

- Snapshots are exact commit archives, not branch-head lookups.
- The default cache root is `.effect-cicd/github` under the service working directory.
- Snapshot directories are deterministic: `<workspace-root>/<owner>/<repo>/<commit-sha>`.
- Existing snapshots for the same commit are reused.
- The current prototype does not implement snapshot eviction or garbage collection yet.

### 10. Current limitations

- GitHub only. No multi-provider SCM abstraction yet.
- Push only. PR review, merge queue, and deployment-oriented GitHub features are intentionally out of scope.
- Trigger config is intentionally narrow: `manual` plus `GitHub push`, with repository selection living in bindings and workflow-level enablement/filtering living in the workflow definition.
- One workflow-level Check Run per engine run. Per-unit checks are not implemented.
- Installation and repository webhook events are acknowledged but not yet used to mutate bindings automatically.
- Snapshot retention is cache-only with no cleanup worker yet.

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
- `POST /api/github/webhooks`
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
