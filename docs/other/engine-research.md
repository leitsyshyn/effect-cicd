# Core Engine Architecture Research

## Summary

Across GitHub Actions, GitLab CI/CD, Buildkite, and Dagger, the “core engine” consistently decomposes into two coupled subsystems: a **control-plane orchestrator** that turns authored intent into a runnable graph/queue, and a **data-plane executor** (runner/agent/worker substrate) that leases work, executes it in isolation, and streams back state for inspection. The details differ, but a small set of engine patterns recur.

One recurring pattern is **pull-based work acquisition with leases/heartbeats**. GitHub’s runner implementation is explicit that the runner dequeues one message at a time and “only executes one job” while “the server will not send another job while this one is still running” (runner-side invariant), and it renews a server-side lock while a job is executing. citeturn17view0turn15view0 Buildkite’s agent similarly authenticates, receives an internal session token, then polls for work; on job acceptance Buildkite generates a job-specific token. citeturn21view0 GitLab’s runner acquisition is also pull-oriented, and the platform’s long polling architecture uses Workhorse + Redis PubSub + a “last_update” token to reduce expensive polling against Rails while preserving near-real-time job pickup. citeturn18view0

A second recurring pattern is a **definition-to-execution boundary that is “graph→runtime” rather than “script→runtime”**. GitHub and GitLab both define workflows/pipelines declaratively (YAML) and express dependencies explicitly (GitHub `needs`; GitLab `needs`) to drive a job-ready DAG (or a staged DAG hybrid). citeturn14view1turn20view0turn19view2 Buildkite begins declaratively but supports **dynamic pipeline mutation** via `buildkite-agent pipeline upload`, which inserts new steps into a running build immediately after the upload step—turning “definition” into a progressively revealed plan. citeturn21view2turn21view4 Dagger is the most “engine-forward”: it treats each GraphQL field resolution as a build operation; object IDs represent state snapshots; and evaluation is lazy until leaf values are requested. citeturn4view0

A third recurring pattern is that **inspection is a projection** over persisted run state, but the projection substrate differs:

- GitHub’s run inspection is explicitly grounded in the Checks API: a workflow run maps to a check suite and jobs map to check runs; logs are step-structured and include platform-injected setup/teardown steps. citeturn14view2
- GitLab’s inspection is strongly log-centric and storage-path explicit: logs are patched while running, archived after completion, and optionally offloaded to object storage; artifacts have their own lifecycle and retention semantics. citeturn19view0turn19view1
- Buildkite exposes explicit build/job state machines and supports richer inspection augmentation via annotations, plus log access via APIs. citeturn21view3turn8search9
- Dagger’s inspection is best understood as “query-driven”: what you request determines what executes and what is materialized; even side-effectful operations can be elided unless forced. citeturn4view0

Including Temporal, Argo Workflows, and Tekton materially expands the architectural pattern space:

- Temporal demonstrates an **event-sourced, durable workflow engine** where the authoritative state is an append-only Event History plus mutable state derived from it; progress is driven by internal task queues and workers polling task queues. citeturn12view2turn12view1turn12view3
- Argo and Tekton exemplify **controller-style reconciliation** on Kubernetes CRDs, where orchestration is a loop over desired/observed state and execution happens via Pods; both also show how “inspection state” can be separated from “control-plane state” (notably Tekton Results). citeturn9view0turn11view2

The uploaded PRD/PVD/RFC frame why these patterns matter for your engine work: the documents emphasize engine-centric concerns like execution, state, and inspection (rather than product positioning), so the key takeaway is to treat “engine architecture” as choices about (a) the planning boundary, (b) work leasing + execution ownership, and (c) the inspection substrate and its consistency model. fileciteturn1file0turn1file1turn1file2

## Scope of Analysis

This document analyzes **core execution engine architecture**—domain models, internal layers, orchestration and execution semantics, state/persistence, inspection, scaling, and failure/recovery—for the specified systems. It avoids product positioning, pricing, and feature marketing, except where needed to explain engine coupling.

The PRD/PVD/current RFC draft are treated as **context for what questions matter** (execution semantics, durability, inspectability, local/remote parity, etc.) and not as inputs to redesign any already-decided product direction. fileciteturn1file0turn1file1turn1file2

## Systems Studied

GitHub Actions (direct CI/CD platform), GitLab CI/CD (direct CI/CD platform), Buildkite (direct CI/CD platform), and Dagger (hybrid: programmable workflow/execution engine used inside CI and locally) were analyzed as required.

Temporal (architectural reference: durable workflow engine), Argo Workflows (architectural reference: Kubernetes controller/workflow engine), and Tekton (architectural reference: Kubernetes-native CI/workflow via CRDs, plus separate results subsystem) were included because they add distinct, engine-relevant execution/state patterns that materially sharpen the design space around orchestration style and persistence/inspection substrates. citeturn12view0turn9view0turn11view0turn11view2

## Engine Profiles

### GitHub Actions

#### Core domain model

Documented user-facing entities are: **workflow (YAML)** → **workflow run** → **job(s)** → **step(s)**, where jobs run on **runners** and an **action** is “run as a step” within a job. citeturn14view1turn14view0turn14view2  
For inspection and status projection, a workflow run maps to a **check suite**, and each job maps to a **check run**; step logs appear within the job log view. citeturn14view2

At the runner-runtime level (engine-internal), the open-source runner implements a split between a long-lived listener/dispatcher and a worker process; the code references **Runner.Listener**, a message listener that “listens to the queue,” and a **JobDispatcher** that launches **Runner.Worker** for execution. citeturn15view0turn17view0

#### Definition-to-execution boundary

A workflow is defined in YAML and consists of one or more jobs; jobs run in parallel by default and can be sequenced via `needs`. citeturn14view1  
From there, the boundary that matters most for engine architecture is **“job dispatch payload creation → runner lease acquisition → job execution”**. In the ARC autoscaling architecture (GitHub documentation), a listener establishes an HTTPS long poll to receive `Job Available` messages; ephemeral runners register with a JIT token and then long poll again to receive job details. citeturn13view0

**Inference (based on runner + ARC behavior):** the control plane must perform a planning stage that converts the YAML-defined job graph + constraints (`runs-on`, labels, `needs`, etc.) into (a) queued job run records and (b) dispatchable job payloads, because runners do not interpret YAML; they receive job/run details from the service and execute them. citeturn13view0turn17view0

#### Engine layering

A minimally faithful layering (documented + strongly evidenced by open-source runner code) is:

- **Control plane (GitHub Actions Service)**: creates workflow runs/jobs; dispatches jobs to matching runners/scale sets; provides status/log ingestion endpoints and the Checks-backed inspection projection. citeturn13view0turn14view2
- **Runner acquisition & session layer**: long polling, session creation, and job request leasing. citeturn13view0turn15view0turn17view0
- **Runner execution layer**: JobDispatcher → Worker process, step execution, log upload, cancellation/abandon handling. citeturn17view0turn14view2

#### Orchestration model

The runner’s internal dispatcher explicitly assumes a **dequeue-and-process** model and states the design invariant that the runner processes one message at a time and that “the server will not send another job while this one is still running.” citeturn17view0

The runner also implements **job request leasing**: it renews the job request lock periodically (e.g., “renew again after 60 sec delay”), and handles the case where the server indicates the job request no longer exists by canceling the worker and preventing orphan execution. citeturn17view0

