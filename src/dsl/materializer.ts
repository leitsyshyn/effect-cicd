import { Effect } from "effect"
import * as Context from "effect/Context"

import { DslMaterializationFailed } from "../domain/errors.ts"
import { NormalizedWorkflowDefinition } from "../domain/workflow-definition.ts"

export class DslMaterializer extends Context.Service<
  DslMaterializer,
  {
    readonly materialize: (authored: unknown) => Effect.Effect<NormalizedWorkflowDefinition, DslMaterializationFailed>
  }
>()("@effect-cicd/dsl/DslMaterializer") {}
