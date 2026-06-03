import { useQueryClient, type QueryKey } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { useEventStream } from "./use-event-stream.ts"

export function useStreamQueryRefresh(
  url: string,
  queryKey: QueryKey,
  eventName = "message",
  shouldRefresh?: (event: MessageEvent<string>) => boolean,
) {
  const queryClient = useQueryClient()
  const isMountedRef = useRef(true)
  const isRefreshingRef = useRef(false)
  const refreshQueuedRef = useRef(false)

  useEffect(() => {
    // Reset on setup as well as clear on cleanup: under StrictMode the effect
    // runs setup -> cleanup -> setup on mount, and the ref persists across that
    // simulated remount. Without this line the cleanup leaves isMountedRef false
    // forever, so every SSE-triggered refresh below silently bails (dev only).
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEventStream(
    url,
    (event) => {
      if (shouldRefresh !== undefined && !shouldRefresh(event)) {
        return
      }

      refreshQueuedRef.current = true
      if (isRefreshingRef.current) {
        return
      }

      const refresh = async () => {
        if (!isMountedRef.current) {
          return
        }

        isRefreshingRef.current = true

        try {
          do {
            refreshQueuedRef.current = false

            try {
              await queryClient.invalidateQueries({
                queryKey,
                exact: true,
                refetchType: "active",
              })
            } catch {
              // The mounted query owns error presentation. Avoid surfacing the
              // background invalidation as a global unhandled rejection.
            }
          } while (refreshQueuedRef.current && isMountedRef.current)
        } finally {
          isRefreshingRef.current = false

          if (refreshQueuedRef.current && isMountedRef.current) {
            void refresh()
          }
        }
      }

      void refresh()
    },
    eventName,
  )
}