At the platform edge (ARC doc), orchestration includes a `Job Available` message and long-poll-based dispatch, with an explicit 24-hour unassignment if no runner accepts the job. citeturn13view0

#### Execution model

A runner runs a single job at a time, and GitHub-hosted executions run in fresh, newly provisioned VMs (as the default hosted-runner isolation model). citeturn14view0  
Within a job, the log view shows steps, and GitHub injects “Set up job” and “Complete job” steps, which indicates platform-controlled pre/post execution around user steps. citeturn14view2

#### State model and persistence

For user-visible state, GitHub’s documentation is explicit that workflow statuses/results/logs are output using the Checks API, with a check suite per workflow run and check run per job. citeturn14view2

For execution-ownership state, the runner maintains and renews a server-side job request lock; the runner treats the server as authoritative and will cancel local execution when the server indicates the job request is finished or missing. citeturn17view0

**Inference:** the authoritative source of truth for job state is the control plane’s execution record (reflected through Checks and UI), with runner-local state acting as a transient executor state machine driven by server messages and lock renewal. This inference is grounded in the runner behavior that queries job request status from the server and cancels “zombie” workers when the server indicates completion. citeturn17view0turn14view2

#### Inspection model

Inspection is **log-centric with graph navigation**: users inspect per-job logs, step logs, durations, and can search/download log archives; line-level permalinks exist for collaboration. citeturn14view2  
The graph-centric view (jobs visualization) is tied to the job structure declared in the workflow run and projected into the Checks-backed UI. citeturn14view2turn14view1

#### Scaling model

Scaling is primarily achieved by adding more runners (self-hosted fleets, hosted pools, ephemeral Kubernetes pods). ARC’s documented architecture shows an autoscaling control loop: a listener receives `Job Available`, acknowledges, patches desired replicas, and runners register JIT and long poll for job details. citeturn13view0

At worker scale, the runner supports single-use / ephemeral patterns (e.g., warning about `--once` deprecation in favor of `--ephemeral`), and the runtime includes warmup paths to optimize startup for ephemeral runners. citeturn15view0

#### Failure and recovery model

Documented: reruns produce partial log archives; a downloaded log archive for a partially re-run workflow includes only re-run jobs, requiring combining archives across attempts for full reconstruction. citeturn14view2

Runner-internal durability mechanisms include lock renewal and explicit cancellation paths: if local worker cancellation times out, the runner kills the worker process and attempts to upload unfinished logs. citeturn17view0  
ARC documents a 24-hour “unassign if no runner accepts” behavior, which is a control-plane recovery bound for stuck queue entries. citeturn13view0

#### Architectural strengths

The runner’s explicit **lease renewal + server-authoritative cancellation** is a strong execution-ownership pattern that prevents indefinite split-brain (“server thinks job is dead, runner keeps running”) from persisting silently. citeturn17view0  
The Checks-backed projection yields a uniform inspection UI that maps cleanly to jobs and steps. citeturn14view2  
Pull-based acquisition plus long polling reduces the need for inbound connectivity to runners while maintaining responsiveness. citeturn13view0

#### Architectural limitations

The control plane is largely opaque publicly, so deep engine layering inside the service (planning, scheduling, persistence schemas) cannot be confirmed from primary sources; only the runner side and some dispatch semantics are directly inspectable. citeturn13view0turn17view0  
The “one job per runner” invariant simplifies runner correctness but shifts parallelism to horizontal runner scaling; this can amplify scheduling sensitivity (label matching, readiness, fleet management). citeturn14view0turn17view0

#### Architectural lessons

- For pull-based executors, **make leasing explicit** (lock token + renewal cadence + definitive server authority) to control split-brain and orphan execution. citeturn17view0
- Separate **inspection projection** (Checks/check runs) from **execution transport** (runner brokers/messages), enabling multiple UI/inspection models without coupling them to executor protocol. citeturn14view2turn13view0
- Injected “setup/teardown steps” suggest a useful frame: treat the engine as owning a _job envelope_ that surrounds user steps, which can standardize environment prep, artifact plumbing, and cleanup. citeturn14view2

### GitLab CI/CD

#### Core domain model

GitLab defines **pipelines** configured by `.gitlab-ci.yml`, composed of **jobs** and (optionally) **stages**; jobs “run independently” and are executed by **runners**. citeturn19view2  
Stages impose a default sequence (stages in order; jobs within a stage in parallel), while `needs` creates explicit job dependencies that form a DAG and can bypass stage barriers. citeturn19view2turn20view0

At the job-pickup layer, the relevant engine entities include: GitLab Runner worker goroutines, Workhorse “key watcher” state, Redis PubSub channels keyed by runner last-update tokens, and Sidekiq background workers that update runner keys when new runnable jobs exist. citeturn18view0

#### Definition-to-execution boundary

The boundary begins with `.gitlab-ci.yml` evaluation (including global keywords like `include`, `default`, `workflow`, etc.), which defines the runnable job graph. citeturn19view3  
Execution ordering is then established either by stages (implicit dependencies) or by `needs` (explicit DAG dependencies). citeturn19view2turn20view0

Job dispatch is crossed when **runners request jobs** from `/api/v4/jobs/request`. With long polling enabled, Workhorse holds requests until runner keys change, then forwards to Rails for assignment. citeturn18view0

#### Engine layering

GitLab offers unusually explicit public detail about the dispatch path:

- **Workhorse (front proxy)**: terminates the job request endpoint first; watches Redis PubSub keyed by runner state; holds long polls up to `apiCiLongPollingDuration`. citeturn18view0
- **Rails app**: checks job queue and assigns jobs; returns “204 No job” with `X-GitLab-Last-Update` token or “201 Job was scheduled.” citeturn18view0
- **Sidekiq**: updates `last_update` values for relevant runners when new pipeline jobs are created, which releases long-poll-held requests. citeturn18view0
- **Runner**: runs concurrent job-request goroutines and executes jobs once assigned. citeturn18view0turn2search2

This is a concrete example of a **control-plane scheduler** (Rails/Sidekiq) plus a **dispatch shim** (Workhorse + Redis) plus **pull executors** (runners). citeturn18view0

#### Orchestration model

The orchestration model is **queue-driven with pull executors**, but optimized via distributed notification:

- Runner requests `/api/v4/jobs/request`.
- Workhorse consults runner key state and may hold the request.
- Sidekiq updates runner keys when jobs become runnable (a “tick”).
- Workhorse releases the request and Rails assigns a job. citeturn18view0

In GitLab’s model, `needs` produces a DAG where jobs become runnable as dependencies complete, allowing “stageless” (or hybrid) execution. citeturn20view0turn20view1

#### Execution model

GitLab Runner executes pipeline jobs on compute infrastructure; a key engine-relevant detail is how it streams logs during execution. Job logs are sent “by a runner while it’s processing a job.” citeturn19view0

Long polling changes runner behavior: the runner launches a number of goroutines equal to `concurrent`, waits for those goroutines to return after long polling, then runs another batch. Misconfiguration (too-low `concurrent` relative to runner entries) can delay job pickup, illustrating a subtle executor-side throughput coupling to dispatch mechanics. citeturn18view0

#### State model and persistence

GitLab’s job-log storage architecture is unusually explicit:

- While a job is running, logs are “patching” and flow Runner → Puma → file storage at a deterministic path.
- After completion, Sidekiq archives logs into the artifacts folder.
- If configured, Sidekiq uploads archived logs to object storage. citeturn19view0

