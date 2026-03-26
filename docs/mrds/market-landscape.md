# Market Landscape Research

## 1. Summary

The CI/CD and delivery-automation market breaks into six categories: integrated CI/CD platforms; hybrid CI/CD platforms with a SaaS control plane and customer-managed compute; self-managed automation servers; Kubernetes-native workflow and delivery systems; code-first delivery automation tools; and adjacent developer automation tools that shape expectations around local workflow, caching, and composability.

Across incumbents, the dominant authoring model remains YAML plus a reuse layer. GitHub reusable workflows and composite actions, GitLab components and catalog, CircleCI orbs, Buildkite plugins, and Jenkins shared libraries/plugins all show that reuse and standardization are established requirements, but also that raw configuration remains insufficient on its own.

A consistent underserved area is high-fidelity local execution and debugging of full workflows, not just individual jobs or scripts. Several mature platforms document partial local support or de-emphasize local parity, while newer code-first tools make local execution parity and richer workflow observability central to their positioning. That gap appears structural rather than cosmetic.

## 2. Scope of Analysis

This MRD covers developer-facing tools used to define, execute, and observe automated software delivery workflows: build, test, package, release, deployment-adjacent automation, and related execution/runtime control surfaces.

The analysis is based primarily on official documentation, product pages, pricing pages, official repositories, and publicly visible operational surfaces such as runner, agent, CLI, and workflow UI documentation.

Included:

- Code-first or programmable workflow engines used for software delivery automation.
- YAML/config-based CI/CD systems.
- Kubernetes-native workflow engines and GitOps CD systems where they materially overlap with delivery automation.
- Adjacent code-first automation tools that shape user expectations for authoring, local execution, reuse, or CI speed.

Excluded:

- Broad IaC market analysis beyond what directly influences delivery-tool expectations.
- General deployment platforms or PaaS products unless they materially affect authoring or execution expectations.
- Product design, architecture, implementation proposals, PRD content, or RFC content.

## 3. Market Categories

The category scheme below uses one axis throughout: each category is defined by the tool’s primary product role in delivery automation, not by pricing, hosting, or implementation detail alone.

### 3.1 Integrated CI/CD platforms

These tools define workflows in repository-local configuration, usually YAML, and provide a control plane for execution history, logs, reruns, and integrations. GitHub Actions, GitLab CI/CD, CircleCI, Azure Pipelines, and Google Cloud Build fit this category.

### 3.2 Hybrid CI/CD platforms

These tools provide a managed control plane while allowing customer-managed or customer-selected compute for execution. Buildkite is the clearest example. The distinguishing trait is not YAML itself, but the split between orchestration ownership and execution ownership.

### 3.3 Self-managed automation servers

These systems are operated end to end by the customer. Jenkins is the canonical example. The defining characteristic is full customer ownership of the control plane and execution environment, with high extensibility and correspondingly high operational burden.

### 3.4 Kubernetes-native workflow and delivery systems

These tools use Kubernetes as the primary execution or reconciliation substrate. Tekton and Argo Workflows are workflow engines; Argo CD is a delivery controller in the GitOps model. They are adjacent to general CI/CD, but can be direct alternatives in Kubernetes-centric organizations.

### 3.5 Code-first delivery automation tools

These tools emphasize authoring in general-purpose languages, typed composition, programmable reuse, and stronger local execution parity. Dagger is the clearest direct example in this category.

### 3.6 Adjacent developer automation tools

These tools are not general CI/CD platforms, but they materially shape expectations around workflow authoring, local ergonomics, incremental execution, and shared caching. Alchemy, Nx, and Turborepo are relevant in this role.

## 4. Alternative Matrix

Qualitative labels in the matrix use a simple scale: **High** = first-class and central to the documented workflow; **Medium** = usable but partial or indirect; **Low** = limited or secondary; intermediate labels indicate boundary cases. **Direct** means the tool competes for CI/CD or delivery workflow definition and execution; **Adjacent** means it primarily influences expectations rather than serving as a general CI/CD platform.

