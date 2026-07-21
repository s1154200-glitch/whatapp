import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/whatapp/" : "/",
  plugins: [react()],
  publicDir: "public",
  build: {
    outDir: "pages-dist",
    emptyOutDir: true,
  },
});
