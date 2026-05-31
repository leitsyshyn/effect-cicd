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
        image: "alpine:latest",
        command: ["sh", "-c", "echo test"],
        env: { CI: "true" },
      }),
      dependsOn: ["unit:build"],
      artifacts: [artifact({ name: "coverage", path: "artifacts/coverage.txt" })],
    }),
    unit({
      unitId: "unit:deploy",
      name: "deploy",
      command: containerCommand({
        image: "alpine:latest",
        command: ["sh", "-c", "echo deploy"],
        env: { CI: "true" },
      }),
      dependsOn: ["unit:test"],
      artifacts: [artifact({ name: "release-manifest", path: "artifacts/release-manifest.json" })],
    }),
    unit({
      unitId: "unit:build",
      name: "build",
      command: containerCommand({
        image: "alpine:latest",
        command: ["sh", "-c", "echo build"],
        env: { CI: "true" },
      }),
      artifacts: [artifact({ name: "dist", path: "artifacts/dist.txt" })],
    }),
  ],
})
