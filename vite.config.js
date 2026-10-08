import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH und NOINDEX setzt nur der GitHub-Pages-Workflow: Die Vorschau
// liegt unter /solar_risch/ und soll nicht in Suchmaschinen auftauchen.
// Infomaniak und lokal laufen im Domain-Root, normal indexierbar.
const noindex = {
  name: "noindex",
  transformIndexHtml: (html) =>
    process.env.NOINDEX
      ? html.replace("</head>", '  <meta name="robots" content="noindex, nofollow" />\n  </head>')
      : html,
};

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react(), noindex],
});
