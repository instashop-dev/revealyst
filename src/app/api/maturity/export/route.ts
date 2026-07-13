import { NextResponse } from "next/server";
import { handleApi } from "@/lib/api-route";
import { readMaturityView } from "@/lib/maturity";
import { maturityCsvFilename, maturityViewToCsv } from "@/lib/maturity-csv";

// W5-H deliverable 4: board-ready CSV export of the eight maturity numbers.
// Routed through `handleApi` like every data route, so the free-band paywall
// (402) applies — a board export is NOT exempt. Zero new queries: it reads the
// SAME `readMaturityView` the /maturity page renders and serializes it in JS.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return handleApi(async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const view = await readMaturityView(ctx.scope, today);
    const csv = maturityViewToCsv(view);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${maturityCsvFilename(view)}"`,
        // Board numbers shift with each nightly recompute — never cache.
        "Cache-Control": "no-store",
      },
    });
  });
}
