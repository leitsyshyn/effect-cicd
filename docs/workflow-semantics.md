# Workflow Semantics

This phase makes the declared workflow dataflow and control semantics operational at runtime.

## Supported Runtime Model

- Workflow inputs are declared at the workflow level and supplied when a run starts.
- Unit inputs are explicit references to either workflow inputs or upstream unit outputs.
- Unit outputs are explicit file-backed values collected after successful execution.
- Workflow outputs are explicit references to workflow inputs or unit outputs.
- Unit reports are explicit file-backed report payloads persisted as report records plus artifact payloads.
- Unit timeouts are enforced at execution time.
- Run cancellation is engine-owned and externally controllable.

## DSL Example

```ts
import {
  containerCommand,
  input,
  output,
  report,
  timeout,
  unit,
  unitOutput,
  workflow,
  workflowInput,
} from "../src/dsl/index.ts"

export default workflow({
  workflowId: "workflow:release",
  name: "release",
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
      outputs: [output({ name: "digest", path: "outputs/digest.json", format: "json", metadata: {} })],
      reports: [report({ name: "summary", path: "reports/summary.txt", format: "text", contentType: "text/plain", metadata: {} })],
      policies: [timeout({ seconds: 30 })],
    }),
  ],
})
```

## Input Semantics

- Declared workflow inputs are required at run start.
- Unknown input keys are rejected.
- CLI input values are provided with `--inputs '<json object>'`.
- Service/API input values are provided as `options.inputValues` on `POST /api/runs`.
- The executor receives resolved inputs in `DispatchRequest.inputs`.
- Local container execution injects:
  - `EFFECT_CICD_INPUTS_JSON`
  - `EFFECT_CICD_INPUT_<NAME>` for each resolved input

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
- Downstream units are skipped.
- The run ends in `timed_out`.

## Cancellation Semantics

- Runs are canceled through the engine, not by interface-specific store access.
- `runs cancel <runId>` and `POST /api/runs/:runId/cancel` request cancellation.
- Policy used in this phase:
  - Not-yet-started units become `canceled`.
  - The running unit receives a best-effort executor interruption.
  - If the local execution cannot be terminated cleanly, the engine still finalizes the run as `canceled` once control returns.
- Final run status is `canceled`.

## Current Limits

- Workflow inputs are required when declared; optional/defaulted inputs are not implemented yet.
- Outputs must be small enough for runtime state. The current local executor rejects outputs larger than 64 KiB.
- Output formats are limited to `json` and `text`.
- Report payloads are file-backed; workflow-level report aggregation is still minimal.
- Output and report collection currently requires a mounted workspace.
