import { createRoot } from "react-dom/client";
import App from "./App";
import { GlossProvider } from "./Gloss";
import "./style.css";
import { AppErrorBoundary } from "./AppErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <GlossProvider>
      <App />
    </GlossProvider>
  </AppErrorBoundary>,
);
