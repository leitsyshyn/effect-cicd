import { Schema } from "effect"

export const WorkflowId = Schema.String.pipe(Schema.brand("WorkflowId"))
export type WorkflowId = typeof WorkflowId.Type

export const UnitId = Schema.String.pipe(Schema.brand("UnitId"))
export type UnitId = typeof UnitId.Type

export const PlanId = Schema.String.pipe(Schema.brand("PlanId"))
export type PlanId = typeof PlanId.Type

export const RunId = Schema.String.pipe(Schema.brand("RunId"))
export type RunId = typeof RunId.Type

export const AttemptId = Schema.String.pipe(Schema.brand("AttemptId"))
export type AttemptId = typeof AttemptId.Type

export const EventId = Schema.String.pipe(Schema.brand("EventId"))
export type EventId = typeof EventId.Type

export const ArtifactRef = Schema.String.pipe(Schema.brand("ArtifactRef"))
export type ArtifactRef = typeof ArtifactRef.Type

export const LogRef = Schema.String.pipe(Schema.brand("LogRef"))
export type LogRef = typeof LogRef.Type
