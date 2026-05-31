export const add = (left: number, right: number) => left + right

export const describeBuild = () => ({
  name: "effect-cicd-demo-project",
  result: add(20, 22),
  builtWith: "bun",
})
