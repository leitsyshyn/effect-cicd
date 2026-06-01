const packageJson = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as { readonly version?: string }

export const appVersion = packageJson.version ?? "0.0.0"