| Tool                   | Category                                       | Direct / Adjacent                          | Authoring model                                                                     | Execution model                                                                             | Local workflow quality | Observability surface                                           | Hosting model                                     | Notes                                                |
| ---------------------- | ---------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Dagger                 | Code-first delivery automation                 | Direct                                     | General-purpose languages via SDKs; schema-generated APIs; checks callable from CLI | Runs with a container runtime; local, CI, or cloud execution; incremental/cached operations | High                   | Traces, logs, metrics; optional Dagger Cloud                    | OSS engine + optional SaaS                        | Strong local-first and trace-first positioning       |
| GitHub Actions         | Integrated CI/CD platform                      | Direct                                     | YAML workflows; reusable workflows; composite actions; marketplace actions          | GitHub-hosted or self-hosted runners                                                        | Medium-low             | Run history, logs, reruns, cancellation, API                    | SaaS control plane + optional self-hosted runners | Strong ecosystem and distribution position           |
| GitLab CI/CD           | Integrated CI/CD platform                      | Direct                                     | `.gitlab-ci.yml`; includes/extends; components/catalog                              | GitLab Runner with multiple executors including Docker and Kubernetes                       | Medium                 | Pipeline graph, job logs, artifacts, retries, DAG via `needs`   | SaaS + self-managed + dedicated                   | Strong modularity and reuse investment               |
| CircleCI               | Integrated CI/CD platform                      | Direct                                     | YAML config; reusable orbs                                                          | Containers and VMs; self-hosted runners available                                           | Medium                 | Pipeline and workflow UI, reruns, artifacts, caches, workspaces | Cloud + server                                    | Local CLI helps, but full workflow parity is limited |
| Buildkite              | Hybrid CI/CD platform                          | Direct                                     | YAML pipelines; plugins                                                             | SaaS control plane with self-hosted or hosted agents                                        | Medium                 | Logs, annotations, API and CLI controls                         | SaaS control plane + self-hosted or hosted agents | Strong BYO-compute positioning                       |
| Jenkins                | Self-managed automation server                 | Direct                                     | Jenkinsfile; declarative or scripted pipeline; Groovy DSL                           | Controller + agents or executors                                                            | Medium                 | UI and logs; extensibility depends on plugin choices            | Self-hosted                                       | Maximum extensibility, highest operational burden    |
| Tekton                 | Kubernetes-native workflow and delivery system | Direct in K8s-centric orgs                 | Kubernetes CRDs in YAML                                                             | Runs as pods in Kubernetes                                                                  | Low-medium             | Kubernetes-native status + add-on UIs                           | Self-hosted on Kubernetes                         | More platform substrate than end-user CI product     |
| Argo Workflows         | Kubernetes-native workflow and delivery system | Direct in K8s-centric orgs                 | Kubernetes CRDs; step and DAG workflows                                             | Containerized jobs on Kubernetes                                                            | Low-medium             | Workflow status and UI on cluster                               | Self-hosted on Kubernetes                         | Strong DAG model                                     |
| Argo CD                | Kubernetes-native workflow and delivery system | Direct for CD scope; adjacent for CI scope | Declarative Kubernetes manifests                                                    | Controller reconciles live vs desired Git state                                             | Low                    | Sync status, diffs, history                                     | Self-hosted on Kubernetes                         | CD and GitOps category, not general CI               |
| Google Cloud Build     | Integrated CI/CD platform                      | Direct                                     | YAML or JSON build configs; container-step model                                    | Executes on Google Cloud                                                                    | Medium-low             | Build logs, history, cloud-native controls                      | SaaS service on GCP                               | Strong cloud-native integration                      |
| Azure Pipelines        | Integrated CI/CD platform                      | Direct                                     | YAML pipelines; task model; extensions                                              | Microsoft-hosted or self-hosted agents                                                      | Medium-low             | Logs, UI, tasks, marketplace extensions                         | SaaS + on-prem server variants                    | Enterprise task and extension ecosystem              |
| Alchemy                | Adjacent developer automation tool             | Adjacent                                   | TypeScript-native library                                                           | Runs in JS runtimes; local state model                                                      | High                   | State inspection, not CI observability                          | OSS library                                       | Shapes code-first automation expectations            |
| Nx Cloud features      | Adjacent developer automation tool             | Adjacent                                   | Task graph config + CLI                                                             | Local + remote cache; distributed execution                                                 | High                   | Task analytics and cache-oriented feedback                      | SaaS features around local and CI workflows       | Raises expectations for CI speed and incrementality  |
| Turborepo Remote Cache | Adjacent developer automation tool             | Adjacent                                   | Task definitions + CLI                                                              | Local + remote cache                                                                        | High                   | Cache hit and miss feedback, summaries                          | Managed remote cache + local CLI                  | Strong cache-first expectation setter                |

