import { Artifact, Command, Job, Workflow } from "../src/dsl/index.ts"

export default Workflow.make("workflow:demo:mvp").pipe(
  Workflow.named("demo mvp workflow"),
  Workflow.metadata({
    owner: "examples",
    phase: "11",
  }),
  Workflow.job(
    Job.make("unit:build").pipe(
      Job.named("build"),
      Job.image("oven/bun:1"),
      Job.exec(Command.argv("bun", ["run", "build"])),
      Job.env({ CI: "true" }),
      Job.workingDirectory("."),
    ),
    Job.make("unit:test").pipe(
      Job.named("test"),
      Job.image("oven/bun:1"),
      Job.dependsOn("unit:build"),
      Job.exec(Command.argv("bun", ["test"])),
      Job.env({ CI: "true" }),
      Job.workingDirectory("."),
    ),
    Job.make("unit:package").pipe(
      Job.named("package"),
      Job.image("oven/bun:1"),
      Job.dependsOn("unit:test"),
      Job.exec(Command.argv("bun", ["run", "package"])),
      Job.env({ CI: "true" }),
      Job.workingDirectory("."),
      Job.artifact(
        Artifact.file("release-manifest", "dist/release.json", { contentType: "application/json" }),
      ),
    ),
  ),
)
