import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { installGlobalErrorLogging } from "./lib/clientErrorLogging";
import "./index.css";

// Covers uncaught JS errors / unhandled promise rejections app-wide — the
// failure modes ErrorBoundary.tsx (a React render-crash catcher) can't see.
installGlobalErrorLogging();

createRoot(document.getElementById("root")!).render(<App />);