## 5. Tool Profiles

### Dagger

- **Positioning:** Code-first delivery automation engine centered on portable workflows that run locally, in CI, or in the cloud.
- **Authoring model:** General-purpose language SDKs, schema-generated APIs, reusable modules, and checks.
- **Execution model:** Container-runtime-based execution with local, CI, and cloud modes; incremental and cached operations.
- **Notable strengths:** Strong local parity, composability, reusable modules, and trace-oriented observability.
- **Notable limitations:** It is less of a full incumbent-style CI control plane and more of a programmable execution layer.

### GitHub Actions

- **Positioning:** Repository-native CI/CD platform embedded in GitHub.
- **Authoring model:** YAML workflows with reusable workflows, composite actions, and marketplace actions.
- **Execution model:** GitHub-hosted or self-hosted runners under a GitHub control plane.
- **Notable strengths:** Large ecosystem, distribution advantage, standard control-plane features, and proximity to source control workflows.
- **Notable limitations:** Local workflow development is secondary to remote execution, and reuse remains platform-specific.

### GitLab CI/CD

- **Positioning:** Full CI/CD platform within the broader GitLab product suite.
- **Authoring model:** `.gitlab-ci.yml` with includes, extends, components, and catalog-based reuse.
- **Execution model:** GitLab Runner with multiple executors, including Docker and Kubernetes, across SaaS and self-managed variants.
- **Notable strengths:** Mature platform scope, formal reuse surfaces, DAG support, and flexible deployment options.
- **Notable limitations:** Authoring remains YAML-centric, and local parity for full pipelines is weak.

### CircleCI

- **Positioning:** Mature integrated CI/CD platform centered on hosted workflow execution.
- **Authoring model:** YAML configuration with reusable orbs.
- **Execution model:** Container and VM execution with cloud and server offerings; self-hosted runners are available.
- **Notable strengths:** Established workflow UI, packaging model, caches, artifacts, and a useful local CLI for partial iteration.
- **Notable limitations:** Local support does not extend to faithful full-workflow execution.

### Buildkite

- **Positioning:** CI/CD platform differentiated by orchestration and compute separation.
- **Authoring model:** YAML pipelines with plugin-based extension.
- **Execution model:** SaaS control plane with self-hosted or hosted agents.
- **Notable strengths:** Strong fit for compliance, network-control, and BYO-compute requirements; operator-friendly controls.
- **Notable limitations:** Local workflow ergonomics are indirect, and the authoring surface is not materially different from classic YAML systems.

### Jenkins

- **Positioning:** Canonical self-managed automation server.
- **Authoring model:** Jenkinsfile with declarative or scripted pipelines and broad plugin support.
- **Execution model:** Customer-operated controller and agents.
- **Notable strengths:** Maximum extensibility, full self-hosting, and broad historical adoption.
- **Notable limitations:** High operational burden, inconsistent experience across installations, and ecosystem sprawl.

### Tekton

- **Positioning:** Kubernetes-native workflow substrate for CI/CD building blocks.
- **Authoring model:** Kubernetes CRDs in YAML.
- **Execution model:** Kubernetes-native execution as pods managed through the Kubernetes API.
- **Notable strengths:** Strong fit for platform teams standardizing on Kubernetes as the execution substrate.
- **Notable limitations:** More substrate than end-user CI product; local workflow ergonomics are weak.

### Argo Workflows