Artifacts are persisted separately with expiry/retention semantics (`expire_in`, “kept for the most recent successful pipeline on each ref,” and controlled download via `dependencies` / `needs:artifacts`). citeturn19view1

#### Inspection model

Inspection is primarily **log-centric and artifact-centric**, surfaced in job pages and pipeline views, with log lifecycle states (“log” vs “archived log”) that map to storage location and retention. citeturn19view0  
Pipeline-level inspection also relies on the pipeline’s job/stage/DAG structure, which GitLab documents via pipelines/stages/jobs and `needs`. citeturn19view2turn20view0

#### Scaling model

GitLab’s long polling architecture directly targets scaling by reducing Rails load and queueing latency: Workhorse holds requests until there is work, so job requests reach Rails “only when there is new work,” reducing server overhead. citeturn18view0  
Scaling also relies on runner fleet sizing and proper `concurrent` configuration to avoid head-of-line blocking in long polls. citeturn18view0

#### Failure and recovery model

By default, a failed job in a stage prevents later stages from executing (“the next stage is not (usually) executed”), which is a simple but strong failure propagation rule at the pipeline orchestration layer. citeturn19view2  
GitLab supports retry semantics via YAML configuration (example: default `retry: 2` applied through the YAML `default` section), indicating that “retry” is part of the job execution policy model rather than an external mechanism. citeturn19view3turn7search4

Log durability and archiving are handled by background processing; operationally, this implies recovery concerns around Sidekiq/object storage consistency, since archived logs and artifacts become data sources for other features. citeturn19view1turn19view0

#### Architectural strengths

GitLab exposes a clear, decomposed dispatch architecture (Workhorse + Redis PubSub + Rails + Sidekiq) that is legible as a set of engine components with explicit roles. citeturn18view0  
The pipeline model supports both staged and DAG execution within one conceptual frame (`needs`), enabling early-start jobs and more efficient critical-path scheduling. citeturn20view0turn20view1  
The job-log lifecycle is first-class and operationally explicit, which is valuable for deterministic inspection and retention engineering. citeturn19view0

#### Architectural limitations

The long polling optimization introduces subtle coupling between runner concurrency configuration and job pickup latency (goroutine batching), creating a class of scaling/fairness issues that are not purely control-plane problems. citeturn18view0  
Because dispatch ultimately results in Rails assignment work, it still depends on backend job-queue selection logic (not detailed in sources here), which can become a bottleneck at high scale without careful indexing/partitioning. citeturn18view0

#### Architectural lessons

- If using pull-based executors, treat “reduce scheduler load” as an engine concern: GitLab’s Workhorse + Redis PubSub long polling is a concrete design for **notification-driven pull** that preserves security properties of pull without constant polling. citeturn18view0
- Make inspection storage lifecycles explicit (hot log → archived log → object storage). This supports predictable retention behavior and reduces ambiguity about “where truth lives” for inspection. citeturn19view0
- Support DAG + stage hybridization when possible: it allows incremental adoption and keeps the mental model extensible. citeturn20view0

### Buildkite

#### Core domain model

Buildkite’s domain model is explicitly documented as: **pipeline** → **build** (a pipeline run) → **steps** → **jobs**, where “each of the steps in the pipeline ends up as a job in the build,” which is then “distributed to available agents.” citeturn21view3  
Agents are organized operationally into **clusters** and **queues**, where a queue defines and manages agents within a cluster and is used for workload routing (architecture/OS/size, etc.). citeturn21view5

Buildkite also exposes explicit state machines: build states and job states (including intermediate states like `blocked`, `waiting`, etc.) and notes differences between internal states and API projections. citeturn21view3

#### Definition-to-execution boundary

The default boundary is declarative `pipeline.yml` defining steps and dependency structure. Dependencies can be implicit (via `wait`/`block`) or explicit (`depends_on`); the scheduler uses these dependencies to decide what runs in serial vs parallel. citeturn22view2

Buildkite also supports **dynamic pipelines**, shifting the boundary from “static plan at build creation” to “plan is extended during execution.” A pipeline upload step can execute a script and pipe output to `buildkite-agent pipeline upload`, which inserts steps into the build immediately after the upload step. citeturn21view2turn21view4

This means Buildkite can implement a two-phase (or multi-phase) plan:

1. initial graph sufficient to start execution, then
2. runtime expansion as context becomes available (branch, metadata, discovered test suites, etc.). citeturn21view2turn21view4

#### Engine layering

The engine can be reasoned as:

- **Control plane**: stores pipelines/builds/jobs, schedules jobs, enforces dependency and concurrency semantics, and provides inspection surfaces (UI, APIs). (This is implied by documented job/build state machines, dispatch rules, and API-driven inspection surfaces.) citeturn21view3turn22view1
- **Agent API + auth**: handles agent registration and token exchange; produces session and job tokens. citeturn21view0
- **Agents (executors)**: poll for jobs, run jobs, stream status/logs, upload artifacts. citeturn8search8turn0search3
- **Routing primitives**: clusters/queues/tags that constrain which agents can execute which jobs. citeturn21view5turn3search7

#### Orchestration model

Orchestration combines:

- **Dependency scheduling** (wait/block/depends_on) determining readiness. citeturn22view2
- **Queue dispatch** with explicit precedence rules:
  1. job priority (descending),
  2. `scheduled_at` time (ascending),
  3. upload order in pipeline. citeturn22view1
- **Agent selection**: dispatch favors higher-priority agents; among equal priority agents it prefers those with recent successful completions; then targeting constraints apply. citeturn22view0
- **Global concurrency control**: concurrency groups behave like a queue/lock across pipelines and only consider jobs in active states; jobs in `limited` wait for the group lock. citeturn22view3

This is a clear example of a scheduler as a **state machine + priority queue + constraint matcher**, rather than purely a DAG traversal.

#### Execution model

Agent execution is pull-based: an agent registers using an agent token, receives a session token, uses it to poll for jobs, and upon accepting a job receives a job token specific to that job. citeturn21view0  
Agents run the job commands defined in steps and upload artifacts; Buildkite documents this as the agent’s central responsibility. citeturn8search8turn0search7

#### State model and persistence

Buildkite’s job/build state machines are first-class and include timestamps (`created_at` → `scheduled_at` → `started_at` → `finished_at`) and explicit terminal states. citeturn21view3  
The orchestration layer distinguishes internal job lifecycle states (e.g., internal terminal `finished`) from API representations (REST flattens to `passed`/`failed`; GraphQL preserves `finished`). citeturn21view3

Concurrency groups maintain their own queue/lock semantics based on active job states, which is an additional piece of engine state separate from the raw DAG. citeturn22view3

#### Inspection model

Inspection is **state-machine-centric + log/augmentation-centric**:

- Build/job states provide a high-signal overview. citeturn21view3
- Annotations can be created from within jobs via `buildkite-agent annotate`, supporting job-scoped and build-scoped inspection augmentation. citeturn8search9turn8search2
- Logs are part of the core job lifecycle and are accessible via APIs (documented via agent responsibilities and job/build APIs). citeturn0search3turn7search2

#### Scaling model

Buildkite’s pull-based agent targeting model is explicitly contrasted as enabling better security (no inbound connections), easier scaling via ephemeral agents, and resilient networking. citeturn2search12  
Autoscaling patterns often operate by polling platform metrics (scheduled jobs, busy agents) and resizing compute pools, as shown in Buildkite’s Elastic CI Stack architecture (Lambda polls Buildkite API and scales ASG). citeturn2search20

