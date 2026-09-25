import { defineConfig } from "vite";

// macOS fsevents has been flaking out and silently missing file-save events
// (HMR just goes quiet, no reload). Polling sidesteps it entirely; CPU cost
// doesn't matter for a project this size.
export default defineConfig({
  server: {
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});
