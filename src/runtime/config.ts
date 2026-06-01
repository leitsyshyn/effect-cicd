import { Config, Effect, Layer, Redacted } from "effect"
import type * as Duration from "effect/Duration"
import * as Context from "effect/Context"
import { resolve as resolvePath } from "node:path"

export class PostgresConfig extends Context.Service<
  PostgresConfig,
  {
    readonly url: Redacted.Redacted | undefined
    readonly host: string | undefined
    readonly port: number | undefined
    readonly database: string | undefined
    readonly username: string | undefined
    readonly password: Redacted.Redacted | undefined
    readonly connectTimeout: Duration.Duration | undefined
    readonly idleTimeout: Duration.Duration | undefined
    readonly connectionTTL: Duration.Duration | undefined
    readonly maxConnections: number | undefined
    readonly minConnections: number | undefined
  }
>()("@effect-cicd/runtime/PostgresConfig") {
  static readonly layer = Layer.effect(
    PostgresConfig,
    Effect.gen(function* () {
      const url = yield* Config.option(Config.redacted("POSTGRES_URL"))
      const host = yield* Config.option(Config.string("PGHOST"))
      const port = yield* Config.option(Config.int("PGPORT"))
      const database = yield* Config.option(Config.string("PGDATABASE"))
      const username = yield* Config.option(
        Config.string("PGUSERNAME").pipe(
          Config.orElse(() => Config.string("PGUSER")),
        ),
      )
      const password = yield* Config.option(Config.redacted("PGPASSWORD"))
      const connectTimeout = yield* Config.option(Config.duration("POSTGRES_CONNECT_TIMEOUT"))
      const idleTimeout = yield* Config.option(Config.duration("POSTGRES_IDLE_TIMEOUT"))
      const connectionTTL = yield* Config.option(Config.duration("POSTGRES_CONNECTION_TTL"))
      const maxConnections = yield* Config.option(Config.int("POSTGRES_MAX_CONNECTIONS"))
      const minConnections = yield* Config.option(Config.int("POSTGRES_MIN_CONNECTIONS"))

      return {
        url: optionValue(url),
        host: optionValue(host),
        port: optionValue(port),
        database: optionValue(database),
        username: optionValue(username),
        password: optionValue(password),
        connectTimeout: optionValue(connectTimeout),
        idleTimeout: optionValue(idleTimeout),
        connectionTTL: optionValue(connectionTTL),
        maxConnections: optionValue(maxConnections),
        minConnections: optionValue(minConnections),
      }
    }),
  )
}

export class ObjectStorageConfig extends Context.Service<
  ObjectStorageConfig,
  {
    readonly endpoint: string | undefined
    readonly region: string | undefined
    readonly bucket: string
    readonly accessKeyId: string
    readonly secretAccessKey: Redacted.Redacted
    readonly pathStyle: boolean
    readonly prefix: string | undefined
  }
>()("@effect-cicd/runtime/ObjectStorageConfig") {
  static readonly layer = Layer.effect(
    ObjectStorageConfig,
    Effect.gen(function* () {
      const endpoint = yield* Config.option(Config.string("S3_ENDPOINT"))
      const region = yield* Config.option(Config.string("S3_REGION"))
      const bucket = yield* Config.string("S3_BUCKET")
      const accessKeyId = yield* Config.string("S3_ACCESS_KEY").pipe(
        Config.orElse(() => Config.string("S3_ACCESS_KEY_ID")),
      )
      const secretAccessKey = yield* Config.redacted("S3_SECRET_KEY").pipe(
        Config.orElse(() => Config.redacted("S3_SECRET_ACCESS_KEY")),
      )
      const pathStyle = yield* Config.boolean("S3_PATH_STYLE").pipe(
        Config.orElse(() => Config.succeed(false)),
      )
      const prefix = yield* Config.option(Config.string("S3_PREFIX"))

      return {
        endpoint: optionValue(endpoint),
        region: optionValue(region),
        bucket,
        accessKeyId,
        secretAccessKey,
        pathStyle,
        prefix: normalizePrefix(optionValue(prefix)),
      }
    }),
  )
}

