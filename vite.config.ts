import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
    // The Lovable editor needs its script in the page while editing. It is added by the
    // dev server only, so the published site does not load a third-party script for it.
    {
      name: "lovable-editor-script",
      apply: "serve" as const,
      transformIndexHtml: () => [
        { tag: "script", attrs: { type: "module", src: "https://cdn.gpteng.co/gptengineer.js" }, injectTo: "body" as const },
      ],
    },
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: cached separately from app code between deploys.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          motion: ["framer-motion"],
        },
      },
    },
  },
}));
