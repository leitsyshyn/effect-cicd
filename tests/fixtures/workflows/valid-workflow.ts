import { artifact, containerCommand, unit, workflow } from "../../../src/dsl/index.ts"

export default workflow({
  workflowId: "workflow:fixture:valid",
  name: "fixture valid workflow",
  metadata: { owner: "tests" },
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

export const workflowNamed = workflow({
  workflowId: "workflow:fixture:named",
  name: "fixture named workflow",
  metadata: { owner: "tests" },
  units: [
    unit({
      unitId: "unit:build",
      name: "build",
      command: containerCommand({
        image: "alpine:latest",
        command: ["sh", "-c", "echo build"],
        env: { CI: "true" },
      }),
      artifacts: [artifact({ name: "dist", path: "artifacts/named-dist.txt" })],
    }),
  ],
})
