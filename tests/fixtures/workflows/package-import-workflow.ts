import { Command, Job, Trigger, Workflow } from "@effect-cicd/dsl"

export default Workflow.make("workflow:fixture:package-import").pipe(
  Workflow.named("fixture package import workflow"),
  Workflow.on(Trigger.githubPush({ branches: ["main"] })),
  Workflow.job(
    Job.make("unit:build").pipe(
      Job.named("build"),
      Job.image("oven/bun:1"),
      Job.exec(Command.argv("bun", ["run", "test"])),
    ),
  ),
)
