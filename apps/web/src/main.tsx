import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installConsoleCapture } from "./lib/diagnostics";
import "./styles.css";

// First thing, before anything else logs: mirror console output into the diagnostics buffer so a
// student can copy it back when something goes wrong. In memory only; see lib/diagnostics.ts.
installConsoleCapture();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
