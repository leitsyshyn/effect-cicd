import { Schema } from "effect"

import { ArtifactRef, AttemptId, LogRef, RunId, UnitId } from "./ids.ts"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const PayloadAvailabilityStatus = Schema.Literals(["expected", "available", "missing", "failed"])
export type PayloadAvailabilityStatus = typeof PayloadAvailabilityStatus.Type

export class ArtifactMetadata extends Schema.Class<ArtifactMetadata>("ArtifactMetadata")({
  artifactRef: ArtifactRef,
  runId: RunId,
  unitId: Schema.optional(UnitId),
  attemptId: Schema.optional(AttemptId),
  name: Schema.String,
  category: Schema.String,
  status: PayloadAvailabilityStatus,
  sizeBytes: Schema.optional(NonNegativeInt),
  checksum: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.Date),
  summary: Schema.optional(Schema.String),
}) {}

export class LogMetadata extends Schema.Class<LogMetadata>("LogMetadata")({
  logRef: LogRef,
  runId: RunId,
  unitId: Schema.optional(UnitId),
  attemptId: Schema.optional(AttemptId),
  name: Schema.String,
  status: PayloadAvailabilityStatus,
  sizeBytes: Schema.optional(NonNegativeInt),
  checksum: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.Date),
  summary: Schema.optional(Schema.String),
}) {}

export class RegisteredArtifact extends Schema.Class<RegisteredArtifact>("RegisteredArtifact")({
  metadata: ArtifactMetadata,
  payloadBase64: Schema.optional(Schema.String),
  contentType: Schema.optional(Schema.String),
}) {}

export class RegisteredLog extends Schema.Class<RegisteredLog>("RegisteredLog")({
  metadata: LogMetadata,
  content: Schema.String,
}) {}
