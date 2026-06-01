import { Clock, Config, Effect, Layer, Redacted } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { SecretBackendUnavailable, SecretNameInvalid, SecretNotFound } from "../domain/errors.ts"
import { SecretSummary } from "../domain/secrets.ts"

const secretNamePattern = /^[A-Z][A-Z0-9_]*$/
const algorithm = "aes-256-gcm"

export class SecretStore extends Context.Service<
  SecretStore,
  {
    readonly setSecret: (projectId: string, key: string, value: string) => Effect.Effect<void, SecretNameInvalid | SecretBackendUnavailable>
    readonly listSecrets: (projectId: string) => Effect.Effect<ReadonlyArray<SecretSummary>, SecretNameInvalid | SecretBackendUnavailable>
    readonly resolveSecret: (projectId: string, key: string) => Effect.Effect<string, SecretNameInvalid | SecretNotFound | SecretBackendUnavailable>
    readonly deleteSecret: (projectId: string, key: string) => Effect.Effect<void, SecretNameInvalid | SecretNotFound | SecretBackendUnavailable>
  }
>()("@effect-cicd/secrets/SecretStore") {
  static readonly memoryLayer = Layer.sync(SecretStore, () => {
    const secrets = new Map<string, { readonly value: string; readonly createdAt: Date; readonly updatedAt: Date }>()

    const setSecret = Effect.fn("SecretStore.setSecret")(function* (projectId: string, key: string, value: string) {
      yield* validateProjectId(projectId)
      yield* validateSecretName(key)
      const now = yield* nowDate
      const scopedKey = toScopedKey(projectId, key)
      const current = secrets.get(scopedKey)
      secrets.set(scopedKey, {
        value,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      })
    })

    const listSecrets = Effect.fn("SecretStore.listSecrets")((projectId: string) =>
      Effect.gen(function* () {
        yield* validateProjectId(projectId)

        return yield* Effect.sync(() =>
        [...secrets.entries()]
          .filter(([scopedKey]) => scopedKey.startsWith(`${projectId}\u0000`))
          .map(
            ([scopedKey, value]) =>
              new SecretSummary({
                projectId,
                key: fromScopedKey(scopedKey).key,
                createdAt: value.createdAt,
                updatedAt: value.updatedAt,
              }),
          )
          .sort((left, right) => compareStrings(left.key, right.key)),
        )
      }),
    )

    const resolveSecret = Effect.fn("SecretStore.resolveSecret")((projectId: string, key: string) =>
      Effect.gen(function* () {
        yield* validateProjectId(projectId)
        yield* validateSecretName(key)
        const secret = secrets.get(toScopedKey(projectId, key))
        if (secret === undefined) {
          return yield* new SecretNotFound({ key: `${projectId}:${key}` })
        }

        return secret.value
      }),
    )

    const deleteSecret = Effect.fn("SecretStore.deleteSecret")((projectId: string, key: string) =>
      Effect.gen(function* () {
        yield* validateProjectId(projectId)
        yield* validateSecretName(key)
        if (!secrets.delete(toScopedKey(projectId, key))) {
          return yield* new SecretNotFound({ key: `${projectId}:${key}` })
        }
      }),
    )

    return { setSecret, listSecrets, resolveSecret, deleteSecret }
  })

  static readonly postgresLayer = Layer.unwrap(
    Effect.sync(() =>
      Layer.effect(
        SecretStore,
        Effect.gen(function* () {
          const sql = yield* SqlClient
          const cipher = yield* SecretCipher

          const setSecret = Effect.fn("SecretStore.setSecret")(function* (projectId: string, key: string, value: string) {
            yield* validateProjectId(projectId)
            yield* validateSecretName(key)
            const now = yield* nowDate
            const encrypted = yield* cipher.encrypt(value)

            yield* catchSql(
              "set secret",
              sql`
                INSERT INTO secrets (
                  project_id,
                  secret_key,
                  algorithm,
                  iv_base64,
                  ciphertext_base64,
                  created_at,
                  updated_at
                ) VALUES (
                  ${projectId},
                  ${key},
                  ${algorithm},
                  ${encrypted.ivBase64},
                  ${encrypted.ciphertextBase64},
                  ${now},
                  ${now}
                )
                ON CONFLICT (project_id, secret_key) DO UPDATE SET
                  algorithm = EXCLUDED.algorithm,
                  iv_base64 = EXCLUDED.iv_base64,
                  ciphertext_base64 = EXCLUDED.ciphertext_base64,
                  updated_at = EXCLUDED.updated_at
              `,
            )
          })

          const listSecrets = Effect.fn("SecretStore.listSecrets")(function* (projectId: string) {
            yield* validateProjectId(projectId)
            const rows = yield* catchSql(
              "list secrets",
              sql<{ readonly secret_key: string; readonly created_at: Date; readonly updated_at: Date }>`
                SELECT secret_key, created_at, updated_at
                FROM secrets
                WHERE project_id = ${projectId}
                ORDER BY secret_key ASC
              `,
            )

            return rows.map(
              (row) =>
                new SecretSummary({
                  projectId,
                  key: row.secret_key,
                  createdAt: row.created_at,
                  updatedAt: row.updated_at,
                }),
            )
          })

          const resolveSecret = Effect.fn("SecretStore.resolveSecret")(function* (projectId: string, key: string) {
            yield* validateProjectId(projectId)
            yield* validateSecretName(key)
            const rows = yield* catchSql(
              "read secret",
              sql<{ readonly algorithm: string; readonly iv_base64: string; readonly ciphertext_base64: string }>`
                SELECT algorithm, iv_base64, ciphertext_base64
                FROM secrets
                WHERE project_id = ${projectId} AND secret_key = ${key}
              `,
            )

            const row = rows[0]
            if (row === undefined) {
              return yield* new SecretNotFound({ key: `${projectId}:${key}` })
            }

            return yield* cipher.decrypt({
              algorithm: row.algorithm,
              ivBase64: row.iv_base64,
              ciphertextBase64: row.ciphertext_base64,
            })
          })

          const deleteSecret = Effect.fn("SecretStore.deleteSecret")(function* (projectId: string, key: string) {
            yield* validateProjectId(projectId)
            yield* validateSecretName(key)
            const rows = yield* catchSql(
              "delete secret",
              sql<{ readonly secret_key: string }>`
                DELETE FROM secrets
                WHERE project_id = ${projectId} AND secret_key = ${key}
                RETURNING secret_key
              `,
            )

            if (rows.length === 0) {
              return yield* new SecretNotFound({ key: `${projectId}:${key}` })
            }
          })

          return { setSecret, listSecrets, resolveSecret, deleteSecret }
        }),
      ).pipe(Layer.provide(SecretCipher.layer)),
    ),
  )
}