- **Positioning:** Kubernetes-native workflow engine with strong DAG semantics.
- **Authoring model:** Kubernetes CRDs for step-based and DAG-based workflows.
- **Execution model:** Containerized job execution on Kubernetes.
- **Notable strengths:** Strong graph model and fit for Kubernetes-heavy workflow orchestration.
- **Notable limitations:** It is closer to a generic workflow engine than to a source-host-centric CI platform.

### Argo CD

- **Positioning:** Declarative GitOps delivery controller for Kubernetes.
- **Authoring model:** Declarative manifests and Git-managed desired state.
- **Execution model:** Continuous reconciliation of live cluster state against Git.
- **Notable strengths:** Strong delivery-state visibility, diffing, and history for Kubernetes CD.
- **Notable limitations:** It is not a general CI engine and should not be treated as such.

### Google Cloud Build

- **Positioning:** Cloud-provider-native CI/CD service for Google Cloud environments.
- **Authoring model:** YAML or JSON build configuration with container-based build steps.
- **Execution model:** Managed execution on Google Cloud, including cloud-native triggers and pools.
- **Notable strengths:** Strong cloud integration and standardized container-step semantics.
- **Notable limitations:** Local parity is limited and the product is tightly aligned with a single cloud environment.

### Azure Pipelines

- **Positioning:** Enterprise CI/CD platform in the Azure DevOps ecosystem.
- **Authoring model:** YAML pipelines plus a task and extension model.
- **Execution model:** Microsoft-hosted or self-hosted agents; SaaS and on-prem variants.
- **Notable strengths:** Enterprise-friendly extension model, broad task ecosystem, and flexible agent deployment.
- **Notable limitations:** Local-first workflow development is not a core product trait.

### Alchemy

- **Positioning:** Adjacent code-first automation tool in infrastructure automation rather than CI/CD.
- **Authoring model:** TypeScript-native library model.
- **Execution model:** Runs in standard JavaScript runtimes with local state.
- **Notable strengths:** Strong local ergonomics, embeddability, and a clear code-first mental model.
- **Notable limitations:** It is not a general CI/CD platform, so relevance is expectation-setting rather than direct substitution.

### Nx Cloud features

- **Positioning:** Adjacent developer automation layer focused on task execution performance.
- **Authoring model:** Task graph configuration and CLI-driven workflows.
- **Execution model:** Local execution with remote caching and distributed execution.
- **Notable strengths:** Reframes expectations for CI speed, incrementality, and affected-only execution.
- **Notable limitations:** It does not replace general CI/CD orchestration in the broad market.

### Turborepo Remote Cache

- **Positioning:** Adjacent developer automation capability focused on cache-first task execution.
- **Authoring model:** Task definitions plus CLI-based repository workflow.
- **Execution model:** Local and CI execution with shared remote cache.
- **Notable strengths:** Strong expectation-setting around avoiding repeated work across local and CI environments.
- **Notable limitations:** It is a task-acceleration layer, not a general delivery orchestration platform.

## 6. Landscape Patterns

### 6.1 Common market strengths

- Repository-centric workflow definition remains the default interaction model.
- Reuse primitives are established across incumbents, even when the specific abstraction differs.
- Hosted or centrally managed control planes consistently provide run history, logs, reruns, and cancellation as baseline operational surfaces.

### 6.2 Common market weaknesses

- Full workflow local parity is limited across mature platforms.
- Reuse mechanisms are ecosystem-specific and weakly portable.
- Observability is still primarily log-centric, with less evidence of trace-native workflow inspection in classic CI/CD.

### 6.3 Common tradeoffs

- YAML-based systems are easy to standardize and review, but can become difficult to compose at scale.
- Code-first systems improve composition and reuse, but require a more programming-oriented workflow model.
- Managed control planes reduce operational burden, but increase lock-in and pricing sensitivity.
- Full self-management increases control, but also increases operational cost and variability.

### 6.4 Incumbent versus newer product emphasis

Incumbents primarily optimize control-plane UX, ecosystem breadth, and remote execution management. Newer code-first tools place more emphasis on authoring model, execution portability, local development experience, and structured observability.

## 7. Gaps and Opportunities

