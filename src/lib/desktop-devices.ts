import type { OrgScopedDb } from "../db/org-scope";
import { ApiError } from "./api-impl";

// Desktop-device management (Desktop Agent plan T2.4, spec §24.2) on the
// EXISTING device machinery — a device is a `connections` row minted by the
// T2.2 pairing exchange (vendor claude_code_local, authKind device_token,
// config.pairedByUserId = the consenting member). No new table.
//
// SELF-VIEW DISCIPLINE (D-DA-2, spec §27.4): a member manages only their OWN
// devices. The list is filtered to config.pairedByUserId === the signed-in
// user, and rename/revoke re-check that ownership server-side. A manager/admin
// never sees another member's named device here. (Device pairing is
// Personal-orgs-only today, and a personal org is an org of one, so there is
// no other member whose devices could appear — the count-only admin summary
// the plan sketches is deliberately NOT built: it would be dead UI for the
// only orgs that can hold devices, and team-org devices are gated on T5.1.)

/** The frozen vendor id for a desktop-agent device connection (ADR 0002/0047).
 * The single value that marks a `connections` row as a managed device. */
export const DEVICE_VENDOR = "claude_code_local";

/** The credential kind a device authenticates with (destroyed on revoke). */
const DEVICE_CREDENTIAL_KIND = "device_token" as const;

/** A device connection's `config` jsonb is untyped at the column; read it
 * defensively as a plain record. */
function readConfig(config: unknown): Record<string, unknown> {
  return config && typeof config === "object"
    ? (config as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The `connections.list()` row shape this module reads — only the fields a
 * device view needs, so it accepts any superset (the full row). */
export type DeviceConnectionRow = {
  id: string;
  vendor: string;
  displayName: string;
  status: string;
  config: unknown;
  createdAt: Date;
};

/** A device as rendered on the Settings → Devices surface. Counts + labels
 * only — never activity content. */
export type DeviceView = {
  id: string;
  name: string;
  platform: string | null;
  agentVersion: string | null;
  /** ISO timestamp of the last heartbeat, or null if the device has not yet
   * checked in since enrollment. */
  lastHeartbeatAt: string | null;
  /** ISO enrollment timestamp (the connection's createdAt). */
  enrolledAt: string;
  /** Diagnostic count of events waiting to sync at the last heartbeat, or null
   * if never reported. */
  queueDepth: number | null;
  /** True once the device has been revoked (connection paused). */
  revoked: boolean;
};

/**
 * The signed-in user's own device connections. Pure — filters a pre-fetched
 * `connections.list()` to desktop devices this user paired. The two predicates
 * (vendor + owner) are the self-view boundary.
 */
export function ownDevices<T extends DeviceConnectionRow>(
  connections: readonly T[],
  userId: string,
): T[] {
  return connections.filter(
    (c) =>
      c.vendor === DEVICE_VENDOR &&
      readConfig(c.config).pairedByUserId === userId,
  );
}

/** Pure row → view mapper. Reads the display-only fields the heartbeat and
 * pairing stamped into `config`. */
export function toDeviceView(connection: DeviceConnectionRow): DeviceView {
  const config = readConfig(connection.config);
  const queueDepth = config.queueDepth;
  return {
    id: connection.id,
    name: connection.displayName,
    platform: stringOrNull(config.platform),
    agentVersion: stringOrNull(config.agentVersion),
    lastHeartbeatAt: stringOrNull(config.lastHeartbeatAt),
    enrolledAt: connection.createdAt.toISOString(),
    queueDepth: typeof queueDepth === "number" ? queueDepth : null,
    revoked: connection.status === "paused",
  };
}

/** Fetch a device this user owns, or throw a 404 (never leak whether the id
 * exists in another org / belongs to another member). */
async function requireOwnedDevice(
  scope: OrgScopedDb,
  deviceId: string,
  userId: string,
) {
  const connection = await scope.connections.get(deviceId);
  if (
    !connection ||
    connection.vendor !== DEVICE_VENDOR ||
    readConfig(connection.config).pairedByUserId !== userId
  ) {
    throw new ApiError(404, "device not found");
  }
  return connection;
}

/**
 * Rename a device the signed-in user owns (persists via connections.update).
 * Ownership re-checked server-side; a foreign/unknown device is a 404.
 */
export async function renameDevice(
  scope: OrgScopedDb,
  input: { deviceId: string; userId: string; name: string },
): Promise<{ ok: true; name: string }> {
  await requireOwnedDevice(scope, input.deviceId, input.userId);
  const name = input.name.trim();
  await scope.connections.update(input.deviceId, { displayName: name });
  await scope.auditLog.record({
    actorUserId: input.userId,
    action: "desktop.device_rename",
    targetKind: "connection",
    targetId: input.deviceId,
    metadata: { deviceDisplayName: name },
  });
  return { ok: true, name };
}

/**
 * Revoke a device the signed-in user owns: PAUSE the connection AND DESTROY its
 * device_token credential (spec §27.4, plan T2.4). Pausing alone would make
 * the verifier answer 403 to the old token; deleting the credential is the
 * clean-slate revocation the plan specifies — the device must re-pair, it can
 * never un-pause back into service. §27.4: revoking THIS device pauses only
 * this connection, so every other enrolled device keeps authenticating.
 * Ownership re-checked server-side; a foreign/unknown device is a 404.
 */
export async function revokeDevice(
  scope: OrgScopedDb,
  input: { deviceId: string; userId: string },
): Promise<{ ok: true }> {
  const connection = await requireOwnedDevice(
    scope,
    input.deviceId,
    input.userId,
  );
  await scope.connections.update(input.deviceId, { status: "paused" });
  await scope.connections.deleteCredential(
    input.deviceId,
    DEVICE_CREDENTIAL_KIND,
  );
  await scope.auditLog.record({
    actorUserId: input.userId,
    action: "desktop.device_revoke",
    targetKind: "connection",
    targetId: input.deviceId,
    metadata: { deviceDisplayName: connection.displayName },
  });
  return { ok: true };
}
