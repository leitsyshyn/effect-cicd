const packageJson = await Bun.file("./package.json").json() as { readonly name: string }
const buildOutput = await Bun.file("./dist/index.js").text()

await Bun.write(
  "./dist/release.json",
  JSON.stringify(
    {
      name: packageJson.name,
      entrypoint: "dist/index.js",
      bytes: new TextEncoder().encode(buildOutput).byteLength,
      generatedBy: "effect-cicd-demo",
    },
    null,
    2,
  ) + "\n",
)

console.log("release manifest written: dist/release.json")
