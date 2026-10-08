import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH setzt nur der GitHub-Pages-Workflow (/solar_risch/);
// Infomaniak und lokal laufen im Domain-Root.
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
});
