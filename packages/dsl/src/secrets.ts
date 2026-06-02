import { Schema } from "effect"

export class SecretRef extends Schema.TaggedClass<SecretRef>()("SecretRef", {
  key: Schema.String,
}) {}

export const isSecretRef = (value: unknown): value is SecretRef =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "SecretRef" && "key" in value
