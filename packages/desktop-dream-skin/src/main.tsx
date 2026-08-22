import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/app/theme-provider"
import { DesktopShell } from "@/components/app/shell"
import "./styles.css"

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <ThemeProvider>
      <DesktopShell />
    </ThemeProvider>
  </StrictMode>,
)
