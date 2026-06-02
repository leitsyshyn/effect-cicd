import { Job, Workflow } from "../../../src/dsl/index.ts"

export default Workflow.make("workflow:fixture:materialization-error").pipe(
  Workflow.named("fixture materialization error"),
  Workflow.metadata({ owner: "tests" }),
  Workflow.job(
    Job.make("unit:build").pipe(Job.named("build"), Job.image("alpine:latest"), Job.run("echo build")),
    Job.make("unit:build").pipe(Job.named("build again"), Job.image("alpine:latest"), Job.run("echo build")),
  ),
)
