export default {
  workflowId: "workflow:github:trigger",
  name: "github trigger workflow",
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
