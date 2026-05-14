import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  publicDir: "../assets",
  build: {
    outDir: "../dist/public",
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
});
