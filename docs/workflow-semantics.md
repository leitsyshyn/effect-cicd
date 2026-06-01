# Workflow Semantics

This phase makes the declared workflow dataflow and control semantics operational at runtime.

## Supported Runtime Model

- Workflow inputs are declared at the workflow level and supplied when a run starts.
- Workflow triggers are declared at the workflow level and interpreted by the product.
- Unit inputs are explicit references to either workflow inputs or upstream unit outputs.
- Unit conditions are explicit engine-owned declarations evaluated against trigger context, workflow inputs, and upstream unit state.
- Unit outputs are explicit file-backed values collected after successful execution.
- Workflow outputs are explicit references to workflow inputs or unit outputs.
- Unit reports are explicit file-backed report payloads persisted as report records plus artifact payloads.
- Unit timeouts are enforced at execution time.
- Run cancellation is engine-owned and externally controllable.

## DSL Example

```ts
import {
  containerCommand,
  githubPushTrigger,
  input,
  output,
  report,
  timeout,
  unit,
  unitOutput,
  whenBranch,
  whenInputEquals,
  workflow,
  workflowInput,
} from "../src/dsl/index.ts"

export default workflow({
  workflowId: "workflow:release",
  name: "release",
  triggers: [githubPushTrigger({ branches: ["main"] })],
  inputs: [{ name: "release", metadata: {} }],
  outputs: [
    output({
      name: "digest",
      from: unitOutput("unit:build", "digest"),
      metadata: {},
    }),
  ],
  units: [
    unit({
      unitId: "unit:build",
      name: "build",
      command: containerCommand({
        image: "oven/bun:1",
        command: ["sh", "-c", "mkdir -p outputs reports && echo '{\"sha\":\"abc123\"}' > outputs/digest.json && echo ok > reports/summary.txt"],
      }),
      inputs: [input({ name: "release", from: workflowInput("release"), metadata: {} })],
      conditions: [whenBranch("main"), whenInputEquals("release", "stable")],
      outputs: [output({ name: "digest", path: "outputs/digest.json", format: "json", metadata: {} })],
      reports: [report({ name: "summary", path: "reports/summary.txt", format: "text", contentType: "text/plain", metadata: {} })],
      policies: [timeout({ seconds: 30 })],
    }),
  ],
})
```

## Trigger Semantics

- V1 supports two workflow trigger kinds: `manual` and `GitHub push`.
- Workflows default to `manual` when no explicit trigger is declared.
- GitHub push execution requires a repository binding and a matching workflow `GitHubPushTrigger` declaration.
- GitHub push filters are exact-match on declared branch, ref, and tag values when provided.

## Input Semantics

- Declared workflow inputs are required at run start.
- Unknown input keys are rejected.
- CLI input values are provided with `--inputs '<json object>'`.
- Service/API input values are provided as `options.inputValues` on `POST /api/runs`.
- The executor receives resolved inputs in `DispatchRequest.inputs`.
- Local container execution injects:
  - `EFFECT_CICD_INPUTS_JSON`
  - `EFFECT_CICD_INPUT_<NAME>` for each resolved input

## Condition Semantics

- Conditions are unit-level only in V1.
- Conditions are combined with logical AND.
- Supported condition inputs are:
  - trigger event kind
  - trigger branch, ref, or tag
  - workflow input equality
  - upstream unit terminal status
- False conditions mark the unit `skipped` with a visible reason in runtime state and event history.
- Upstream-status conditions do not mutate the graph. They only decide whether an already-planned unit should run once its dependencies reach terminal state.

## Output Semantics

- Unit outputs are collected from files relative to the mounted workspace.
- Supported formats are `json` and `text`.
- Output files are required for a successful unit. Missing or invalid declared outputs fail the unit.
- Output values are kept in runtime state and become available to downstream units only after upstream success.
- Workflow outputs are resolved from declared sources and exposed in run inspection.

## Report Semantics

- Reports are collected from declared file paths relative to the mounted workspace.
- Reports are stored as artifact payloads plus first-class report summaries in run and unit state.
- Missing reports are recorded with `missing` status and remain inspectable.

## Timeout Semantics

- Only per-unit execution timeout is implemented in this phase.
- The engine applies the smallest declared unit timeout.
- Timeout interrupts the executor effect.
- Local container execution performs a best-effort process kill on interruption.
- Timed out units end in `timed_out`.
- Remaining units are then evaluated through the same dependency and condition model.
- The run ends in `timed_out` if any unit timed out.

## Cancellation Semantics

- Runs are canceled through the engine, not by interface-specific store access.
- `runs cancel <runId>` and `POST /api/runs/:runId/cancel` request cancellation.
- Per-unit cancellation policy mode (`best-effort` or `fail-fast`) is enforced at runtime:
  - `best-effort` (default):
    - Not-yet-started units become `canceled`.
    - The running unit receives a best-effort executor interruption and the run is finalized once control returns.
  - `fail-fast`:
    - All non-terminal units transition immediately to `canceled` without intermediate `canceling` state.
- Final run status is `canceled`.

## Current Limits

- Workflow inputs are required when declared; optional/defaulted inputs are not implemented yet.
- Trigger support is intentionally narrow: manual plus GitHub push only.
- Outputs must be small enough for runtime state. The current local executor rejects outputs larger than 64 KiB.
- Output formats are limited to `json` and `text`.
- Report payloads are file-backed; workflow-level report aggregation is still minimal.
- Output and report collection currently requires a mounted workspace.
