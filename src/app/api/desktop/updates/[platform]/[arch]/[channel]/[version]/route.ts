import {
  DESKTOP_RELEASES,
  DESKTOP_UPDATE_CHANNELS,
  selectUpdate,
  type DesktopUpdateChannel,
} from "@/lib/desktop-releases";

// GET /api/desktop/updates/:platform/:arch/:channel/:version (Desktop Agent
// plan T6.1, spec §18) — the dynamic Tauri update endpoint. The agent's
// updater substitutes {{target}} → :platform, {{arch}} → :arch, and
// {{current_version}} → :version; the channel comes from the agent's signed
// config (T4.2) and is baked into the endpoint URL it builds.
//
// UNAUTHENTICATED — deliberately. The updater checks on startup and every six
// hours (spec §18.3), often BEFORE the device is enrolled, so a device-token
// gate would break first-run updates. Safe because the response is a pure
// directory of PUBLIC, signed release artifacts: no session, no db read, no
// per-user data, no counts, nothing enumerable about anyone. Trust does not
// rest on this transport — the agent verifies the downloaded artifact's
// signature against its baked-in updater public key (spec §29). There is
// therefore nothing to leak and no getApiContext/db connection to open.
//
// Staged rollout (spec §18.4): the deterministic cohort gate lives in
// `selectUpdate`; the caller's installationId arrives in a header (never the
// URL — a partial-rollout decision needs it, and query/path params are the
// wrong place for a stable device id). A caller outside the current cohort, or
// with no newer release, gets 204 No Content — which the Tauri updater reads as
// "no update available".

export const dynamic = "force-dynamic";

/** Header carrying the agent's stable installation id for cohort bucketing.
 * The agent sets it on its updater request; absent → treated as outside any
 * partial rollout (fail-closed in `isInRollout`). */
const INSTALLATION_ID_HEADER = "x-revealyst-installation-id";

function isChannel(value: string): value is DesktopUpdateChannel {
  return (DESKTOP_UPDATE_CHANNELS as readonly string[]).includes(value);
}

const noUpdate = () => new Response(null, { status: 204 });

export async function GET(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      platform: string;
      arch: string;
      channel: string;
      version: string;
    }>;
  },
) {
  const { platform, arch, channel, version } = await params;

  // An unknown channel is not a partial match — serve "no update" rather than
  // guessing a channel, so a typo can never cross-serve a release.
  if (!isChannel(channel)) return noUpdate();

  const installationId = req.headers.get(INSTALLATION_ID_HEADER);

  const manifest = selectUpdate({
    channel,
    platform,
    arch,
    currentVersion: version,
    installationId: installationId && installationId.length > 0 ? installationId : null,
    releases: DESKTOP_RELEASES,
  });

  if (!manifest) return noUpdate();
  return Response.json(manifest, { status: 200 });
}
