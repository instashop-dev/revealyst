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
    triggers: { crons: string[] };
    queues: {
      producers: { binding: string; queue: string }[];
      consumers: {
        queue: string;
        max_batch_size?: number;
        max_batch_timeout?: number;
        max_retries?: number;
        dead_letter_queue?: string;
      }[];
    };
    observability?: { enabled: boolean };
  };
}

describe("wrangler.jsonc", () => {
  const config = readWranglerConfig();

  it("points at the custom worker entrypoint", () => {
    expect(config.main).toBe("src/worker.ts");
  });

  it("has a cron trigger for the poller", () => {
    expect(config.triggers.crons.length).toBeGreaterThan(0);
  });

  it("produces to and consumes from the same poll queue", () => {
    const producer = config.queues.producers.find(
      (p) => p.binding === "POLL_QUEUE",
    );
    expect(producer).toBeDefined();
    expect(
      config.queues.consumers.some((c) => c.queue === producer?.queue),
    ).toBe(true);
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

  it("keeps the poll consumer's retry + batch tuning (ADR 0006)", () => {
    const poll = config.queues.consumers.find(
      (c) => c.queue === "revealyst-poll",
    );
    expect(poll).toBeDefined();
    // The default of 3 dropped a backfill chain link after ~3.5 min; 10
    // retries × exponential backoff rides out multi-hour outages.
    expect(poll?.max_retries).toBe(10);
    expect(poll?.max_batch_size).toBe(10);
    expect(poll?.max_batch_timeout).toBe(5);
  });

  it("dead-letters exhausted poll messages to a DLQ the worker consumes", () => {
    const poll = config.queues.consumers.find(
      (c) => c.queue === "revealyst-poll",
    );
    // Routed to the DLQ instead of silently dropped after the last retry…
    expect(poll?.dead_letter_queue).toBe("revealyst-poll-dlq");
    // …and the DLQ is actually consumed (src/worker.ts logs + acks it),
    // otherwise dead-lettered messages just pile up unseen.
    expect(
      config.queues.consumers.some((c) => c.queue === "revealyst-poll-dlq"),
    ).toBe(true);
  });

  it("enables Workers observability so poll/DLQ logs are durable", () => {
    expect(config.observability?.enabled).toBe(true);
  });
});
