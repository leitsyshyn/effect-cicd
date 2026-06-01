import { Schema } from "effect"

export class SecretRef extends Schema.TaggedClass<SecretRef>()("SecretRef", {
  key: Schema.String,
}) {}

export class SecretSummary extends Schema.Class<SecretSummary>("SecretSummary")({
  projectId: Schema.String,
  key: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export const isSecretRef = (value: unknown): value is SecretRef =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "SecretRef" && "key" in value
