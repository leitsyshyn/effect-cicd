import { Layer } from "effect"

import { type TestExecutorLayerOptions, Executor, LocalContainerExecutor } from "../engine/executor.ts"
import { Engine } from "../engine/interface.ts"
import { Orchestrator } from "../engine/orchestrator.ts"
import { Planner } from "../engine/planner.ts"
import { RunController } from "../engine/run-controller.ts"
import { RunUpdates } from "../engine/run-updates.ts"
import { ArtifactStore } from "../engine/stores/artifact-store.ts"
import { ArtifactGc } from "../engine/stores/artifact-gc.ts"
import { EventLog } from "../engine/stores/event-log.ts"
import { StateStore } from "../engine/stores/state-store.ts"
import { SecretEncryptionConfig, SecretStore } from "../secrets/store.ts"
import { ArtifactLifecycleConfig } from "./config.ts"
import { structuredLoggerLayer } from "./logger.ts"
import { Metrics } from "./metrics.ts"
import { ObjectStorageClient, StorageTransactor, sqlClientLayer, storageMigrationLayer } from "./storage.ts"
import { SchedulerConfig } from "./config.ts"

export const makeDurableStorageLayer = () => {
  const sqlLayer = sqlClientLayer
  const objectStorageLayer = ObjectStorageClient.layer

  return Layer.mergeAll(
    Metrics.layer,
    ArtifactLifecycleConfig.layer,
    storageMigrationLayer.pipe(Layer.provideMerge(sqlLayer)),
    StorageTransactor.postgresLayer.pipe(Layer.provideMerge(sqlLayer)),
    StateStore.postgresLayer.pipe(Layer.provideMerge(sqlLayer)),
    EventLog.postgresLayer.pipe(Layer.provideMerge(sqlLayer)),
    SecretStore.postgresLayer.pipe(
      Layer.provideMerge(sqlLayer),
      Layer.provideMerge(SecretEncryptionConfig.layer),
    ),
    ArtifactStore.s3Layer.pipe(
      Layer.provideMerge(sqlLayer),
      Layer.provideMerge(objectStorageLayer),
      Layer.provideMerge(ArtifactLifecycleConfig.layer),
    ),
  )
}

export const makeServiceEngineLayer = () => {
  const storageLayer = makeDurableStorageLayer()
  const updatesLayer = RunUpdates.layer
  const orchestratorLayer = Orchestrator.layer.pipe(
    Layer.provideMerge(storageLayer),
    Layer.provideMerge(LocalContainerExecutor.layer),
    Layer.provideMerge(updatesLayer),
  )
  const runControllerLayer = RunController.layer.pipe(
    Layer.provideMerge(orchestratorLayer),
    Layer.provideMerge(storageLayer),
    Layer.provideMerge(SchedulerConfig.layer),
  )

  return Layer.mergeAll(
    structuredLoggerLayer,
    storageLayer,
    updatesLayer,
    SchedulerConfig.layer,
    orchestratorLayer,
    runControllerLayer,
    ArtifactGc.layer.pipe(
      Layer.provideMerge(storageLayer),
    ),
    Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(orchestratorLayer),
      Layer.provideMerge(runControllerLayer),
      Layer.provideMerge(storageLayer),
      Layer.provideMerge(updatesLayer),
    ),
  )
}

export const makeInMemoryEngineLayer = (options: TestExecutorLayerOptions = {}) => {
  const updatesLayer = RunUpdates.noopLayer
  const transactorLayer = StorageTransactor.memoryLayer
  const stateLayer = StateStore.memoryLayer
  const eventLayer = EventLog.memoryLayer
  const artifactLayer = ArtifactStore.memoryLayer
  const secretLayer = SecretStore.memoryLayer
  const executorLayer = Executor.testLayer(options)
  const orchestratorLayer = Orchestrator.layer.pipe(
    Layer.provideMerge(transactorLayer),
    Layer.provideMerge(stateLayer),
    Layer.provideMerge(eventLayer),
    Layer.provideMerge(artifactLayer),
    Layer.provideMerge(secretLayer),
    Layer.provideMerge(executorLayer),
    Layer.provideMerge(updatesLayer),
  )
  const schedulerLayer = SchedulerConfig.layer
  const runControllerLayer = RunController.layer.pipe(
    Layer.provideMerge(orchestratorLayer),
    Layer.provideMerge(stateLayer),
    Layer.provideMerge(schedulerLayer),
  )

  return Layer.mergeAll(
    Metrics.layer,
    ArtifactLifecycleConfig.layer,
    transactorLayer,
    stateLayer,
    eventLayer,
    artifactLayer,
    secretLayer,
    executorLayer,
    updatesLayer,
    schedulerLayer,
    orchestratorLayer,
    runControllerLayer,
    ArtifactGc.layer.pipe(
      Layer.provideMerge(artifactLayer),
      Layer.provideMerge(eventLayer),
      Layer.provideMerge(ArtifactLifecycleConfig.layer),
    ),
    Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(orchestratorLayer),
      Layer.provideMerge(runControllerLayer),
      Layer.provideMerge(transactorLayer),
      Layer.provideMerge(stateLayer),
      Layer.provideMerge(eventLayer),
      Layer.provideMerge(artifactLayer),
      Layer.provideMerge(secretLayer),
      Layer.provideMerge(updatesLayer),
      Layer.provideMerge(schedulerLayer),
    ),
  )
}

export const makeInMemoryServiceEngineLayer = (options: TestExecutorLayerOptions = {}) => {
  const updatesLayer = RunUpdates.layer
  const transactorLayer = StorageTransactor.memoryLayer
  const stateLayer = StateStore.memoryLayer
  const eventLayer = EventLog.memoryLayer
  const artifactLayer = ArtifactStore.memoryLayer
  const secretLayer = SecretStore.memoryLayer
  const executorLayer = Executor.testLayer(options)
  const orchestratorLayer = Orchestrator.layer.pipe(
    Layer.provideMerge(transactorLayer),
    Layer.provideMerge(stateLayer),
    Layer.provideMerge(eventLayer),
    Layer.provideMerge(artifactLayer),
    Layer.provideMerge(secretLayer),
    Layer.provideMerge(executorLayer),
    Layer.provideMerge(updatesLayer),
  )
  const schedulerLayer = SchedulerConfig.layer
  const runControllerLayer = RunController.layer.pipe(
    Layer.provideMerge(orchestratorLayer),
    Layer.provideMerge(stateLayer),
    Layer.provideMerge(schedulerLayer),
  )

  return Layer.mergeAll(
    Metrics.layer,
    ArtifactLifecycleConfig.layer,
    transactorLayer,
    stateLayer,
    eventLayer,
    artifactLayer,
    secretLayer,
    executorLayer,
    updatesLayer,
    schedulerLayer,
    orchestratorLayer,
    runControllerLayer,
    ArtifactGc.layer.pipe(
      Layer.provideMerge(artifactLayer),
      Layer.provideMerge(eventLayer),
      Layer.provideMerge(ArtifactLifecycleConfig.layer),
    ),
    Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(orchestratorLayer),
      Layer.provideMerge(runControllerLayer),
      Layer.provideMerge(transactorLayer),
      Layer.provideMerge(stateLayer),
      Layer.provideMerge(eventLayer),
      Layer.provideMerge(artifactLayer),
      Layer.provideMerge(secretLayer),
      Layer.provideMerge(updatesLayer),
      Layer.provideMerge(schedulerLayer),
    ),
  )
}
