import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RedesignApp } from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RedesignApp />
  </StrictMode>
);
