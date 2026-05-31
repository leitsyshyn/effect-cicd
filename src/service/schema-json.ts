import { Schema } from "effect"

export const encodeJson = <A, I, RD, RE>(schema: Schema.Codec<A, I, RD, RE>, value: A): I =>
  Schema.encodeSync(Schema.toCodecJson(schema) as any)(value) as I

export const decodeJson = <A, I, RD, RE>(schema: Schema.Codec<A, I, RD, RE>, value: unknown): A =>
  Schema.decodeUnknownSync(Schema.toCodecJson(schema) as any)(value) as A
