import { defineConfig } from "vitest/config";

// The frontend's first tests (26 Nov 2026): pure table logic (paging, column filters), so no DOM and no React plugin needed.
export default defineConfig({ test: { include: ["src/**/*.test.ts"], environment: "node" } });
