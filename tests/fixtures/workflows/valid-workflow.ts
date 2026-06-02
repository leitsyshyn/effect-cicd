import { Artifact, Job, Workflow } from "../../../src/dsl/index.ts"

export default Workflow.make("workflow:fixture:valid").pipe(
  Workflow.named("fixture valid workflow"),
  Workflow.metadata({ owner: "tests" }),
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

export const workflowNamed = Workflow.make("workflow:fixture:named").pipe(
  Workflow.named("fixture named workflow"),
  Workflow.metadata({ owner: "tests" }),
  Workflow.job(
    Job.make("unit:build").pipe(
      Job.named("build"),
      Job.image("alpine:latest"),
      Job.run("echo build"),
      Job.env({ CI: "true" }),
      Job.artifact(Artifact.file("dist", "artifacts/named-dist.txt")),
    ),
  ),
)
