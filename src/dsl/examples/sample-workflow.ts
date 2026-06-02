import { Artifact, Job, Trigger, Workflow } from "../public.ts"

export const sampleWorkflow = Workflow.make("workflow:sample").pipe(
  Workflow.named("sample workflow"),
  Workflow.metadata({ owner: "cli" }),
  Workflow.on(Trigger.manual()),
  Workflow.job(
    Job.make("unit:build").pipe(
      Job.named("build"),
      Job.image("alpine:latest"),
      Job.run("echo build"),
      Job.env({ CI: "true" }),
      Job.artifact(Artifact.file("dist", "artifacts/dist.txt")),
    ),
    Job.make("unit:test").pipe(
      Job.named("test"),
      Job.image("alpine:latest"),
      Job.dependsOn("unit:build"),
      Job.run("echo test"),
      Job.env({ CI: "true" }),
      Job.artifact(Artifact.file("coverage", "artifacts/coverage.txt")),
    ),
    Job.make("unit:deploy").pipe(
      Job.named("deploy"),
      Job.image("alpine:latest"),
      Job.dependsOn("unit:test"),
      Job.run("echo deploy"),
      Job.env({ CI: "true" }),
      Job.artifact(Artifact.file("release-manifest", "artifacts/release-manifest.json")),
    ),
  ),
)
