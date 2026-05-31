import { containerCommand, unit, workflow } from "../../../src/dsl/index.ts"

export default workflow({
  workflowId: "workflow:fixture:materialization-error",
  name: "fixture materialization error",
  metadata: { owner: "tests" },
  units: [
    unit({
      unitId: "unit:build",
      name: "build",
      command: containerCommand({
        image: "alpine:latest",
        command: ["sh", "-c", "echo build"],
      }),
    }),
    // Duplicate unitId should fail DSL materialization.
    unit({
      unitId: "unit:build",
      name: "build again",
      command: containerCommand({
        image: "alpine:latest",
        command: ["sh", "-c", "echo build"],
      }),
    }),
  ],
})
