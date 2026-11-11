// GET /api/veritytext/history
// Lists opt-in history rows belonging to the caller's anonymous owner cookie.
// Returns 200 with `enabled: false` when the database is not configured, so the
// UI can hide the section without treating it as an error.
import { NextRequest, NextResponse } from "next/server";
import {
  getOwnerId,
  historyConfigured,
  listHistory,
} from "@/lib/veritytext/history";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!historyConfigured()) {
    return NextResponse.json({
      enabled: false,
      items: [],
      reason:
        "History is not configured on this server. Set DATABASE_URL to a Postgres database to enable it.",
    });
  }

  const ownerId = getOwnerId(req);
  if (!ownerId) {
    // No cookie means this browser has never opted in to history.
    return NextResponse.json({ enabled: true, items: [] });
  }

  try {
    const items = await listHistory(ownerId);
    return NextResponse.json({ enabled: true, items });
  } catch (err) {
    console.error("[veritytext] history list failed:", err);
    return NextResponse.json({
      enabled: false,
      items: [],
      reason: "The history database is unavailable right now.",
    });
  }
}