class SecretCipher extends Context.Service<
  SecretCipher,
  {
    readonly encrypt: (
      value: string,
    ) => Effect.Effect<
      {
        readonly ivBase64: string
        readonly ciphertextBase64: string
      },
      SecretBackendUnavailable
    >
    readonly decrypt: (payload: {
      readonly algorithm: string
      readonly ivBase64: string
      readonly ciphertextBase64: string
    }) => Effect.Effect<string, SecretBackendUnavailable>
  }
>()("@effect-cicd/secrets/SecretCipher") {
  static readonly layer = Layer.effect(
    SecretCipher,
    Effect.gen(function* () {
      const config = yield* SecretEncryptionConfig
      const keyBytes = yield* decodeMasterKey(Redacted.value(config.masterKey))
      const cryptoKey = yield* importKey(keyBytes)

      const encrypt = Effect.fn("SecretCipher.encrypt")((value: string) =>
        Effect.tryPromise({
          try: async () => {
            const iv = crypto.getRandomValues(new Uint8Array(12))
            const encoded = new TextEncoder().encode(value)
            const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded)

            return {
              ivBase64: Buffer.from(iv).toString("base64"),
              ciphertextBase64: Buffer.from(new Uint8Array(ciphertext)).toString("base64"),
            }
          },
          catch: () =>
            new SecretBackendUnavailable({
              message: "Failed to encrypt secret payload",
            }),
        }),
      )

      const decrypt = Effect.fn("SecretCipher.decrypt")(
        (payload: {
          readonly algorithm: string
          readonly ivBase64: string
          readonly ciphertextBase64: string
        }) =>
        Effect.gen(function* () {
          if (payload.algorithm !== algorithm) {
            return yield* new SecretBackendUnavailable({
              message: `Unsupported secret encryption algorithm: ${payload.algorithm}`,
            })
          }

          return yield* Effect.tryPromise({
            try: async () => {
              const plaintext = await crypto.subtle.decrypt(
                {
                  name: "AES-GCM",
                  iv: Buffer.from(payload.ivBase64, "base64") as unknown as BufferSource,
                },
                cryptoKey,
                Buffer.from(payload.ciphertextBase64, "base64") as unknown as BufferSource,
              )

              return new TextDecoder().decode(plaintext)
            },
            catch: () =>
              new SecretBackendUnavailable({
                message: "Failed to decrypt secret payload",
              }),
          })
        }),
      )

      return { encrypt, decrypt }
    }),
  )
}