- **Local workflow parity:** High-fidelity local execution and debugging of full workflows remains weak across many incumbent platforms.
- **Portable reuse:** Reuse is established, but the reusable unit is usually vendor-specific and hard to carry across control planes.
- **Trace-native observability:** Workflow traces are less common than logs, step views, and run history in classic CI/CD products.
- **Workflow-level incrementality:** Adjacent tools have shifted expectations around incremental execution and shared caching, but many CI platforms still treat these as external optimizations.
- **Control-plane sensitivity:** Pricing and monetization of orchestration layers create sensitivity around whether a product complements, replaces, or adds another control plane.

## 8. Implications

### 8.1 Baseline market expectations

- Run history, logs, cancellation, and rerun or retry controls.
- A reusable workflow abstraction.
- Support for hosted execution and, for part of the market, customer-managed execution.
- Secure integration patterns for authentication and secrets.
- Strong repository-centric workflow ergonomics.

### 8.2 Differentiation signals indicated by the market

- Full-fidelity local execution and debugging of workflows.
- Trace-native workflow observability.
- Portability across existing CI control planes.
- Strong authoring composability without losing standardization or governance.
- Incremental execution and cache-aware workflow semantics as core behavior rather than add-ons.

### 8.3 Assumptions requiring later validation

- Whether buyers want a new primary control plane or a portable execution and composition layer.
- Whether code-first authoring is attractive as a replacement model or mainly as a power-user layer over existing CI.
- How much willingness to pay exists for workflow observability as a separate value surface.
- Which hosting model dominates in the target segment: full self-hosting, SaaS plus BYO compute, or fully managed cloud CI.

### 8.4 Areas not implied by the market baseline

- Full GitOps reconciliation and Kubernetes-state management.
- Kubernetes-native execution as the primary substrate for all users.
- Broad infrastructure provisioning scope beyond what directly affects delivery automation.
- Monorepo acceleration as the sole primary wedge unless the target segment is explicitly monorepo-heavy.

## 9. Open Questions

1. How large is the real addressable wedge for code-first CI/CD versus YAML plus better reuse?
2. Do most teams want to replace existing CI control planes, or layer a programmable execution system under or beside them?
3. How strong is willingness to pay for workflow observability as a dedicated product surface?
4. Which hosting model dominates in the target segment: full self-hosting, SaaS plus BYO compute, or fully managed cloud CI?
5. How much portability across incumbent CI platforms is actually demanded in purchasing decisions versus appreciated in theory?

## 10. Sources

### Dagger

