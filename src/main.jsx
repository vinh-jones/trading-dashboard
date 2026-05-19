import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AuthGate } from "./components/AuthGate.jsx";
import { applyAuthCookie, installFetchInterceptor } from "./lib/auth.js";

installFetchInterceptor();
applyAuthCookie();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>
);