#### Failure and recovery model

Buildkite documents “scheduled job expiration”: jobs not picked up expire (are canceled) after 30 days by default, failing the build; expiration is processed periodically (hourly). citeturn22view4  
The job/build state machine includes explicit canceling/canceled states, which are used for durable UI reporting. citeturn21view3  
A notable failure semantic: when a triggered build fails, the step that triggered it may remain stuck in `running` forever (documented edge case), indicating a potential mismatch between step state and downstream build completion. citeturn21view3

#### Architectural strengths

- **Dynamic pipelines** provide a strong mechanism for late binding: the execution plan can depend on runtime discovery. citeturn21view2turn21view4
- The scheduling model is explicit and composable: dependencies, priorities, constrained routing (queues), and global concurrency locks are all first-class primitives. citeturn22view2turn22view1turn22view3turn21view5
- Clear token exchange and pull-based polling provides a strong security posture with simple executor networking. citeturn21view0turn2search12

#### Architectural limitations

Dynamic pipelines create a **moving definition boundary**, which complicates reproducibility and static analysis: job ordering nuances (e.g., reverse ordering of multiple uploads unless dependencies are used) are documented gotchas, and are symptoms of runtime mutation complexity. citeturn21view2  
The engine includes multiple ordering/precedence dimensions (priority, scheduled time, upload order, concurrency-group locks), which can make scheduling outcomes non-obvious without strong introspection tooling. citeturn22view1turn22view3

#### Architectural lessons

- Treat “runtime plan mutation” as an explicit engine mode with its own invariants, rather than an ad-hoc extension; Buildkite documents concrete user-facing consequences when plan mutation is not modeled carefully. citeturn21view2turn22view1
- Global concurrency locks (concurrency groups) are effectively **named distributed semaphores** with queue semantics; if adopted, they need explicit state modeling and inspection surfaces. citeturn22view3
- Expose scheduling precedence rules as part of the engine contract; Buildkite’s documented dispatch order is a good example of making scheduler behavior legible. citeturn22view1

### Dagger

#### Core domain model

Dagger’s core runtime model is GraphQL-native:

- A GraphQL query represents a workflow; each field resolution corresponds to a build operation. citeturn4view0
- Objects (e.g., `Container`, `Directory`) represent collections of state, and their `id` fields represent the object’s state at the time of field resolution; IDs can be reused across queries to resume from a prior state snapshot. citeturn4view0

Operator documentation defines higher-level engine entities:

- **Session** (GraphQL API server + local directory sync + local socket forwarding + secrets management + source version resolution freezing), and
- **Runner** (backend that executes containers, pulls/pushes sources, manages cache). citeturn5view0

#### Definition-to-execution boundary

Dagger’s boundary is distinct from CI YAML engines: authored workflows are generally _code_ (SDK calls), which become GraphQL queries against a session. citeturn5view0turn4view0  
The system leverages GraphQL laziness: resolution is triggered only when leaf scalar values are requested; unused objects/operations may be skipped. The `sync` field can force execution to avoid surprising elision of side effects. citeturn4view0

Dagger also supports dynamic API extension via modules: a session starts with core API, then loading modules extends the GraphQL schema; modules execute inside containers and can act as clients back into the same session. citeturn4view0

#### Engine layering

From the operator manual, the engine separates into:

- **Client tool / SDK** (often downloads and runs the CLI)
- **Session** (served by CLI subcommands like `dagger run` / `dagger session`, provides GraphQL server + local sync + secrets + version pinning)
- **Runner** (containerized backend, BuildKit-like execution + cache + source IO) citeturn5view0

Additionally, Dagger maintainers describe the engine as an **API router + runner**, where the runner “is basically a buildkit daemon + some glue” and the router dispatches operations to the runner; router placement differs by architecture variant. citeturn23view0

#### Orchestration model

Orchestration is **DAG-driven**: the docs state the core API turns each request into a DAG of low-level operations and uses caching and optimizations to compute results efficiently. citeturn4view0  
Execution is also **demand-driven** (lazy): operations not necessary to compute requested outputs may not execute. citeturn4view0

Given the runner is BuildKit-like (per maintainer description), the underlying scheduling/caching behavior is consistent with content-addressed DAG solving. citeturn23view0turn4view0

#### Execution model

A runner executes “exec containers,” pulls images and git repos, pushes images, and maintains a cache; it is distributed as a container image and typically runs persistently. citeturn5view0  
A session is expected to run on the same host as the SDK client (for local directories/sockets), and source resolution (e.g., mapping `image:latest` to a digest) is frozen per session after first use. citeturn5view0

#### State model and persistence

Dagger uses GraphQL object IDs as portable state snapshots; IDs can be saved and used as inputs to later queries, allowing continuation from a prior filesystem/execution-plan state. citeturn4view0  
The session also persists _resolution decisions_ (unpinned sources → pinned versions) for the duration of the session, enforcing consistency within a run. citeturn5view0  
The runner’s cache is an explicit part of the runtime architecture. citeturn5view0

For errors, the engine defines structured execution errors that can be serialized/deserialized through GraphQL (e.g., `ExecError` for `withExec`). citeturn23view1

#### Inspection model

Inspection is fundamentally **query-shaped**:

- What you request determines what must execute (and thus what is observable). citeturn4view0
- Because DAG construction and caching are core, inspection can be understood as observing which DAG nodes were evaluated to satisfy a query result, although the primary sources here describe this conceptually rather than as a UI subsystem. citeturn4view0turn5view0

#### Scaling model

Dagger separates scaling of execution backend (runner) from session lifecycle: runner can be persistent, sessions are ephemeral. citeturn5view0  
Maintainer discussion indicates an architectural direction toward co-locating router and runner server-side for remote/multi-tenant usage, but this is explicitly framed as future architecture. citeturn23view0

#### Failure and recovery model

Because the model is DAG + cache-driven, rerunning a query after a failure can reuse cached operations if inputs are unchanged (engine behavior implied by caching-first design). citeturn4view0turn5view0  
However, unlike Temporal-style systems, Dagger does not present itself (in the primary sources here) as a durable workflow history engine; its recovery relies on recomputation + caching rather than persisted workflow event histories.

#### Architectural strengths

- The definition-to-execution mapping is unusually explicit and mechanically constrained: GraphQL fields → operations; IDs → state snapshots; laziness → automatic pruning. citeturn4view0
- The Session/Runner split cleanly isolates local-resource concerns (dirs/sockets/secrets/version pinning) from execution/caching concerns. citeturn5view0
- Dynamic API extension via modules makes the execution engine an extensible runtime rather than a fixed DSL interpreter. citeturn4view0

#### Architectural limitations

Lazy evaluation can elide side-effectful operations unless explicitly forced, which is a non-trivial semantic footgun for workflow authors and has direct implications for any engine that wants to support “imperative-looking” code with “declarative/lazy” execution. citeturn4view0  
Session locality assumptions (“same host as SDK client”) constrain distributed execution modes unless additional transport/sync layers are introduced. citeturn5view0

#### Architectural lessons

- Treat “workflow definition” as a _plan builder_ rather than a script: Dagger’s GraphQL ID/state model operationalizes this and makes reuse/continuation explicit. citeturn4view0
- If adopting laziness, the engine must expose explicit “force” semantics (like `sync`) and clear inspection to avoid hidden non-execution. citeturn4view0
- Separate “local context capture” (dirs, sockets, secret scope, source pinning) from execution: this boundary is highly relevant for any engine that targets local + CI parity. citeturn5view0turn1file1turn1file0

