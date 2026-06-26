import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "file-protocol-html",
      transformIndexHtml(html) {
        return html.replaceAll(" crossorigin", "");
      }
    }
  ]
});