- [Overview](https://docs.dagger.io/)
- [Checks](https://docs.dagger.io/core-concepts/checks/)
- [Dagger Cloud docs](https://docs.dagger.io/reference/configuration/cloud)
- [Dagger Cloud product](https://dagger.io/cloud)
- [Dagger pricing](https://dagger.io/pricing)

### GitHub Actions

- [GitHub Actions docs](https://docs.github.com/en/actions)
- [Understanding GitHub Actions](https://docs.github.com/en/actions/learn-github-actions/understanding-github-actions)
- [About workflows](https://docs.github.com/en/actions/concepts/workflows-and-actions/about-workflows)
- [About self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners)
- [Reusing workflows](https://docs.github.com/actions/using-workflows/reusing-workflows)
- [Publishing actions in GitHub Marketplace](https://docs.github.com/actions/how-tos/creating-and-publishing-actions/publishing-actions-in-github-marketplace)
- [Using workflow run logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/using-workflow-run-logs)
- [Re-running workflows and jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
- [Workflow runs REST API](https://docs.github.com/rest/actions/workflow-runs)
- [GitHub Actions billing](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- [GitHub Actions pricing changes, Dec 2025](https://resources.github.com/actions/2026-pricing-changes-for-github-actions/)
- [Community pricing update thread](https://github.com/orgs/community/discussions/182186)

### GitLab CI/CD

- [Get started with GitLab CI/CD](https://docs.gitlab.com/ci/)
- [CI/CD YAML syntax reference](https://docs.gitlab.com/ci/yaml/)
- [Use `needs` for DAG execution](https://docs.gitlab.com/ci/yaml/needs/)
- [CI/CD components and catalog](https://docs.gitlab.com/ci/components/)
- [Docker executor](https://docs.gitlab.com/runner/executors/docker/)
- [Kubernetes executor](https://docs.gitlab.com/runner/executors/kubernetes/)
- [Deprecations and removals](https://docs.gitlab.com/update/deprecations/)

### CircleCI

- [Config introduction](https://circleci.com/docs/configuration-reference/)
- [Orbs overview](https://circleci.com/docs/orbs/use/orb-intro/)
- [Install and configure the local CLI](https://circleci.com/docs/guides/toolkit/local-cli/)
- [How to use the local CLI](https://circleci.com/docs/guides/toolkit/how-to-use-the-circleci-local-cli/)
- [Self-hosted runner overview](https://circleci.com/docs/runner-overview/)
- [Self-hosted runner concepts](https://circleci.com/docs/guides/execution-runner/runner-concepts/)
- [Pricing](https://circleci.com/pricing/)

### Buildkite

- [Pipelines documentation](https://buildkite.com/docs/pipelines)
- [Buildkite agent overview](https://buildkite.com/docs/agent/v2/cli-artifact)
- [Self-hosted agents](https://buildkite.com/docs/agent/self-hosted)
- [Hosted agents](https://buildkite.com/docs/pipelines/hosted-agents)
- [Plugins](https://buildkite.com/docs/pipelines/integrations/plugins)
- [Pricing](https://buildkite.com/pricing/)

### Jenkins

- [Pipeline as Code](https://www.jenkins.io/doc/book/pipeline/pipeline-as-code/)
- [Pipeline with Jenkins](https://www.jenkins.io/s/pipeline/)
- [Pipeline plugin](https://plugins.jenkins.io/workflow-aggregator/)
- [Plugins index](https://plugins.jenkins.io/)

### Tekton

- [Tekton Pipelines docs](https://tekton.dev/docs/pipelines/)

### Argo Workflows

- [Argo Workflows docs](https://argo-workflows.readthedocs.io/en/latest/)
- [DAG workflows](https://argo-workflows.readthedocs.io/en/latest/walk-through/dag/)

### Argo CD

- [Argo CD overview](https://argo-cd.readthedocs.io/en/latest/)
- [Declarative setup](https://argo-cd.readthedocs.io/en/latest/operator-manual/declarative-setup/)

### Google Cloud Build

- [Cloud Build docs](https://cloud.google.com/build/docs)
- [Cloud Build product page](https://cloud.google.com/build)
- [Build triggers](https://docs.cloud.google.com/build/docs/triggers)
- [Cloud builders](https://docs.cloud.google.com/build/docs/cloud-builders)
- [Community and custom builders](https://docs.cloud.google.com/build/docs/configuring-builds/use-community-and-custom-builders)
- [Pricing](https://cloud.google.com/build/pricing)

### Azure Pipelines

- [YAML schema reference](https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/?view=azure-pipelines)
- [Azure Pipelines agents](https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/agents?view=azure-devops)
- [Microsoft-hosted agents](https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted?view=azure-devops)
- [Azure Pipelines task reference](https://learn.microsoft.com/vsts/build-release/tasks/index)
- [Custom pipeline task extensions](https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-build-task?view=azure-devops)

### Alchemy

- [Alchemy repository](https://github.com/alchemy-run/alchemy)

### Nx / Nx Cloud

- [CI features](https://nx.dev/docs/features/ci-features)
- [Remote Caching (Nx Replay)](https://nx.dev/docs/features/ci-features/remote-cache)
- [Affected tasks](https://nx.dev/docs/features/ci-features/affected)
- [Cache task results](https://nx.dev/docs/features/cache-task-results)

### Turborepo

- [Turborepo product page](https://turborepo.com/)
- [Caching](https://turborepo.com/repo/docs/crafting-your-repository/caching)
- [Remote Caching](https://turborepo.com/repo/docs/core-concepts/remote-caching)
- [Constructing CI](https://turborepo.com/repo/docs/crafting-your-repository/constructing-ci)
- [Login command reference](https://turborepo.com/repo/docs/reference/command-line-reference/login)
- [System environment variables](https://turborepo.com/docs/reference/system-environment-variables)
