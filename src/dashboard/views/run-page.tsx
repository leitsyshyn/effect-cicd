import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../components/ui/alert.tsx";
import { RunHeader } from "../components/run-header.tsx";
import { RunPipelineView } from "../components/run-pipeline.tsx";
import { RunTimeline } from "../components/run-timeline.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs.tsx";
import {
  dashboardApi,
  dashboardQueries,
  dashboardQueryKeys,
} from "../lib/dashboard-query.ts";
import { useStreamQueryRefresh } from "../lib/use-stream-query-refresh.ts";
import {
  hrefForJob,
  hrefForRun,
  parseRunPageView,
  type RunPageView,
} from "../lib/routing.ts";

const pageTabs: ReadonlyArray<readonly [RunPageView, string]> = [
  ["workflow", "Workflow"],
  ["timeline", "Timeline"],
];

export function RunPage() {
  const params = useParams<{ runId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runId = params.runId;

  if (runId === undefined) {
    return null;
  }

  const detailQuery = useQuery(dashboardQueries.runDetail(runId));

  useStreamQueryRefresh(
    "/api/runs/stream",
    dashboardQueries.runDetail(runId).queryKey,
    "run-update",
    (event) => eventDataHasRunId(event, runId),
  );

  const actionMutation = useMutation({
    mutationFn: async (action: "cancel" | "retry" | "gc") => {
      if (action === "cancel") {
        return dashboardApi.cancelRun(runId, "Canceled from dashboard");
      }
      if (action === "retry") {
        return dashboardApi.retryRun(runId, "Retried from dashboard");
      }
      return dashboardApi.gcRunArtifacts(runId);
    },
    onSuccess: async (result, action) => {
      if (
        action === "retry" &&
        typeof result === "object" &&
        result !== null &&
        "runId" in result &&
        typeof result.runId === "string"
      ) {
        navigate(hrefForRun(result.runId));
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.runDetail(runId),
      });
    },
  });

  if (detailQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading run...</p>;
  }

  if (detailQuery.error !== null && detailQuery.data === undefined) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load run</AlertTitle>
        <AlertDescription>{detailQuery.error.message}</AlertDescription>
      </Alert>
    );
  }

  if (detailQuery.data === null || detailQuery.data === undefined) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Run not found</AlertTitle>
      </Alert>
    );
  }

  const detail = detailQuery.data;
  const activeView: RunPageView =
    parseRunPageView(searchParams.get("view")) ?? "workflow";

  const actionNotice =
    actionMutation.isSuccess && actionMutation.variables === "cancel"
      ? "Cancellation requested."
      : actionMutation.isSuccess &&
          actionMutation.variables === "gc" &&
          actionMutation.data !== undefined &&
          "deletedCount" in actionMutation.data
        ? `Cleared ${actionMutation.data.deletedCount} payloads and freed ${actionMutation.data.bytesFreed} bytes.`
        : undefined;

  const setActiveView = (view: RunPageView) => {
    const nextParams = new URLSearchParams(searchParams);
    if (view === "workflow") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", view);
    }
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <section className="grid min-w-0 gap-4 overflow-x-hidden">
      <RunHeader
        detail={detail}
        {...(actionMutation.variables === undefined
          ? {}
          : { actionPending: actionMutation.variables })}
        {...(actionNotice === undefined ? {} : { actionNotice })}
        {...(actionMutation.error === null
          ? {}
          : { actionError: actionMutation.error.message })}
        onCancel={() => void actionMutation.mutateAsync("cancel")}
        onRetry={() => void actionMutation.mutateAsync("retry")}
        onGc={() => void actionMutation.mutateAsync("gc")}
      />

      <Tabs
        value={activeView}
        onValueChange={(value) => setActiveView(value as RunPageView)}
        className="min-w-0"
      >
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          {pageTabs.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="workflow" className="min-w-0 overflow-hidden">
          <RunPipelineView
            detail={detail}
            onSelectUnit={(unitId) =>
              navigate(hrefForJob(detail.run.runId, unitId))
            }
          />
        </TabsContent>

        <TabsContent value="timeline" className="min-w-0">
          <RunTimeline events={detail.events} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

const eventDataHasRunId = (event: MessageEvent<string>, runId: string) => {
  try {
    const payload = JSON.parse(event.data) as { readonly runId?: unknown }
    return payload.runId === runId
  } catch {
    return false
  }
}
