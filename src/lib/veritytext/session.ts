// In-memory session store with a 1-hour TTL. Cleaned up on every access.
// Sessions are never written to disk. Opt-in history rows live in Postgres
// (see history.ts); that is the only place a document can outlive its TTL.
//
// IMPORTANT: we stash the Map on `globalThis` so it survives Next.js dev
// hot-reloads and is shared across all route handlers (which may be bundled
// into separate module instances by Turbopack).
import { type DetectionReport } from "./detector/types";

export interface Session {
  id: string;
  createdAt: number;
  lastAccessedAt: number;
  filename: string;
  fileType: ".docx" | ".pdf" | ".txt";
  fileSize: number;
  originalText: string;
  extractedLength: number;
  report?: DetectionReport;
  humanizedText?: string;
  humanizedReport?: DetectionReport;
  humanizeMeta?: {
    strength: "light" | "balanced" | "strong";
    tone: string;
    preserve: string[];
    warning?: string;
    error?: string;
    reHumanized?: boolean;
  };
  /** True when this session has an opt-in row in the history database. */
  historySaved?: boolean;
  /** Anonymous owner cookie value that owns the history row. */
  historyOwnerId?: string;
}

const TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_SESSIONS = 100; // safety cap

type SessionMap = Map<string, Session>;

const globalForSessions =
  globalThis as unknown as { __veritySessions?: SessionMap };

const store: SessionMap =
  globalForSessions.__veritySessions ?? new Map<string, Session>();

if (!globalForSessions.__veritySessions) {
  globalForSessions.__veritySessions = store;
}

export function createSession(
  data: Omit<Session, "id" | "createdAt" | "lastAccessedAt">,
): Session {
  cleanup();
  const id = crypto.randomUUID();
  const now = Date.now();
  const session: Session = {
    ...data,
    id,
    createdAt: now,
    lastAccessedAt: now,
  };
  store.set(id, session);
  evictIfNeeded();
  return session;
}

/**
 * Insert a fully-formed session (e.g. restored from the history database)
 * without generating a new ID.
 */
export function insertSession(session: Session): Session {
  cleanup();
  session.lastAccessedAt = Date.now();
  store.set(session.id, session);
  evictIfNeeded();
  return session;
}

function evictIfNeeded(): void {
  // Evict oldest if we're over the cap.
  if (store.size <= MAX_SESSIONS) return;
  let oldest: string | null = null;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (const [sid, s] of store) {
    if (s.lastAccessedAt < oldestTime) {
      oldestTime = s.lastAccessedAt;
      oldest = sid;
    }
  }
  if (oldest) store.delete(oldest);
}

export function getSession(id: string): Session | null {
  cleanup();
  const s = store.get(id);
  if (!s) return null;
  if (Date.now() - s.lastAccessedAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  s.lastAccessedAt = Date.now();
  return s;
}

export function updateSession(
  id: string,
  patch: Partial<Session>,
): Session | null {
  const s = getSession(id);
  if (!s) return null;
  Object.assign(s, patch);
  s.lastAccessedAt = Date.now();
  store.set(id, s);
  return s;
}

export function deleteSession(id: string): void {
  store.delete(id);
}

export function cleanup(): void {
  const now = Date.now();
  for (const [id, s] of store) {
    if (now - s.lastAccessedAt > TTL_MS) {
      store.delete(id);
    }
  }
}

export function sessionCount(): number {
  return store.size;
}
