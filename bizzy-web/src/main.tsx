import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { ThemeService } from "./features/theme/theme.service";
import { configureAmplify } from "./core/config/amplify.config";

configureAmplify();
ThemeService.init();
const router = getRouter();

const rootElement = document.getElementById("app");
if (!rootElement) {
  throw new Error("Root element #app not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
