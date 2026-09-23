import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every test file here shares one live Postgres database with no per-test transactional
    // isolation (tests write real rows and clean up with beforeAll/afterAll/afterEach). Running
    // files in parallel lets one file's writes be visible to another's assertions mid-run — e.g.
    // dataQuality.test.ts asserting the jute-ledger tables are empty while juteLedger.test.ts is
    // mid-write to them in a different worker. Sequential execution is the correct default for an
    // integration suite shaped like this one; the suite is small enough that the runtime cost is
    // negligible.
    fileParallelism: false,
  },
});
