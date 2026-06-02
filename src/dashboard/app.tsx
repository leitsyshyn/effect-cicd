import { TooltipProvider } from "./components/ui/tooltip.tsx"
import { AppShell } from "./components/app-shell.tsx"
import { createDashboardApi } from "./api.ts"
import { parseDashboardRoute, type DashboardNavigate } from "./lib/routing.ts"
import { RunPage } from "./views/run-page.tsx"
import { RunsPage } from "./views/runs-page.tsx"
import { startTransition, useEffect, useState } from "react"

const api = createDashboardApi()

const currentLocation = () => ({
  pathname: window.location.pathname,
  search: window.location.search,
})

export function App() {
  const [location, setLocation] = useState(currentLocation)
  const [serviceVersion, setServiceVersion] = useState<string>()

  useEffect(() => {
    document.documentElement.classList.add("dark")

    const onPopState = () => {
      startTransition(() => setLocation(currentLocation()))
    }

    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  useEffect(() => {
    void api.getVersion().then(setServiceVersion).catch(() => undefined)
  }, [])

  const navigate: DashboardNavigate = (href, options) => {
    if (options?.replace === true) {
      window.history.replaceState(null, "", href)
    } else {
      window.history.pushState(null, "", href)
    }

    startTransition(() => setLocation(currentLocation()))
  }

  const route = parseDashboardRoute(location.pathname, location.search)

  return (
    <TooltipProvider>
      <AppShell {...(serviceVersion === undefined ? {} : { serviceVersion })} onRefresh={() => window.location.reload()}>
        {route._tag === "RunsRoute" ? (
          <RunsPage api={api} navigate={navigate} />
        ) : (
          <RunPage api={api} navigate={navigate} route={route} />
        )}
      </AppShell>
    </TooltipProvider>
  )
}
