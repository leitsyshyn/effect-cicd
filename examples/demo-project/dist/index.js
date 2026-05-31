// @bun
// src/index.ts
var add = (left, right) => left + right;
var describeBuild = () => ({
  name: "effect-cicd-demo-project",
  result: add(20, 22),
  builtWith: "bun"
});
export {
  describeBuild,
  add
};