### Temporal

#### Core domain model

Temporal’s domain model centers on **Workflow Executions**, **Events / Event History**, and **Tasks** dispatched via task queues to workers.

- The Temporal Server is decomposed into four independently scalable services: Frontend, History, Matching, Worker Service. citeturn12view0
- History maintains “mutable state, queues, and timers,” while Matching hosts task queues for dispatching. citeturn12view0
- Workers poll task queues; there are Workflow Tasks and Activity Tasks, each with distinct semantics. citeturn12view1
- The Event History is an append-only log persisted for the lifecycle of the workflow execution and serves as an audit/debug substrate; limits and termination conditions are explicitly documented. citeturn12view2

#### Definition-to-execution boundary

Temporal’s key boundary is **deterministic progression via tasks**:

- A Workflow Task resumes user workflow code until it blocks or completes; on completion, the worker returns **commands** (schedule activity, start timer, etc.) to advance execution. citeturn12view1turn12view3
- The History service appends events implied by requests and enqueues transfer/timer tasks to drive progress (internal task queues), which then produce user-visible tasks in Matching. citeturn12view3turn12view0

#### Engine layering

Temporal’s layering is explicitly service-oriented:

- Frontend gateway for routing/auth/rate limiting
- History for workflow execution state + internal queues/timers
- Matching for task queue dispatch
- Worker service for internal background workflows  
  with persistence and (optionally) visibility stores. citeturn12view0

#### Orchestration model

Orchestration is **event-sourced and task-queue-driven**:

- Events are created in response to external requests and workflow-generated commands.
- Tasks are added to task queues; workers poll and report results/failures.
- History service ensures consistency of events, mutable state, and task generation. citeturn12view2turn12view1turn12view3

#### Execution model

Workers are the execution substrate; they poll for tasks and execute workflow tasks (deterministic advancement) and activity tasks (external side effects). citeturn12view1turn12view2

#### State model and persistence

The authoritative engine state is the **Event History** plus server-maintained mutable state derived from it:

- Event History is append-only and durably persisted; it is sufficient (as a sequence) to recover other state like mutable state and task state for a workflow execution. citeturn12view2turn12view3

#### Inspection model

Inspection is **history-centric and audit-centric**:

- Event History is explicitly described as an audit log for debugging, with documented event types and lifecycle limits. citeturn12view2turn12view3  
  Queries are implemented via “Query Tasks,” which do not advance workflow state, indicating inspection is integrated into the task model rather than a separate side channel. citeturn12view1

#### Scaling model

Temporal scales by independently scaling services; Frontend is stateless; History/Matching/Worker scale horizontally; membership uses a protocol (Ringpop) for discovery and routing. citeturn12view0  
History service uses sharding to support many concurrent workflow executions. citeturn12view0turn12view3

#### Failure and recovery model

Temporal’s failure model is explicitly evented:

- Activity retries and timeouts result in specific events (`ActivityTaskScheduled`, terminal events, timeout events, cancel request/canceled events), and retry policies cap attempts. citeturn12view2  
  Resets are modeled as creating a new workflow execution by copying event history up to a reset point, then continuing from there. citeturn12view2

#### Architectural strengths

Event history as the durable substrate provides a powerful, uniform base for correctness, recovery, and inspection. citeturn12view2turn12view3  
The explicit split between orchestration (History/Matching) and execution (workers) allows horizontal scaling and clear ownership boundaries. citeturn12view0turn12view1

#### Architectural limitations

Event history limits are an explicit scaling constraint; long-running/high-churn workflows must use patterns like Continue-As-New to avoid termination. citeturn12view2  
The model assumes deterministic workflow progression and careful separation of workflow logic (deterministic) from activities (side effects), which may not match CI engines that treat each step as inherently side-effectful. citeturn12view1turn12view2

#### Architectural lessons

- If you need durable recovery/resume, treat “workflow state” as a first-class persisted log rather than just “latest status.” citeturn12view3turn12view2
- Integrate inspection and control into the same state model (queries as tasks, resets as history manipulation) rather than bolting on observability after the fact. citeturn12view1turn12view2

### Argo Workflows

#### Core domain model

Argo models workflows as Kubernetes-native objects:

- There are two primary deployments: Workflow Controller (reconciling) and Argo Server (API). citeturn9view0
- Each step and each DAG task causes a Pod to be generated. Each pod comprises three containers: a main container (user image, with `argoexec` as the main command), an init container (fetch artifacts/parameters), and a wait container (cleanup, save parameters/artifacts). citeturn9view0  
  Executors run in the pods as init+sidecar and provide log monitoring and artifact management; as of 3.4, the only executor type is `emissary`. citeturn10view0

#### Definition-to-execution boundary

The authored definition is a Workflow CRD spec; execution begins when the controller reconciles it into pods and updates workflow status. The architecture doc makes the reconciliation loop explicit and points directly to controller code entrypoints. citeturn9view0

#### Engine layering

Engine layers are:

- Controller reconciliation loop (workflow queue + workers)
- Kubernetes API (as the persistence substrate for desired/observed state)
- Pod execution substrate (main/init/wait + executor tooling)
- Argo Server/UI as inspection+API layer citeturn9view0turn10view0

#### Orchestration model

Argo is controller-style: workflows and workflow pods are watched by informers; updates enqueue work; worker goroutines process workflows from a queue. The doc notes the controller “only ever processes a single Workflow at a time” (per controller instance), implying orchestration is serialized per-workflow to simplify state transitions. citeturn9view0

#### Execution model

Execution is Kubernetes-native: the controller creates pods; the executor runs in pods as init+sidecar to manage logs, artifacts, and lifecycle. citeturn9view0turn10view0

#### State model and persistence

The authoritative state is Kubernetes CRD state (Workflow objects) plus pod state; the executor and controller coordinate artifacts/parameters via init/wait behavior described in the architecture doc. citeturn9view0turn10view0

#### Inspection model

Inspection is a blend of:

- controller-visible workflow/pod state, and
- log/artifact management facilitated by executor containers. citeturn10view0turn9view0

#### Scaling model

Scaling is constrained/defined by the reconciliation model and Kubernetes execution substrate. The doc’s emphasis on queue/worker goroutines and “single workflow at a time” suggests the primary scaling unit is the number of workflows handled concurrently across controller capacity and Kubernetes cluster resources. citeturn9view0

#### Failure and recovery model

Argo’s executor design explicitly handles cleanup and artifact/parameter capture in the wait container, which is an engine-level durability behavior (ensuring outputs are materialized even when the main container finishes). citeturn9view0turn10view0

#### Architectural strengths

- Very clear controller/executor split; engine logic is explicit and tied to Kubernetes primitives. citeturn9view0turn10view0
- Strong artifact/log lifecycle integration via executor containers. citeturn10view0

#### Architectural limitations

- Strong coupling to Kubernetes CRDs, pod lifecycle, and cluster control plane behavior; portability outside Kubernetes is non-trivial. citeturn9view0turn10view0
- Controller-style reconciliation implies eventual consistency; orchestration correctness depends on reconciliation invariants rather than a single transactional scheduler step. citeturn9view0

#### Architectural lessons

