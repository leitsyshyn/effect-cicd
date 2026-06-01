export default {
  workflowId: "workflow:github:trigger",
  name: "github trigger workflow",
  triggers: [
    {
      _tag: "GitHubPushTrigger",
      branches: ["main"],
    },
  ],
  units: [
    {
      unitId: "unit:build",
      name: "build",
      command: {
        _tag: "ContainerCommand",
        image: "alpine:latest",
        command: ["sh", "-c", "echo github trigger"],
      },
    },
  ],
}