export class StorageRuntimeConfig extends Context.Service<
  StorageRuntimeConfig,
  {
    readonly runRecoveryOnStartup: boolean
    readonly runStorageTests: boolean
  }
>()("@effect-cicd/runtime/StorageRuntimeConfig") {
  static readonly layer = Layer.effect(
    StorageRuntimeConfig,
    Effect.gen(function* () {
      const runRecoveryOnStartup = yield* Config.boolean("RUN_RECOVERY_ON_STARTUP").pipe(
        Config.orElse(() => Config.succeed(true)),
      )
      const runStorageTests = yield* Config.boolean("RUN_STORAGE_TESTS").pipe(
        Config.orElse(() => Config.succeed(false)),
      )

      return {
        runRecoveryOnStartup,
        runStorageTests,
      }
    }),
  )
}

export class EngineServiceConfig extends Context.Service<
  EngineServiceConfig,
  {
    readonly baseUrl: string
    readonly port: number
  }
>()("@effect-cicd/runtime/EngineServiceConfig") {
  static readonly layer = Layer.effect(
    EngineServiceConfig,
    Effect.gen(function* () {
      const baseUrl = yield* Config.string("ENGINE_BASE_URL").pipe(
        Config.orElse(() => Config.succeed("http://127.0.0.1:3000")),
      )
      const port = yield* Config.int("ENGINE_PORT").pipe(
        Config.orElse(() => Config.succeed(3000)),
      )

      return {
        baseUrl,
        port,
      }
    }),
  )
}

export class GitHubTriggerConfig extends Context.Service<
  GitHubTriggerConfig,
  {
    readonly workspaceRoot: string
  }
>()("@effect-cicd/runtime/GitHubTriggerConfig") {
  static readonly layer = Layer.effect(
    GitHubTriggerConfig,
    Effect.gen(function* () {
      const workspaceRoot = yield* Config.string("GITHUB_WORKSPACE_ROOT").pipe(
        Config.orElse(() => Config.succeed(resolvePath(process.cwd(), ".effect-cicd", "github"))),
      )

      return { workspaceRoot }
    }),
  )
}

export class GitHubAppConfig extends Context.Service<
  GitHubAppConfig,
  {
    readonly appId: string | undefined
    readonly privateKey: Redacted.Redacted | undefined
    readonly webhookSecret: Redacted.Redacted | undefined
    readonly clientId: string | undefined
    readonly clientSecret: Redacted.Redacted | undefined
    readonly publicBaseUrl: string | undefined
    readonly apiBaseUrl: string
  }
>()("@effect-cicd/runtime/GitHubAppConfig") {
  static readonly layer = Layer.effect(
    GitHubAppConfig,
    Effect.gen(function* () {
      const appId = yield* Config.option(Config.string("GITHUB_APP_ID"))
      const privateKey = yield* Config.option(Config.redacted("GITHUB_APP_PRIVATE_KEY"))
      const webhookSecret = yield* Config.option(Config.redacted("GITHUB_WEBHOOK_SECRET"))
      const clientId = yield* Config.option(Config.string("GITHUB_CLIENT_ID"))
      const clientSecret = yield* Config.option(Config.redacted("GITHUB_CLIENT_SECRET"))
      const publicBaseUrl = yield* Config.option(Config.string("PUBLIC_BASE_URL"))
      const apiBaseUrl = yield* Config.string("GITHUB_API_BASE_URL").pipe(
        Config.orElse(() => Config.succeed("https://api.github.com")),
      )

      return {
        appId: optionValue(appId),
        privateKey: optionValue(privateKey),
        webhookSecret: optionValue(webhookSecret),
        clientId: optionValue(clientId),
        clientSecret: optionValue(clientSecret),
        publicBaseUrl: optionValue(publicBaseUrl),
        apiBaseUrl,
      }
    }),
  )
}

const optionValue = <A>(option: { readonly _tag: "Some"; readonly value: A } | { readonly _tag: "None" }) =>
  option._tag === "Some" ? option.value : undefined

const normalizePrefix = (prefix: string | undefined) => {
  if (prefix === undefined) {
    return undefined
  }

  const trimmed = prefix.trim().replace(/^\/+|\/+$/g, "")
  return trimmed.length === 0 ? undefined : trimmed
}
