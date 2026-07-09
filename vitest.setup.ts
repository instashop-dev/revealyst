import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// RTL's own auto-cleanup only self-registers when it detects a global
// `afterEach` (i.e. `test.globals: true`); this repo doesn't enable globals
// for the existing node-environment suites, so component tests need this
// explicit unmount+DOM cleanup between cases — Base UI portals content into
// `document.body`, which otherwise accumulates across tests in the same file.
afterEach(() => {
  cleanup();
});
