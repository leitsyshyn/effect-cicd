import { artifact, containerCommand, unit, workflow } from "../src/dsl/index.ts"

export default workflow({
  workflowId: "workflow:demo:mvp",
  name: "demo mvp workflow",
  metadata: {
    owner: "examples",
    phase: "11",
  },
  units: [
    unit({
      unitId: "unit:build",
      name: "build",
      command: containerCommand({
        image: "oven/bun:1",
        command: ["bun", "run", "build"],
        env: { CI: "true" },
        workingDirectory: ".",
      }),
    }),
    unit({
      unitId: "unit:test",
      name: "test",
      dependsOn: ["unit:build"],
      command: containerCommand({
        image: "oven/bun:1",
        command: ["bun", "test"],
        env: { CI: "true" },
        workingDirectory: ".",
      }),
    }),
    unit({
      unitId: "unit:package",
      name: "package",
      dependsOn: ["unit:test"],
      command: containerCommand({
        image: "oven/bun:1",
        command: ["bun", "run", "package"],
        env: { CI: "true" },
        workingDirectory: ".",
      }),
      artifacts: [
        artifact({
          name: "release-manifest",
          path: "dist/release.json",
          contentType: "application/json",
        }),
      ],
    }),
  ],
})
