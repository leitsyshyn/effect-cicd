import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./app.tsx"

const container = document.getElementById("root")

if (container === null) {
  throw new Error("Dashboard root element not found")
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