- Reconciliation loops provide a powerful orchestration model when you can express runtime state as desired/observed resources; but they require careful modeling of state transitions and idempotency. citeturn9view0
- Embedding executor functionality into pods (init/sidecar/wait) is an effective way to make artifacts/logs first-class without requiring the user’s container to implement engine protocols. citeturn10view0turn9view0

### Tekton

#### Core domain model

Tekton’s runtime entities are CRD-centric:

- `Pipeline` declares a graph of tasks.
- `PipelineRun` is a single execution of a Pipeline; creating a PipelineRun creates TaskRuns for tasks. citeturn11view0
- `Task` is a set of sequential steps; `TaskRun` executes a Task. citeturn11view0

For inspection/storage beyond Kubernetes etcd, Tekton Results introduces `Result`/`Record` and a separate results database with an API server and watcher. citeturn11view2

#### Definition-to-execution boundary

The boundary is: author CRD specs → create PipelineRun/TaskRun objects → controllers reconcile and create pods/steps. PipelineRun is explicitly the mechanism by which the task graph is executed. citeturn11view0

#### Engine layering

Core layers include:

- Kubernetes API / etcd persistence of CRDs (`PipelineRun`, `TaskRun`)
- Tekton controllers (Pipeline/TaskRun reconciliation; cancellation/timeouts)
- Pod execution substrate (steps run in containers)
- Optional Results subsystem for long-term data storage and log retention decoupled from etcd. citeturn11view0turn11view2

#### Orchestration model

Controller-style reconciliation: controllers attempt to create TaskRun/CustomRun and requeue PipelineRun on transient creation errors with backoff. citeturn1search7  
The PipelineRun’s task graph drives which TaskRuns are instantiated (and, by implication, which pods are created). citeturn11view0

#### Execution model

A key execution detail is how results are extracted:

- By default, Tekton uses termination messages (size-limited) for results.
- An optional mode injects a sidecar container that monitors result files and emits them via logs; the controller reads the sidecar logs. citeturn11view1

#### State model and persistence

Core state is CRD status stored in etcd; Tekton Results explicitly aims to “separate out long term result storage away from the Pipeline controller,” enabling cleanup of completed Run CRDs to save etcd resources while preserving history/logs. citeturn11view2

Tekton Results defines a flow: watcher listens for TaskRun/PipelineRun changes, updates results DB, annotates original CRDs with identifiers, and then CRDs can be removed after being stored. citeturn11view2

#### Inspection model

Inspection can be:

- CRD-centric (PipelineRun/TaskRun objects, pod logs), and
- Results-centric (queryable API server with stored Records/Results, plus stored logs enabling post-cleanup inspection). citeturn11view2turn11view1

#### Scaling model

The Results subsystem is an explicit scaling pattern: decouple long-term inspection/history from execution-time control plane (etcd), freeing resources for scheduling/execution. citeturn11view2

#### Failure and recovery model

Pipeline controllers requeue on creation errors (with backoff tuning), reflecting a reconciliation-based recovery approach rather than lease renewal. citeturn1search7  
Result size limits and CRD size limits can fail TaskRuns; the sidecar-logs mode exists partly to shift away from termination-message limits, but also acknowledges etcd/CRD size constraints. citeturn11view1

#### Architectural strengths

- Clean separation between execution (CRDs/controllers/pods) and long-term inspection/history (Results API + DB + retention agent). citeturn11view2
- Controller-injected sidecars provide a consistent mechanism for extracting structured outputs (results) without forcing step containers to implement engine protocols. citeturn11view1

#### Architectural limitations

- Heavy coupling to Kubernetes API semantics and etcd constraints (CRD size limits influence engine design choices). citeturn11view1turn11view2
- Reconciliation introduces eventual consistency and retry loops that can be harder to reason about than lease-based “one worker owns one job” models. citeturn1search7

#### Architectural lessons

- Treat “inspection storage” as a separate subsystem if your control-plane persistence substrate is optimized for current state rather than history (Tekton Results is a concrete reference). citeturn11view2
- Sidecar-based extraction is an effective engine primitive on container platforms: it converts in-container file writes into controller-readable outputs. citeturn11view1

## Cross-System Patterns and Comparative Model

### Recurring engine patterns

A small number of architecture motifs recur and appear robust across product identity:

**Pull-based workers with long polling + leased ownership.**

- GitHub runner: dequeue model, one job at a time, lock renewal, server-authoritative cancellation. citeturn17view0
- GitLab: runner pull + Workhorse-held long poll released by Redis PubSub “tick.” citeturn18view0
- Buildkite: agent polls with session token; job token on acceptance; dispatch rules + agent selection policies. citeturn21view0turn22view0turn22view1

This pattern optimizes for executor network simplicity and security (no inbound), but requires careful modeling of: queue latency, fairness, lease renewal/timeout, and orphan handling.

**Planning boundary choices: static DAG vs runtime expansion vs lazy DAG.**

- GitHub/GitLab: mostly static intent (YAML) transformed into runnable jobs with dependency edges (`needs`). citeturn14view1turn20view0
- Buildkite: runtime expansion via pipeline upload changes the plan mid-run. citeturn21view2turn21view4
- Dagger: lazy DAG evaluation means the plan is implicit and only evaluated as needed for requested outputs. citeturn4view0

**Inspection substrate separation.**

- GitHub: Checks API as the status/log projection substrate. citeturn14view2
- GitLab: explicit hot log → archived log → object storage pipeline, plus artifact lifecycles. citeturn19view0turn19view1
- Tekton: Results subsystem decouples history from controller/etcd. citeturn11view2

**Controller-style reconciliation vs scheduler-driven dispatch.**

- Argo/Tekton: reconciliation loops drive orchestration, with pods as the execution substrate. citeturn9view0turn11view0turn1search7
- GitHub/GitLab/Buildkite: central scheduler decides runnable work; workers poll and lease. citeturn17view0turn18view0turn21view0

**State model spectrum: record-based vs event-sourced vs object-ID snapshots vs CRD desired/observed status.**

- Temporal: append-only event history + mutable state derived from it. citeturn12view2turn12view3
- Dagger: object IDs encode state snapshots and execution plan. citeturn4view0
- GitHub/Buildkite/GitLab: run/job records + logs/artifacts with retention and explicit state machines. citeturn14view2turn21view3turn19view0
- Argo/Tekton: Kotlin? (Kubernetes) CRD status and pod state as the primary runtime state representation. citeturn9view0turn11view0

### Comparative model table

