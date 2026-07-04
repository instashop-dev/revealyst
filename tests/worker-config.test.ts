import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards the deploy-critical bits of wrangler.jsonc: losing nodejs_compat or
// the OpenNext entrypoint breaks the Workers build in ways local `next dev`
// never surfaces.
function readWranglerConfig() {
  const jsonc = readFileSync("wrangler.jsonc", "utf8");
  const withoutComments = jsonc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(withoutComments) as {
    name: string;
    main: string;
    compatibility_flags: string[];
    services: { binding: string; service: string }[];
  };
}

describe("wrangler.jsonc", () => {
  const config = readWranglerConfig();

  it("points at the OpenNext worker entrypoint", () => {
    expect(config.main).toBe(".open-next/worker.js");
  });

  it("keeps nodejs_compat enabled", () => {
    expect(config.compatibility_flags).toContain("nodejs_compat");
  });

  it("self-reference service binding matches the worker name", () => {
    const self = config.services.find(
      (s) => s.binding === "WORKER_SELF_REFERENCE",
    );
    expect(self?.service).toBe(config.name);
  });
});
