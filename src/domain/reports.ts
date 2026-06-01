import { Schema } from "effect"

import { ArtifactMetadata, RegisteredArtifact } from "./artifacts.ts"
import { AttemptId, UnitId } from "./ids.ts"
import { DataValueFormat } from "./workflow-definition.ts"

export class ReportSummary extends Schema.Class<ReportSummary>("ReportSummary")({
  name: Schema.String,
  unitId: UnitId,
  attemptId: Schema.optional(AttemptId),
  format: DataValueFormat,
  contentType: Schema.optional(Schema.String),
  artifact: ArtifactMetadata,
}) {}

export class ProducedReport extends Schema.Class<ProducedReport>("ProducedReport")({
  name: Schema.String,
  unitId: UnitId,
  attemptId: AttemptId,
  format: DataValueFormat,
  contentType: Schema.optional(Schema.String),
  artifact: RegisteredArtifact,
}) {}
