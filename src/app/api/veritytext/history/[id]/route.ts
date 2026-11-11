// DELETE /api/veritytext/history/[id]
// Permanently deletes one history row owned by the caller's cookie.
import { NextRequest, NextResponse } from "next/server";
import {
  deleteHistory,
  getOwnerId,
  historyConfigured,
} from "@/lib/veritytext/history";
import { deleteSession } from "@/lib/veritytext/session";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!historyConfigured()) {
    return NextResponse.json(
      { error: "History is not configured on this server." },
      { status: 503 },
    );
  }
  const ownerId = getOwnerId(req);
  if (!ownerId) {
    return NextResponse.json({ error: "History entry not found." }, { status: 404 });
  }

  try {
    const { id } = await params;
    const deleted = await deleteHistory(id, ownerId);
    if (!deleted) {
      return NextResponse.json(
        { error: "History entry not found." },
        { status: 404 },
      );
    }
    // Drop the in-memory copy too, so a deleted entry cannot be reopened from
    // a session that was restored earlier in this process.
    deleteSession(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[veritytext] history delete failed:", err);
    return NextResponse.json(
      { error: "Could not delete the history entry." },
      { status: 503 },
    );
  }
}
