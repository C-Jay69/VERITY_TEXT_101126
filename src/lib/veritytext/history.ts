// Opt-in history persistence (Postgres via Prisma).
//
// History is strictly opt-in: nothing is written unless the upload request
// carries `saveHistory=true`. Rows are scoped to an anonymous owner ID stored
// in an httpOnly cookie, so history is visible only to the browser that created
// it. When DATABASE_URL is absent (or is not a Postgres URL), every helper here
// degrades to a no-op / "not configured" answer instead of throwing.
import type { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  type Session,
  insertSession,
  getSession,
} from "./session";
import type { DetectionReport } from "./detector/types";

export const HISTORY_COOKIE = "veritytext_owner";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
const APP_SCHEMA_URL = /^postgres(ql)?:\/\//i;

export function historyConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return Boolean(url && APP_SCHEMA_URL.test(url));
}

export function getOwnerId(req: NextRequest): string | null {
  const value = req.cookies.get(HISTORY_COOKIE)?.value?.trim();
  // Only accept values we generated (UUID v4 shape) to avoid header injection
  // or unbounded query keys from a forged cookie.
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function newOwnerId(): string {
  return crypto.randomUUID();
}

export function attachOwnerCookie(res: NextResponse, ownerId: string): void {
  res.cookies.set(HISTORY_COOKIE, ownerId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** Create or replace the history row for a session. Throws on DB failure. */
export async function saveHistory(session: Session, ownerId: string): Promise<void> {
  const report = session.report;
  if (!report) throw new Error("Cannot save a session without a detection report.");

  await db.historySession.upsert({
    where: { id: session.id },
    create: {
      id: session.id,
      ownerId,
      filename: session.filename,
      fileType: session.fileType,
      fileSize: session.fileSize,
      extractedLength: session.extractedLength,
      wordCount: report.meta.wordCount,
      originalText: session.originalText,
      humanizedText: session.humanizedText ?? null,
      aiProbability: report.aggregate.aiProbability,
      verdict: report.aggregate.verdict,
      band: report.aggregate.band,
      confidence: report.aggregate.confidence,
      reportJson: json(report),
      humanizedReportJson: session.humanizedReport
        ? json(session.humanizedReport)
        : null,
      humanizeMetaJson: session.humanizeMeta ? json(session.humanizeMeta) : null,
      hasHumanized: Boolean(session.humanizedText),
      humanizedScore: session.humanizedReport?.aggregate.aiProbability ?? null,
    },
    update: {
      filename: session.filename,
      fileType: session.fileType,
      fileSize: session.fileSize,
      extractedLength: session.extractedLength,
      wordCount: report.meta.wordCount,
      originalText: session.originalText,
      humanizedText: session.humanizedText ?? null,
      aiProbability: report.aggregate.aiProbability,
      verdict: report.aggregate.verdict,
      band: report.aggregate.band,
      confidence: report.aggregate.confidence,
      reportJson: json(report),
      humanizedReportJson: session.humanizedReport
        ? json(session.humanizedReport)
        : null,
      humanizeMetaJson: session.humanizeMeta ? json(session.humanizeMeta) : null,
      hasHumanized: Boolean(session.humanizedText),
      humanizedScore: session.humanizedReport?.aggregate.aiProbability ?? null,
    },
  });
}

/**
 * Copy a session's current humanized state into its history row. No-op if the
 * session was never saved. Never throws — a database hiccup must not fail the
 * humanizer response.
 */
export async function syncHistory(session: Session): Promise<boolean> {
  if (!session.historySaved) return false;
  try {
    await db.historySession.update({
      where: { id: session.id },
      data: {
        humanizedText: session.humanizedText ?? null,
        humanizedReportJson: session.humanizedReport
          ? json(session.humanizedReport)
          : null,
        humanizeMetaJson: session.humanizeMeta ? json(session.humanizeMeta) : null,
        hasHumanized: Boolean(session.humanizedText),
        humanizedScore: session.humanizedReport?.aggregate.aiProbability ?? null,
      },
    });
    return true;
  } catch (err) {
    // P2025 = row deleted while the session was still in memory.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")) {
      console.error("[veritytext] history sync failed:", err);
    }
    return false;
  }
}

export interface HistoryListItem {
  id: string;
  filename: string;
  fileType: string;
  aiProbability: number;
  verdict: string;
  band: string;
  confidence: number;
  hasHumanized: boolean;
  humanizedScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export async function listHistory(
  ownerId: string,
  limit = 20,
): Promise<HistoryListItem[]> {
  const rows = await db.historySession.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      filename: true,
      fileType: true,
      aiProbability: true,
      verdict: true,
      band: true,
      confidence: true,
      hasHumanized: true,
      humanizedScore: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function deleteHistory(
  id: string,
  ownerId: string,
): Promise<boolean> {
  const result = await db.historySession.deleteMany({ where: { id, ownerId } });
  return result.count > 0;
}

function parseReport(value: string): DetectionReport {
  return JSON.parse(value) as DetectionReport;
}

/**
 * Load a history row into the in-memory session store (if not already there)
 * and return the session. Returns null when the row does not belong to the
 * owner.
 */
export async function restoreHistory(
  id: string,
  ownerId: string,
): Promise<Session | null> {
  const existing = getSession(id);
  if (existing) {
    // Only return a live session that was itself saved to history and belongs
    // to this caller. Plain in-memory sessions (history off) are not reachable
    // through the history API, even if their ID is known.
    if (!existing.historySaved || existing.historyOwnerId !== ownerId) {
      return null;
    }
    return existing;
  }

  const row = await db.historySession.findFirst({ where: { id, ownerId } });
  if (!row) return null;

  const report = parseReport(row.reportJson);
  const session: Session = {
    id: row.id,
    createdAt: row.createdAt.getTime(),
    lastAccessedAt: Date.now(),
    filename: row.filename,
    fileType: row.fileType as Session["fileType"],
    fileSize: row.fileSize,
    originalText: row.originalText,
    extractedLength: row.extractedLength,
    report,
    humanizedText: row.humanizedText ?? undefined,
    humanizedReport: row.humanizedReportJson
      ? parseReport(row.humanizedReportJson)
      : undefined,
    humanizeMeta: row.humanizeMetaJson
      ? (JSON.parse(row.humanizeMetaJson) as Session["humanizeMeta"])
      : undefined,
    historySaved: true,
    historyOwnerId: row.ownerId,
  };
  return insertSession(session);
}
