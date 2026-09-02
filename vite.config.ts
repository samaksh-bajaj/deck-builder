/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Tests are offline and never touch the DOM; the browser bundle does no
    // computation, so there is nothing component-shaped to render yet.
    environment: "node",
    include: ["shared/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