| System         | Runtime entities (engine-relevant)                                      | Definition → execution boundary                                                                                             | Orchestration style                                                                      | Execution ownership model                                                                | State source of truth                                                                           | Inspection substrate                                                 | Scaling pattern                                                                         | Recovery model                                                                             |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GitHub Actions | workflow run, job run, steps; runner listener/worker; job request lease | YAML → job dispatch payload → runner long poll → worker executes citeturn14view1turn13view0turn17view0                 | central dispatch + queue/broker; runner dequeues one job citeturn17view0turn13view0  | leased job request with renewal; server authoritative citeturn17view0                 | service records projected via Checks API citeturn14view2                                     | log/graph via Checks check suite/run citeturn14view2              | scale runners (ARC autoscaling) citeturn13view0                                      | lease timeout/cancel; rerun attempts w/ partial logs citeturn17view0turn14view2        |
| GitLab CI/CD   | pipeline, job, stage; runner; Workhorse/Redis/Sidekiq dispatch path     | `.gitlab-ci.yml` → job graph (stages/DAG) → runner pulls job via `/jobs/request` citeturn19view2turn20view0turn18view0 | pull-based runners + long-poll release via Redis tick citeturn18view0                 | assignment by Rails; runner executes; concurrency via goroutines citeturn18view0      | Rails+storage; logs/artifacts with explicit lifecycle citeturn19view0turn19view1            | logs + artifacts + pipeline/job views citeturn19view0turn19view2 | long polling reduces Rails load; scale runners + concurrency citeturn18view0         | stage failure blocks later stages; YAML retry policy exists citeturn19view2turn19view3 |
| Buildkite      | build, job, step; agent; cluster/queue; concurrency group               | pipeline.yml → build/jobs; optional runtime step insertion via pipeline upload citeturn21view3turn21view2turn21view4   | scheduler w/ dependency + priority + queue dispatch rules citeturn22view2turn22view1 | pull-based agents w/ session token + job token citeturn21view0                        | build/job state machines + concurrency-group locks citeturn21view3turn22view3               | UI + logs + annotations; APIs citeturn21view3turn8search9        | scale agent fleets; pull-based model favors no inbound citeturn2search12turn21view0 | job expiration if not picked up; explicit canceling states citeturn22view4turn21view3  |
| Dagger         | session, runner; GraphQL objects/IDs; DAG ops                           | SDK/code → GraphQL query → DAG planning + lazy evaluation → runner containers citeturn4view0turn5view0                  | DAG solver + demand-driven execution citeturn4view0                                   | session mediates; runner executes + caches citeturn5view0turn23view0                 | GraphQL object IDs + runner cache; session freezes source versions citeturn4view0turn5view0 | query-shaped outputs; execution forced via `sync` citeturn4view0  | persistent runner + ephemeral sessions citeturn5view0                                | rerun via recompute+cache; structured exec errors citeturn23view1turn4view0            |
| Temporal       | workflow execution; event history; workflow/activity tasks; services    | workflow code advances in tasks; commands → events → tasks enqueued citeturn12view1turn12view3turn12view2              | event-sourced progression + task queues citeturn12view0turn12view3                   | workers poll task queues; history drives correctness citeturn12view1turn12view0      | append-only event history + mutable state citeturn12view2turn12view3                        | history/audit + query tasks citeturn12view2turn12view1           | independently scalable services; history sharding citeturn12view0turn12view3        | retries/timeouts are evented; reset via history copy citeturn12view2                    |
| Argo Workflows | workflow CRD; controller queue; pods per node; executor sidecars        | workflow spec → controller reconciles → pods created (main/init/wait) citeturn9view0turn10view0                         | controller reconciliation loop citeturn9view0                                         | Kubernetes schedules pods; executor manages artifacts/logs citeturn10view0turn9view0 | CRD + pod state citeturn9view0                                                               | UI/API + pod logs + executor-managed artifacts citeturn10view0    | scale via controller capacity + cluster resources citeturn9view0                     | cleanup/artifact capture via wait container citeturn9view0                              |
| Tekton         | PipelineRun/TaskRun CRDs; controllers; Results API                      | PipelineRun → creates TaskRuns; controller creates pods/steps citeturn11view0                                            | reconciliation; requeue on errors citeturn1search7                                    | controller owns run; pods execute steps; sidecar for results citeturn11view1          | CRDs in etcd; Results DB for history/logs citeturn11view2                                    | CRD/pod logs + Results query API citeturn11view2                  | decouple long-term history to free etcd citeturn11view2                              | backoff/requeue; result-size/CRD-size limits inform design citeturn11view1turn1search7 |

## Implications for Our Engine Work

This section translates the research into **architecture-relevant questions and constraints** for your engine work, grounded in the PRD/PVD/RFC emphasis on execution semantics and inspection rather than market positioning. fileciteturn1file0turn1file1turn1file2

### Make the planning boundary explicit early

The studied systems demonstrate that “definition-to-execution” is not a single step; it is a boundary with multiple plausible shapes:

- **Static plan models (GitHub/GitLab)**: YAML defines a job graph; the control plane schedules; executors receive already-materialized job payloads. citeturn14view1turn18view0
- **Runtime-expanding plan (Buildkite)**: the plan is mutated during execution via pipeline upload; scheduling precedence and ordering semantics become part of the engine model. citeturn21view2turn22view1
- **Lazy “query = workflow” (Dagger)**: the “plan” is implicit; what is executed depends on what is requested; `sync` exists to force execution. citeturn4view0

Implication: if your PRD/RFC assumptions include strong inspectability and predictable execution semantics, then the engine must choose (or explicitly support) a planning boundary that makes “what will run” and “why it ran” explainable. fileciteturn1file0turn1file2

### Decide how execution ownership is represented and renewed

Execution ownership is a core engine semantic, not an implementation detail:

- GitHub runner uses an explicit **lease renewal** model and cancels local execution when server state indicates mismatch. citeturn17view0
- Buildkite ties execution identity to tokens (agent token → session token → job token), implying an ownership chain that can be audited and constrained. citeturn21view0
- GitLab’s long polling model achieves responsiveness without pushing jobs to runners; instead it “releases” held requests when runners’ keys change, keeping assignment in the control plane. citeturn18view0

Implication: treat “who owns a unit of work right now?” as a first-class concept—whether via leases, reconciliation ownership, or other mechanisms—because it determines cancellation, retries, and “stuck run” recoverability. fileciteturn1file2

### Treat inspection as a projection over authoritative state

Inspection is not free: it demands an authoritative state substrate that can be projected into log/graph/trace views:

- GitHub’s projection is explicitly Checks-based (check suite/run). citeturn14view2
- GitLab’s is log/artifact lifecycle-based with explicit hot/archive/object storage paths. citeturn19view0
- Tekton Results shows a strong pattern: move long-term history out of the control-plane persistence substrate (etcd) into a purpose-built store + API. citeturn11view2

Implication: if your PRD/RFC expects rich inspection, you likely need to decide what your **authoritative state** is (events, records, CRDs, snapshots) and what **projections** you maintain for UI/debugging, and how strongly-consistent they must be with execution. fileciteturn1file0turn1file2

### Choose orchestration style with eyes open about tradeoffs

The optional systems highlight that orchestration style is a deep architectural commitment:

- **Scheduler + pull workers** (GitHub/GitLab/Buildkite) optimizes for executor network security and simple scaling but requires careful lease/queue semantics and dispatch fairness. citeturn17view0turn18view0turn21view0
- **Controller reconciliation** (Argo/Tekton) matches Kubernetes-native operational models but shifts correctness to idempotent reconciliation and depends heavily on cluster control-plane characteristics. citeturn9view0turn1search7
- **Event-sourced durable orchestration** (Temporal) provides strong recovery and audit semantics but imposes a model where progress is mediated by event histories and task queues. citeturn12view2turn12view3

Implication: rather than “which system is best,” the actionable output is: identify which orchestration style aligns with the execution guarantees you need (durability, replay, resumability, local parity), and which costs you can afford (complexity, operational substrate coupling, state volume). fileciteturn1file1turn1file0

### Patterns likely misaligned vs patterns worth considering

Without proposing an architecture, the research suggests some patterns that may be _more_ or _less_ compatible with an engine that needs consistent local/CI behavior and strong inspection (as implied by your internal docs). fileciteturn1file0turn1file1turn1file2

Patterns worth considering:

