import { createRoot } from "react-dom/client";
import App from "./App";
import { GlossProvider } from "./Gloss";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <GlossProvider>
    <App />
  </GlossProvider>,
);
