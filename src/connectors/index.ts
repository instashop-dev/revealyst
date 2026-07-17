// Vendor module registration. The polled admin-API connectors (Anthropic
// Console, OpenAI, Cursor, GitHub Copilot) were REMOVED when Revealyst pivoted
// to the desktop-agent usage-source model (ADR 0054): behavioral signal lives
// inside the AI tools and is captured by the device/agent push path
// (/api/agent/ingest, /v1/metrics), not by polling vendor APIs. The registry
// is intentionally empty — `getConnector` returns undefined for every vendor,
// so the cron dispatcher enqueues no poll work and existing connector rows are
// frozen in place (no new data). Re-introducing a polled connector means
// re-adding its module here (and re-wiring the poll pipeline).
export {};
