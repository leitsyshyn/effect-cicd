import { PgClient, PgMigrator } from "@effect/sql-pg"
import { Duration, Effect, Layer, Option, Redacted, Schedule } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { StoreUnavailable } from "../domain/errors.ts"
import { Metrics } from "./metrics.ts"
import { ObjectStorageConfig, PostgresConfig } from "./config.ts"

export class StorageTransactor extends Context.Service<
  StorageTransactor,
  {
    readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | StoreUnavailable, R>
  }
>()("@effect-cicd/runtime/StorageTransactor") {
  static readonly memoryLayer = Layer.succeed(StorageTransactor, {
    run: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
  })

  static readonly postgresLayer = Layer.effect(
    StorageTransactor,
    Effect.gen(function* () {
      const sql = yield* SqlClient

      return {
        run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          sql.withTransaction(effect as Effect.Effect<A, E, never>).pipe(
            Effect.catch((error): any =>
              isSqlError(error)
                ? Effect.fail(
                    new StoreUnavailable({
                      store: "Postgres",
                      message: `SQL transaction failed: ${error.message}`,
                    }),
                  )
                : Effect.fail(error as E),
            ),
          ) as any,
      }
    }),
  )
}

export class ObjectStorageClient extends Context.Service<
  ObjectStorageClient,
  {
    readonly bucket: string
    readonly qualifyKey: (key: string) => string
    readonly writeObject: (
      key: string,
      payload: string | Uint8Array,
      options?: {
        readonly contentType?: string
        readonly contentDisposition?: string
      },
    ) => Effect.Effect<void, StoreUnavailable>
    readonly readText: (key: string) => Effect.Effect<string, StoreUnavailable>
    readonly readBytes: (key: string) => Effect.Effect<Uint8Array, StoreUnavailable>
    readonly deleteObject: (key: string) => Effect.Effect<void, StoreUnavailable>
    readonly checkHealth: () => Effect.Effect<void, StoreUnavailable>
  }
>()("@effect-cicd/runtime/ObjectStorageClient") {
  static readonly layer = Layer.effect(
    ObjectStorageClient,
    Effect.gen(function* () {
      const config = yield* ObjectStorageConfig
      const metrics = yield* Effect.serviceOption(Metrics)
      const client = new Bun.S3Client({
        accessKeyId: config.accessKeyId,
        secretAccessKey: Redacted.value(config.secretAccessKey),
        bucket: config.bucket,
        ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
        ...(config.region === undefined ? {} : { region: config.region }),
        virtualHostedStyle: !config.pathStyle,
      })

      const qualifyKey = (key: string) => (config.prefix === undefined ? key : `${config.prefix}/${key}`)
      const retrySchedule = Schedule.exponential(Duration.millis(50)).pipe(Schedule.jittered, Schedule.both(Schedule.recurs(config.operationRetries - 1)))
      const incrementS3Metric = (operation: string, status: "success" | "failure") =>
        Effect.sync(() =>
          Option.match(metrics, {
            onNone: () => undefined,
            onSome: (service) => service.incrementCounter("s3_operations_total", { operation, status }),
          }),
        )

      const withS3Retry = <A>(operation: string, effect: Effect.Effect<A, StoreUnavailable>) =>
        effect.pipe(
          Effect.tap(() => incrementS3Metric(operation, "success")),
          Effect.tapError(() => incrementS3Metric(operation, "failure")),
          Effect.retry(retrySchedule),
        )

      return {
        bucket: config.bucket,
        qualifyKey,
        writeObject: (key, payload, options) =>
          withS3Retry(
            "write",
            Effect.tryPromise({
              try: async () => {
                await client.write(key, payload, {
                  ...(options?.contentType === undefined ? {} : { type: options.contentType }),
                  ...(options?.contentDisposition === undefined ? {} : { contentDisposition: options.contentDisposition }),
                })
              },
              catch: (error) =>
                new StoreUnavailable({
                  store: "ArtifactStore",
                  message: `Failed to write object ${key}: ${toErrorMessage(error)}`,
                }),
            }),
          ),
        readText: (key) =>
          withS3Retry(
            "read",
            Effect.tryPromise({
              try: () => client.file(key).text(),
              catch: (error) =>
                new StoreUnavailable({
                  store: "ArtifactStore",
                  message: `Failed to read object ${key}: ${toErrorMessage(error)}`,
                }),
            }),
          ),
        readBytes: (key) =>
          withS3Retry(
            "read",
            Effect.tryPromise({
              try: async () => new Uint8Array(await client.file(key).arrayBuffer()),
              catch: (error) =>
                new StoreUnavailable({
                  store: "ArtifactStore",
                  message: `Failed to read object ${key}: ${toErrorMessage(error)}`,
                }),
            }),
          ),
        deleteObject: (key) =>
          withS3Retry(
            "delete",
            Effect.tryPromise({
              try: () => client.delete(key),
              catch: (error) =>
                new StoreUnavailable({
                  store: "ArtifactStore",
                  message: `Failed to delete object ${key}: ${toErrorMessage(error)}`,
                }),
            }),
          ),
        checkHealth: () =>
          Effect.tryPromise({
            try: async () => {
              await client.exists(qualifyKey("healthz"))
            },
            catch: (error) =>
              new StoreUnavailable({
                store: "ArtifactStore",
                message: `Failed to reach object storage: ${toErrorMessage(error)}`,
              }),
          }),
      }
    }),
  ).pipe(Layer.provide(ObjectStorageConfig.layer))
}