export class SecretEncryptionConfig extends Context.Service<
  SecretEncryptionConfig,
  {
    readonly masterKey: Redacted.Redacted
  }
>()("@effect-cicd/secrets/SecretEncryptionConfig") {
  static readonly layer = Layer.effect(
    SecretEncryptionConfig,
    Effect.gen(function* () {
      const masterKey = yield* Config.redacted("SECRETS_MASTER_KEY")
      return { masterKey }
    }),
  )
}

const validateSecretName = (key: string) =>
  secretNamePattern.test(key)
    ? Effect.void
    : Effect.fail(
        new SecretNameInvalid({
          key,
          message: "Secret names must match ^[A-Z][A-Z0-9_]*$",
        }),
      )

const validateProjectId = (projectId: string) =>
  projectId.trim().length > 0
    ? Effect.void
    : Effect.fail(
        new SecretNameInvalid({
          key: projectId,
          message: "Project id must be non-empty",
        }),
      )

const toScopedKey = (projectId: string, key: string) => `${projectId}\u0000${key}`

const fromScopedKey = (value: string) => {
  const separatorIndex = value.indexOf("\u0000")
  return {
    projectId: value.slice(0, separatorIndex),
    key: value.slice(separatorIndex + 1),
  }
}

const decodeMasterKey = (value: string) =>
  Effect.try({
    try: () => {
      const bytes = Uint8Array.from(Buffer.from(value, "base64"))
      if (bytes.byteLength !== 32) {
        throw new Error("SECRETS_MASTER_KEY must be base64-encoded 32-byte key material")
      }
      return bytes
    },
    catch: () =>
      new SecretBackendUnavailable({
        message: "Invalid SECRETS_MASTER_KEY; expected base64-encoded 32-byte key material",
      }),
  })

const importKey = (bytes: Uint8Array) =>
  Effect.tryPromise({
    try: () => crypto.subtle.importKey("raw", bytes as unknown as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]),
    catch: () =>
      new SecretBackendUnavailable({
        message: "Failed to initialize secret encryption key",
      }),
  })

const catchSql = <A>(operation: string, effect: Effect.Effect<A, unknown, never>) =>
  effect.pipe(
    Effect.catch((error: unknown) =>
      isSqlError(error)
        ? Effect.fail(
            new SecretBackendUnavailable({
              message: `Failed to ${operation}: ${error.message}`,
            }),
          )
        : Effect.fail(error),
    ),
  ) as Effect.Effect<A, SecretBackendUnavailable, never>

const nowDate = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis))

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
