import { ApiError, apiFetch } from "./api";
import type { AuthUser } from "../types/auth";

// Offline attendance (ATT-21): while the internet is down the kiosk keeps its captures here, in IndexedDB, encrypted with a
// per-device AES-GCM key (non-extractable CryptoKey), and sends them to the server when the connection returns.
// Nothing is verified on the device: liveness + face matching happen on the server after the sync (the images never leave
// the kiosk before that, and are deleted from the device as soon as the server confirms).

const DB_NAME = "school-kiosk";
const POOL_MIN = 60;       // refill the signed-challenge pool when fewer are left
const POOL_SIZE = 150;     // a school of ~60 staff needs about 120 captures for a day without internet
const BATCH = 5;

export interface ChallengeInfo { challenge: ("LEFT" | "RIGHT")[]; layout: number[]; token: string; source: "server" | "pool" }
interface PoolItem { challenge: ChallengeInfo["challenge"]; layout: number[]; token: string }
interface QueuedCapture {
  clientEventId: string; capturedAt: string; challengeToken: string; schoolId: number; userId: number;
  enc: { iv: Uint8Array; data: ArrayBuffer }; frames: number;
}
export interface SyncSummary { sent: number; accepted: number; review: number; rejected: number; remaining: number; error?: string }

// ---------------------------------------------------------------- IndexedDB helpers
let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("captures", { keyPath: "clientEventId" });
      db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function tx<T>(store: "captures" | "meta", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const metaGet = <T>(k: string) => tx<T | undefined>("meta", "readonly", (s) => s.get(k));
const metaSet = (k: string, v: unknown) => tx("meta", "readwrite", (s) => s.put(v, k));

// ---------------------------------------------------------------- encryption (per-device, non-extractable key)
async function deviceKey(): Promise<CryptoKey> {
  const existing = await metaGet<CryptoKey>("key");
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await metaSet("key", key);
  return key;
}
async function encryptJson(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deviceKey(), new TextEncoder().encode(JSON.stringify(value)));
  return { iv, data };
}
async function decryptJson<T>(enc: { iv: Uint8Array; data: ArrayBuffer }): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: enc.iv as BufferSource }, await deviceKey(), enc.data);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ---------------------------------------------------------------- queue
export async function enqueueCapture(frames: string[], challengeToken: string, user: AuthUser): Promise<string> {
  const clientEventId = crypto.randomUUID();
  const item: QueuedCapture = {
    clientEventId, capturedAt: new Date().toISOString(), challengeToken, schoolId: Number(user.schoolId), userId: Number(user.id),
    enc: await encryptJson(frames), frames: frames.length,
  };
  await tx("captures", "readwrite", (s) => s.put(item));
  return clientEventId;
}
async function allQueued(): Promise<QueuedCapture[]> {
  return tx<QueuedCapture[]>("captures", "readonly", (s) => s.getAll());
}
export async function pendingCount(schoolId?: number): Promise<number> {
  const all = await allQueued();
  return schoolId ? all.filter((c) => c.schoolId === schoolId).length : all.length;
}
const removeCapture = (id: string) => tx("captures", "readwrite", (s) => s.delete(id));

// ---------------------------------------------------------------- pool of server-signed liveness challenges (offline use)
function tokenExp(token: string): number {
  try { return (JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp: number }).exp * 1000; } catch { return 0; }
}
async function readPool(userId: number): Promise<PoolItem[]> {
  const p = await metaGet<{ userId: number; items: PoolItem[] }>("pool");
  if (!p || p.userId !== userId) return [];
  return p.items.filter((i) => tokenExp(i.token) > Date.now() + 60_000);
}
export async function poolSize(user: AuthUser): Promise<number> { return (await readPool(Number(user.id))).length; }

/** Online: top the pool up so the kiosk can keep working (and stay verifiable) through an outage of up to ~3 days. */
export async function refillPool(user: AuthUser): Promise<number> {
  const have = await readPool(Number(user.id));
  if (have.length >= POOL_MIN) return have.length;
  const r = await apiFetch<{ data: PoolItem[] }>(`/face/challenges?count=${POOL_SIZE - have.length}`);
  const items = [...have, ...r.data];
  await metaSet("pool", { userId: Number(user.id), items });
  return items.length;
}
export async function popChallenge(user: AuthUser): Promise<ChallengeInfo | null> {
  const items = await readPool(Number(user.id));
  const next = items.shift();
  await metaSet("pool", { userId: Number(user.id), items });
  return next ? { ...next, source: "pool" } : null;
}

// ---------------------------------------------------------------- kiosk session (so the kiosk survives a restart during an outage)
// Only restored when there is no network; the server token inside expires after 30 minutes anyway, so once the
// connection is back the user has to sign in again (the queue is not lost: it lives in IndexedDB).
export async function saveKioskSession(token: string, user: AuthUser) {
  await metaSet("session", { enc: await encryptJson({ token, user }) });
}
export async function restoreKioskSession(): Promise<{ token: string; user: AuthUser } | null> {
  try {
    const s = await metaGet<{ enc: { iv: Uint8Array; data: ArrayBuffer } }>("session");
    return s ? await decryptJson<{ token: string; user: AuthUser }>(s.enc) : null;
  } catch { return null; }
}
export async function clearKioskSession() {
  try { await tx("meta", "readwrite", (s) => s.delete("session")); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- sync
let syncing = false;
export async function syncQueue(user: AuthUser): Promise<SyncSummary> {
  const summary: SyncSummary = { sent: 0, accepted: 0, review: 0, rejected: 0, remaining: 0 };
  if (syncing) return { ...summary, remaining: await pendingCount(Number(user.schoolId)), error: "BUSY" };
  syncing = true;
  try {
    const mine = (await allQueued()).filter((c) => c.schoolId === Number(user.schoolId)).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    for (let i = 0; i < mine.length; i += BATCH) {
      const chunk = mine.slice(i, i + BATCH);
      const captures = await Promise.all(chunk.map(async (c) => ({
        clientEventId: c.clientEventId, capturedAt: c.capturedAt, challengeToken: c.challengeToken, frames: await decryptJson<string[]>(c.enc),
      })));
      try {
        const r = await apiFetch<{ data: { results: { clientEventId: string; status: "ACCEPTED" | "NEEDS_REVIEW" | "REJECTED" }[] } }>("/face/sync", {
          method: "POST", body: JSON.stringify({ deviceNow: new Date().toISOString(), captures }),
        });
        for (const res of r.data.results) {
          await removeCapture(res.clientEventId); // the server now owns it (accepted, in review, or refused for good)
          summary.sent++;
          if (res.status === "ACCEPTED") summary.accepted++;
          else if (res.status === "NEEDS_REVIEW") summary.review++;
          else summary.rejected++;
        }
      } catch (err) {
        summary.error = err instanceof ApiError ? (err.status === 0 ? "OFFLINE" : String(err.status)) : "ERROR";
        break; // network down, session expired or face service unavailable: keep everything and retry later
      }
    }
    summary.remaining = await pendingCount(Number(user.schoolId));
    return summary;
  } finally {
    syncing = false;
  }
}