- Session/runner split for local parity and explicit capture of local context (Dagger). citeturn5view0turn4view0
- Explicit lease renewal and server-authoritative cancellation (GitHub runner) for robust stuck-run handling. citeturn17view0
- Separating “execution control plane state” from “long-term inspection/history state” (GitLab log archiving; Tekton Results). citeturn19view0turn11view2
- Notification-driven pull (GitLab Workhorse long polling) to reduce control-plane load at scale while keeping pull security properties. citeturn18view0

Patterns likely to require careful alignment work:

- Runtime plan mutation (Buildkite dynamic pipelines) because it complicates static reasoning and ordering; it can be powerful but increases “why did this run?” ambiguity unless modeled and inspected explicitly. citeturn21view2turn22view1
- Pure reconciliation loops as the only orchestration model if your engine needs strong cross-environment parity outside Kubernetes, since the model couples semantics to K8s resource reconciliation. citeturn9view0turn11view1

## Open Engine Questions

These are architecture questions that remain unresolved _after_ examining these engines; they are phrased to support later ADR/SDD work without prematurely selecting solutions.

- **What is the minimal authoritative state representation required for correct recovery?**  
  Is it enough to persist “latest status + logs,” or do you need event history (Temporal) or snapshot-IDs (Dagger) to guarantee resumability and explainability? citeturn12view2turn4view0turn19view0

- **Should execution ownership be lease-based, reconciliation-based, or both?**  
  GitHub runner shows explicit lease renewal; Argo/Tekton show reconciliation ownership; GitLab shows notification-driven pull with control-plane assignment. Which model matches your durability + operational assumptions? citeturn17view0turn9view0turn18view0

- **Where does “planning” live, and what artifacts does it produce?**  
  Is there a first-class “expanded plan/graph” stored for inspection, or is the plan implicit (Dagger) or mutable (Buildkite)? How is “plan vs execution” audited? citeturn4view0turn21view2turn14view1

- **What is the inspection contract: log-centric, graph-centric, trace/event-centric, or hybrid?**  
  If logs are the core tool for debugging (GitLab/GitHub), what extra state must exist to interpret them (step boundaries, dependency edges, artifact provenance)? citeturn14view2turn19view0turn19view1

- **What scaling strategy is primary: more schedulers/controllers, more workers, or both?**  
  If you scale workers, do you need dispatch shims (GitLab Workhorse), job availability messages (ARC), or additional storage separation (Tekton Results)? citeturn18view0turn13view0turn11view2

- **How are “environment capture” and “source pinning” modeled?**  
  Dagger freezes unpinned sources per session; CI systems often rely on SCM commit SHA but still face “floating tags,” secrets scope, and artifact provenance questions. What becomes part of your engine’s state model? citeturn5view0turn19view3

## Sources

### GitHub Actions

- GitHub Docs: workflow syntax and job dependency semantics (`jobs`, `needs`). citeturn14view1
- GitHub Docs: Understanding runners (single job capacity; hosted runners as fresh VMs). citeturn14view0
- GitHub Docs: workflow run logs; Checks API mapping; injected setup/complete steps; rerun log archive behavior. citeturn14view2
- GitHub Docs: Actions Runner Controller architecture; long polling; `Job Available`; JIT registration; 24-hour unassignment. citeturn13view0
- Open-source runner code: Runner listener and session/job loop. citeturn15view0
- Open-source runner code: JobDispatcher design invariants; lease renewal; cancellation; unfinished log upload. citeturn17view0

### GitLab CI/CD

- GitLab Docs: pipelines/jobs/stages core model. citeturn19view2
- GitLab Docs: `needs` DAG semantics and stageless/hybrid execution. citeturn20view0turn20view1
- GitLab Docs: long polling architecture (Workhorse + Redis PubSub + Sidekiq + Rails sequence diagram). citeturn18view0
- GitLab Docs: CI YAML syntax reference (`include`, `default`, validation via CI Lint; `retry` example via defaults). citeturn19view3turn7search4
- GitLab Docs: job logs data flow (patching → archiving → object storage paths). citeturn19view0
- GitLab Docs: job artifacts retention and dependency-controlled fetching. citeturn19view1

### Buildkite

- Buildkite Docs: defining steps; build/job state machines; internal vs API states; timestamps. citeturn21view3
- Buildkite Docs: agent token exchange process (agent token → session token → job token). citeturn21view0
- Buildkite Docs: managing queues/clusters (routing and isolation for agent pools). citeturn21view5
- Buildkite Docs: dependency semantics (`wait`/`block` implicit; `depends_on` explicit; scheduler behavior). citeturn22view2
- Buildkite Docs: dynamic pipelines and pipeline upload semantics. citeturn21view2turn21view4
- Buildkite Docs: job dispatch precedence and prioritization. citeturn22view1
- Buildkite Docs: agent selection criteria (priority + success-based preference + targeting). citeturn22view0
- Buildkite Docs: concurrency groups as queue/lock with active-state semantics. citeturn22view3
- Buildkite Docs: scheduled job expiration. citeturn22view4
- Buildkite Docs: pull-based agent targeting benefits (security/scaling/network resilience). citeturn2search12
- Buildkite Docs: Agents API responsibility summary (polling, running jobs, reporting logs/artifacts). citeturn0search3turn8search8
- Buildkite Docs: annotations created via agent for inspection augmentation. citeturn8search9turn8search2

### Dagger

- Dagger Docs: API internals (query as workflow; state via object IDs; lazy evaluation; dynamic API extension; DAG planning + caching). citeturn4view0
- Dagger repo docs: operator manual (client/session/runner split; local sync; secrets; source pinning; runner responsibilities; DSI flows). citeturn5view0
- Dagger repo issue (maintainer explanation): engine as router + runner; runner as BuildKit-like daemon + glue; router placement variants. citeturn23view0
- Dagger Go package docs: structured execution errors serializable through GraphQL (`ExecError`). citeturn23view1

### Temporal

- Temporal Docs: server decomposition (Frontend/History/Matching/Worker) and scaling properties. citeturn12view0
- Temporal repo architecture README: task types and worker polling semantics. citeturn12view1
- Temporal Docs: Events and Event History as authoritative log + limits; retries/timeouts/cancel modeled as events; Reset semantics. citeturn12view2
- Temporal repo (History Service architecture): event sourcing, transfer/timer tasks, and internal queue processing model. citeturn12view3

### Argo Workflows

- Argo Workflows Docs: architecture (controller reconciles; Argo server; pods per step/task with main/init/wait; workflow queue + worker goroutines; single-workflow processing). citeturn9view0
- Argo Workflows Docs: executor model (`emissary` executor; init+sidecar; log/artifact/lifecycle responsibilities). citeturn10view0

### Tekton

- Tekton Docs: Pipeline/Run/Task/TaskRun API semantics; PipelineRun creates TaskRuns. citeturn11view0
- Tekton Docs: results-from sidecar logs (controller injects sidecar; controller reads logs; size limits). citeturn11view1
- Tekton Docs: Tekton Results components and “Life of a Result” flow; decoupling history/log storage from controller/etcd. citeturn11view2
- Tekton Docs: controller requeue/backoff behavior on TaskRun/CustomRun creation errors (additional config). citeturn1search7

### Internal context documents provided by you

- PRD / PVD / current RFC draft (uploaded) used only to prioritize which engine questions matter (execution semantics, state, inspection, scaling), not to author product design. fileciteturn1file0turn1file1turn1file2