export const sqlClientLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* PostgresConfig

    const layer = PgClient.layer({
      ...(config.url === undefined ? {} : { url: config.url }),
      ...(config.host === undefined ? {} : { host: config.host }),
      ...(config.port === undefined ? {} : { port: config.port }),
      ...(config.database === undefined ? {} : { database: config.database }),
      ...(config.username === undefined ? {} : { username: config.username }),
      ...(config.password === undefined ? {} : { password: config.password }),
      ...(config.connectTimeout === undefined ? {} : { connectTimeout: config.connectTimeout }),
      ...(config.idleTimeout === undefined ? {} : { idleTimeout: config.idleTimeout }),
      ...(config.connectionTTL === undefined ? {} : { connectionTTL: config.connectionTTL }),
      ...(config.maxConnections === undefined ? {} : { maxConnections: config.maxConnections }),
      ...(config.minConnections === undefined ? {} : { minConnections: config.minConnections }),
    })

    return Layer.unwrap(
      Effect.retry(
        Effect.succeed(layer),
        Schedule.exponential(config.connectRetryDelay).pipe(Schedule.both(Schedule.recurs(config.connectRetries - 1))),
      ),
    )
  }),
).pipe(Layer.provide(PostgresConfig.layer))

export const storageMigrationLayer = PgMigrator.layer({
  loader: PgMigrator.fromRecord({
    "0001_runtime_storage": Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* sql`CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id text PRIMARY KEY,
        workflow_id text NOT NULL,
        plan_id text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        started_at timestamptz,
        finished_at timestamptz,
        state_json jsonb NOT NULL
      )`

      yield* sql`CREATE INDEX IF NOT EXISTS workflow_runs_updated_at_idx ON workflow_runs (updated_at DESC, run_id ASC)`
      yield* sql`CREATE INDEX IF NOT EXISTS workflow_runs_status_idx ON workflow_runs (status)`

      yield* sql`CREATE TABLE IF NOT EXISTS workflow_events (
        run_id text NOT NULL,
        sequence bigint NOT NULL,
        event_id text NOT NULL UNIQUE,
        event_type text NOT NULL,
        occurred_at timestamptz NOT NULL,
        event_json jsonb NOT NULL,
        PRIMARY KEY (run_id, sequence)
      )`

      yield* sql`CREATE INDEX IF NOT EXISTS workflow_events_run_id_idx ON workflow_events (run_id, sequence)`

      yield* sql`CREATE TABLE IF NOT EXISTS artifact_metadata (
        artifact_ref text PRIMARY KEY,
        run_id text NOT NULL,
        unit_id text,
        attempt_id text,
        name text NOT NULL,
        category text NOT NULL,
        status text NOT NULL,
        bucket text NOT NULL,
        object_key text NOT NULL,
        content_type text,
        metadata_json jsonb NOT NULL
      )`

      yield* sql`CREATE INDEX IF NOT EXISTS artifact_metadata_run_id_idx ON artifact_metadata (run_id, artifact_ref)`

      yield* sql`CREATE TABLE IF NOT EXISTS log_metadata (
        log_ref text PRIMARY KEY,
        run_id text NOT NULL,
        unit_id text,
        attempt_id text,
        name text NOT NULL,
        status text NOT NULL,
        bucket text NOT NULL,
        object_key text NOT NULL,
        metadata_json jsonb NOT NULL
      )`

      yield* sql`CREATE INDEX IF NOT EXISTS log_metadata_run_id_idx ON log_metadata (run_id, log_ref)`

      yield* sql`CREATE TABLE IF NOT EXISTS github_bindings (
        binding_id text PRIMARY KEY,
        provider text NOT NULL,
        repo_owner text NOT NULL,
        repo_name text NOT NULL,
        clone_url text NOT NULL,
        branch text,
        workflow_module_path text NOT NULL,
        workspace_subdir text,
        enabled boolean NOT NULL,
        webhook_secret text,
        access_token text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        binding_json jsonb NOT NULL
      )`

      yield* sql`CREATE INDEX IF NOT EXISTS github_bindings_repo_idx
        ON github_bindings (repo_owner, repo_name, enabled, updated_at DESC, binding_id ASC)`
    }),
    "0002_github_bindings": Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* sql`CREATE TABLE IF NOT EXISTS github_bindings (
        binding_id text PRIMARY KEY,
        provider text NOT NULL,
        repo_owner text NOT NULL,
        repo_name text NOT NULL,
        clone_url text NOT NULL,
        branch text,
        workflow_module_path text NOT NULL,
        workspace_subdir text,
        enabled boolean NOT NULL,
        webhook_secret text,
        access_token text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        binding_json jsonb NOT NULL
      )`

      yield* sql`CREATE INDEX IF NOT EXISTS github_bindings_repo_idx
        ON github_bindings (repo_owner, repo_name, enabled, updated_at DESC, binding_id ASC)`
    }),
    "0003_github_app_loop": Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* sql`ALTER TABLE github_bindings ADD COLUMN IF NOT EXISTS installation_id bigint`
      yield* sql`ALTER TABLE github_bindings ADD COLUMN IF NOT EXISTS repository_id bigint`
      yield* sql`ALTER TABLE github_bindings ADD COLUMN IF NOT EXISTS source_kind text`
      yield* sql`UPDATE github_bindings SET source_kind = 'github-archive' WHERE source_kind IS NULL`
      yield* sql`ALTER TABLE github_bindings ALTER COLUMN source_kind SET DEFAULT 'github-archive'`

      yield* sql`CREATE TABLE IF NOT EXISTS github_run_links (
        run_id text PRIMARY KEY,
        binding_id text NOT NULL,
        installation_id bigint NOT NULL,
        repository_id bigint NOT NULL,
        repo_owner text NOT NULL,
        repo_name text NOT NULL,
        workflow_module_path text NOT NULL,
        git_ref text NOT NULL,
        branch text,
        commit_sha text NOT NULL,
        delivery_id text,
        check_run_id bigint,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        link_json jsonb NOT NULL
      )`

      yield* sql`CREATE INDEX IF NOT EXISTS github_run_links_binding_idx
        ON github_run_links (binding_id, updated_at DESC, run_id ASC)`

      yield* sql`CREATE INDEX IF NOT EXISTS github_run_links_installation_repo_idx
        ON github_run_links (installation_id, repository_id, updated_at DESC, run_id ASC)`
    }),
    "0004_secrets": Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* sql`CREATE TABLE IF NOT EXISTS secrets (
        project_id text NOT NULL,
        secret_key text PRIMARY KEY,
        algorithm text NOT NULL,
        iv_base64 text NOT NULL,
        ciphertext_base64 text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )`

      yield* sql`ALTER TABLE secrets ADD COLUMN IF NOT EXISTS project_id text`
      yield* sql`UPDATE secrets SET project_id = 'workflow:default' WHERE project_id IS NULL`
      yield* sql`ALTER TABLE secrets ALTER COLUMN project_id SET NOT NULL`
      yield* sql`ALTER TABLE secrets DROP CONSTRAINT IF EXISTS secrets_pkey`
      yield* sql`ALTER TABLE secrets ADD PRIMARY KEY (project_id, secret_key)`
      yield* sql`CREATE INDEX IF NOT EXISTS secrets_updated_at_idx ON secrets (project_id, updated_at DESC, secret_key ASC)`
    }),
    "0005_project_queueing": Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS project_id text`
      yield* sql`UPDATE workflow_runs
        SET project_id = COALESCE(state_json->>'projectId', workflow_id)
        WHERE project_id IS NULL`
      yield* sql`ALTER TABLE workflow_runs ALTER COLUMN project_id SET NOT NULL`
      yield* sql`CREATE INDEX IF NOT EXISTS workflow_runs_project_idx ON workflow_runs (project_id, updated_at DESC, run_id ASC)`
      yield* sql`CREATE INDEX IF NOT EXISTS workflow_runs_project_status_idx ON workflow_runs (project_id, status, created_at ASC, run_id ASC)`

      yield* sql`ALTER TABLE github_bindings ADD COLUMN IF NOT EXISTS project_id text`
      yield* sql`UPDATE github_bindings
        SET project_id = COALESCE(
          binding_json->>'projectId',
          CASE
            WHEN repository_id IS NOT NULL THEN 'project:github:repo:' || repository_id::text
            ELSE 'project:github:' || lower(repo_owner) || '/' || lower(repo_name)
          END
        )
        WHERE project_id IS NULL`
      yield* sql`ALTER TABLE github_bindings ALTER COLUMN project_id SET NOT NULL`
      yield* sql`CREATE INDEX IF NOT EXISTS github_bindings_project_idx ON github_bindings (project_id, updated_at DESC, binding_id ASC)`

      yield* sql`ALTER TABLE github_run_links ADD COLUMN IF NOT EXISTS project_id text`
      yield* sql`UPDATE github_run_links
        SET project_id = COALESCE(link_json->>'projectId', 'project:github:repo:' || repository_id::text)
        WHERE project_id IS NULL`
      yield* sql`ALTER TABLE github_run_links ALTER COLUMN project_id SET NOT NULL`
      yield* sql`CREATE INDEX IF NOT EXISTS github_run_links_project_idx ON github_run_links (project_id, updated_at DESC, run_id ASC)`

      yield* sql`CREATE TABLE IF NOT EXISTS github_trigger_deliveries (
        idempotency_key text PRIMARY KEY,
        binding_id text NOT NULL,
        project_id text NOT NULL,
        provider text NOT NULL,
        event text NOT NULL,
        repository_id bigint NOT NULL,
        repo_owner text NOT NULL,
        repo_name text NOT NULL,
        git_ref text NOT NULL,
        commit_sha text NOT NULL,
        delivery_id text,
        run_id text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        delivery_json jsonb NOT NULL
      )`

      yield* sql`CREATE INDEX IF NOT EXISTS github_trigger_deliveries_binding_idx
        ON github_trigger_deliveries (binding_id, created_at DESC, idempotency_key ASC)`
      yield* sql`CREATE INDEX IF NOT EXISTS github_trigger_deliveries_project_idx
        ON github_trigger_deliveries (project_id, created_at DESC, idempotency_key ASC)`
      yield* sql`CREATE INDEX IF NOT EXISTS github_trigger_deliveries_delivery_id_idx
        ON github_trigger_deliveries (delivery_id, binding_id, created_at DESC, idempotency_key ASC)`
    }),
    "0006_artifact_lifecycle": Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* sql`ALTER TABLE artifact_metadata ADD COLUMN IF NOT EXISTS expires_at timestamptz`
      yield* sql`ALTER TABLE artifact_metadata ADD COLUMN IF NOT EXISTS retention_days integer`
      yield* sql`CREATE INDEX IF NOT EXISTS artifact_metadata_expires_at_idx ON artifact_metadata (expires_at, run_id)`

      yield* sql`ALTER TABLE log_metadata ADD COLUMN IF NOT EXISTS expires_at timestamptz`
      yield* sql`ALTER TABLE log_metadata ADD COLUMN IF NOT EXISTS retention_days integer`
      yield* sql`CREATE INDEX IF NOT EXISTS log_metadata_expires_at_idx ON log_metadata (expires_at, run_id)`
    }),
    "0007_cleanup_legacy_run_state_json": Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* sql`UPDATE workflow_runs
        SET state_json = jsonb_set(
          state_json,
          '{projectId}',
          to_jsonb(project_id),
          true
        )
        WHERE state_json->>'projectId' IS NULL`
    }),
    "0008_artifact_content_type": Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* sql`ALTER TABLE artifact_metadata ADD COLUMN IF NOT EXISTS content_type text`
    }),
    "0009_local_projects": Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* sql`CREATE TABLE IF NOT EXISTS local_projects (
        project_id text PRIMARY KEY,
        provider text NOT NULL,
        workflow_module_path text NOT NULL,
        workspace_path text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )`

      yield* sql`CREATE INDEX IF NOT EXISTS local_projects_updated_at_idx ON local_projects (updated_at DESC, project_id ASC)`
    }),
  }),
})

const toErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }

  return String(error)
}
