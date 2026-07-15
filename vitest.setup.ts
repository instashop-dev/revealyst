import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

import "@testing-library/jest-dom/vitest";

// T2.6 item 7 — a11y smoke harness: vitest-axe (Vitest-native, not jest-axe)
// wired via expect.extend rather than its "extend-expect" auto-import, so
// the matcher type augmentation is explicit and visible here.
import * as axeMatchers from "vitest-axe/matchers";
import type { AxeMatchers } from "vitest-axe/matchers";

expect.extend(axeMatchers);

declare module "vitest" {
  interface Assertion extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

// RTL's own auto-cleanup only self-registers when it detects a global
// `afterEach` (i.e. `test.globals: true`); this repo doesn't enable globals
// for the existing node-environment suites, so component tests need this
// explicit unmount+DOM cleanup between cases — Base UI portals content into
// `document.body`, which otherwise accumulates across tests in the same file.
afterEach(() => {
  cleanup();
});
