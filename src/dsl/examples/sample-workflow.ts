import { artifact, containerCommand, unit, workflow } from "../builders.ts"

export const sampleWorkflow = workflow({
  workflowId: "workflow:sample",
  name: "sample workflow",
  metadata: { owner: "cli" },
  units: [
    unit({
      unitId: "unit:test",
      name: "test",
      command: containerCommand({
        image: "oven/bun:latest",
        command: ["bun", "test"],
        env: { CI: "true" },
      }),
      dependsOn: ["unit:build"],
      artifacts: [artifact({ name: "coverage" })],
    }),
    unit({
      unitId: "unit:deploy",
      name: "deploy",
      command: containerCommand({
        image: "oven/bun:latest",
        command: ["bun", "run", "ship"],
        env: { CI: "true" },
      }),
      dependsOn: ["unit:test"],
      artifacts: [artifact({ name: "release-manifest" })],
    }),
    unit({
      unitId: "unit:build",
      name: "build",
      command: containerCommand({
        image: "oven/bun:latest",
        command: ["bun", "run", "build"],
        env: { CI: "true" },
      }),
      artifacts: [artifact({ name: "dist" })],
    }),
  ],
})
