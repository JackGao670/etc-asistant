import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: resolve("dist/webview"), emptyOutDir: true, minify: true,
    lib: { entry: resolve("webview/src/App.tsx"), formats: ["es"], fileName: () => "app.js", cssFileName: "app" },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
});
