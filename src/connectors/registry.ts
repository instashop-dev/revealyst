import type { Connector } from "../contracts/connector";
import type { VendorId } from "../contracts/attribution";

// W1-D connector registry: maps a connection's vendor id to its connector
// module + the framework-level polling facts the dispatcher needs (facts
// live here, not on the frozen Connector interface, so adding one is not a
// contract change). Vendor modules self-register at import time via
// src/connectors/index.ts; tests may register fakes.

export type RegisteredConnector = {
  connector: Connector;
  /**
   * Module id+version stamped on every metric_record it produces, e.g.
   * 'anthropic-console@1' — survives connection deletion (schema comment).
   * Bump the version when normalize() semantics change.
   */
  sourceConnector: string;
  /**
   * Upper bound of vendor API calls needed to cover ONE day of one
   * connection (worst-case pagination included). Backfill chunk sizing
   * derives from this — see src/poller/backfill.ts — so the wall-time
   * budget is enforced by construction, per vendor.
   */
  maxCallsPerDay: number;
  /**
   * Minimum minutes between regular polls of one connection (per-vendor
   * rate courtesy; e.g. Anthropic documents "poll once per minute" for
   * sustained use — hourly is far inside that).
   */
  pollIntervalMinutes: number;
};

const registry = new Map<string, RegisteredConnector>();

export function registerConnector(entry: RegisteredConnector): void {
  registry.set(entry.connector.vendor, entry);
}

export function getConnector(vendor: string): RegisteredConnector | undefined {
  return registry.get(vendor);
}

export function registeredVendors(): VendorId[] {
  return [...registry.keys()] as VendorId[];
}

/** Test seam: clears fakes between suites. Never called in production. */
export function clearRegistryForTests(): void {
  registry.clear();
}
