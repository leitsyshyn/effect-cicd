import { Schema } from "effect"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"

const WorkflowRunStateJson = Schema.toCodecJson(WorkflowRunState)
const WorkflowEventJson = Schema.toCodecJson(WorkflowEvent)
const ArtifactMetadataJson = Schema.toCodecJson(ArtifactMetadata)
const LogMetadataJson = Schema.toCodecJson(LogMetadata)

export const encodeWorkflowRunState = Schema.encodeSync(WorkflowRunStateJson)
export const encodeWorkflowEvent = Schema.encodeSync(WorkflowEventJson)
export const encodeArtifactMetadata = Schema.encodeSync(ArtifactMetadataJson)
export const encodeLogMetadata = Schema.encodeSync(LogMetadataJson)

export const decodeWorkflowRunState = (value: unknown) => Schema.decodeUnknownSync(WorkflowRunStateJson)(normalizeJson(value))

export const decodeWorkflowEvent = (value: unknown) => Schema.decodeUnknownSync(WorkflowEventJson)(normalizeJson(value))

export const decodeArtifactMetadata = (value: unknown) =>
  Schema.decodeUnknownSync(ArtifactMetadataJson)(normalizeJson(value))

export const decodeLogMetadata = (value: unknown) => Schema.decodeUnknownSync(LogMetadataJson)(normalizeJson(value))

const normalizeJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value)
}
