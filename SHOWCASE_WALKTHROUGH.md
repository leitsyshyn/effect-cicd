# Showcase Walkthrough

This walkthrough is optimized for a **5-10 minute live demo**.

It covers:

- public DSL workflow authoring
- dashboard local project creation
- CLI validation and planning
- manual local run with inputs, retry, conditions, artifacts, reports, outputs, and redacted secrets
- GitHub-bound project history and binding
- secret deletion and retry failure on the GitHub project

## Prepared State

The environment is already cleaned up for the demo.

Projects that should be visible:

- `project:effect-cicd-demo` - local manual showcase project
- `project:github:repo:1256210563` - bound GitHub project for `effect-cicd-test-repo`

Important workflow files:

- quick local dashboard-created workflow: `../effect-cicd-demo/.effect/workflows/quickstart.ts`
- complex local manual workflow: `../effect-cicd-demo/.effect/workflows/manual-showcase.ts`
- shared manual/GitHub workflow logic: `../effect-cicd-demo/.effect/workflows/shared-pipeline.ts`
- GitHub-bound workflow: `../effect-cicd-test-repo/.effect/workflow.ts`

## One-Time Pre-Demo Prep

Do this shortly before the demo starts.

### 1. Make sure the service and dashboard are running

Terminal A:

```bash
bun run server
```

Terminal B:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run dashboard
```

Dashboard URL:

```text
http://127.0.0.1:3001
```

### 2. Push the GitHub workflow change once

The GitHub demo now requires the project secret `RELEASE_BOT_TOKEN` in the **first job**.

Before the live session, commit and push this file from `../effect-cicd-test-repo`:

```text
.effect/workflow.ts
```

Then trigger **one normal push run** on `main` and let it succeed.

Why: later in the live demo you will delete the secret and retry that successful run to show that the bound GitHub project immediately fails without the secret.

### 3. Open these tabs/windows before presenting

- dashboard projects page
- `../effect-cicd-demo/.effect/workflows/quickstart.ts`
- `../effect-cicd-demo/.effect/workflows/shared-pipeline.ts`
- `../effect-cicd-test-repo/.effect/workflow.ts`
- one terminal in `effect-cicd`

## Live Demo Script

## 0:00-0:45 Show The Public DSL

Open `../effect-cicd-demo/.effect/workflows/quickstart.ts`.

Say:

- workflows are written as TypeScript using `@effect-cicd/dsl`
- this is the smallest useful workflow: manual trigger, one job, one artifact, one report
- the workflow definition itself is part of the product story

Then briefly open `../effect-cicd-demo/.effect/workflows/shared-pipeline.ts` and point out only these parts:

- `Workflow.input(...)`
- `Job.dependsOn(...)`
- `Job.input(...)`
- `Job.output(...)`
- `Job.artifact(...)`
- `Job.report(...)`
- `Job.retry(...)`
- `Job.secret(...)`
- `Job.when(...)`

Do not explain every job. Just establish that the complex pipeline is still authored with the same public DSL.

## 0:45-1:45 Create A Local Project In The Dashboard

In the dashboard:

1. Open `Projects`
2. Click `Create Project`
3. Stay on the `Local` tab
4. Fill in:

Workflow File:
```text
../effect-cicd-demo/.effect/workflows/quickstart.ts
```

Project ID:
```text
project:effect-cicd-demo:quickstart
```

Workspace Path:
```text
../effect-cicd-demo
```

5. Click `Create Local Project`

Say:

- local projects are first-class dashboard entities
- the workflow file can be typed manually even if it is outside the main repo root

## 1:45-2:15 Run The Quickstart Project

Still in the dashboard:

1. On the new quickstart project page, click `Run Now`
2. No inputs are required
3. Let the run finish
4. Open the job page and show:

- the artifact `hello`
- the report `summary`

Say:

- this covers dashboard project creation and the simplest manual local run path

## 2:15-3:00 Show CLI Validation And Planning

In the terminal, from `effect-cicd`:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts validate ../effect-cicd-demo/.effect/workflows/manual-showcase.ts
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts plan ../effect-cicd-demo/.effect/workflows/manual-showcase.ts
```

Say:

- the CLI talks to the same engine as the dashboard
- validation checks workflow references and structure
- planning produces a static DAG before execution

Only point out the dependency structure. Do not read the full plan aloud.

## 3:00-5:30 Run The Complex Manual Showcase

In the dashboard, open project `Effect CI/CD Demo`.

Click `Run Now` and paste this JSON:

```json
{
  "releaseVersion": "1.4.0-demo.live",
  "targetEnvironment": "preview",
  "runPerformance": false,
  "injectIntegrationFlake": true,
  "failSmoke": false,
  "forceTimeoutJob": false
}
```

What to narrate while it runs:

- this workflow uses required inputs
- jobs consume both workflow inputs and upstream outputs
- some units are conditionally skipped
- the release and deploy steps use project-scoped secrets

When the run is visible, show these exact things:

1. The DAG view
2. `integration-tests` and the multiple attempts
3. `performance-tests` skipped because `runPerformance=false`
4. `collect-preview-diagnostics` skipped because smoke passed
5. `package-release` log showing `[REDACTED]`
6. the `smokeResults` artifact
7. the run outputs summary

Useful CLI backup commands if you want them:

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs list --project project:effect-cicd-demo
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs show <runId>
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts runs events <runId>
```

## 5:30-7:30 Show GitHub Integration And Secret Gating

Open the GitHub-bound project in the dashboard:

```text
leitsyshyn/effect-cicd-test-repo
```

First show:

- that it is a GitHub project
- that it already has history
- the existing successful run you prepared before the demo

Then briefly open `../effect-cicd-test-repo/.effect/workflow.ts` and point out:

- `Workflow.on(Trigger.githubPush({ branches: ["main"] }))`
- `Job.secret("RELEASE_BOT_TOKEN")` in the bootstrap job

Now use the CLI to prove that the bound GitHub project depends on secrets.

### Delete the GitHub project secret

```bash
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts secrets delete project:github:repo:1256210563 RELEASE_BOT_TOKEN
```

### Retry the last successful GitHub run

Use the dashboard `Retry` action on the successful GitHub run.

What to show:

- the new run fails immediately at the first job because the required secret is missing

Say:

- GitHub binding and history still exist
- but execution is blocked by missing project-scoped secrets

### Add the secret back

```bash
export RELEASE_BOT_TOKEN=demo-release-bot-token-2026
ENGINE_BASE_URL=http://127.0.0.1:3000 bun run index.ts secrets set project:github:repo:1256210563 RELEASE_BOT_TOKEN --from-env RELEASE_BOT_TOKEN
```

### Retry again

Use the dashboard `Retry` action again on the failed GitHub run.

You do not need to wait for the whole pipeline to finish live.

Just show that:

- the secret is restored
- the run starts normally again

If there is time, open the bootstrap log from a successful run and point out the secret value is redacted in logs.

## 7:30-8:30 Close With What Was Covered

Say, in one pass:

- workflows are authored in the public TypeScript DSL
- projects can be created and run from the dashboard
- the CLI validates and plans workflows through the same engine
- local manual runs support inputs, outputs, retry, conditions, artifacts, reports, and secret-backed jobs
- GitHub-bound projects preserve history and still enforce project-scoped secrets on retry

## If Time Is Running Short

Keep only these parts:

1. quickstart workflow file
2. dashboard local project creation
3. CLI validate + plan
4. one complex manual run and its retry/skip/redaction evidence
5. GitHub secret delete + retry failure

Skip waiting for the final successful GitHub rerun.

## After The Demo

Optional cleanup for the quickstart project:

```bash
curl -X DELETE http://127.0.0.1:3000/api/projects/project%3Aeffect-cicd-demo%3Aquickstart
```
