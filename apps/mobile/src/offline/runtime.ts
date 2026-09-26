/**
 * The app's one UploadQueue, wired to expo-file-system (JSON manifest + frame copies in the app's
 * document directory — survives restarts, not iCloud-synced media) and the API. JS-only: no native
 * modules beyond what the app already ships.
 *
 * Triggers: app launch (once signed in), app returning to the foreground, and a timer for the next
 * due retry. There is no reachability module in the app, so "connectivity returned" is detected by
 * the retry itself succeeding.
 */
import { Directory, File, Paths } from "expo-file-system";
import { AppState } from "react-native";
import { create } from "zustand";
import { api } from "../api";
import { uploadJpeg } from "../capture/nativeCapture";
import { log } from "../lib/log";
import { useApp } from "../state/appStore";
import { UploadQueue, type QueuedCapture } from "./queue";

const root = () => new Directory(Paths.document, "upload-queue");
const manifest = () => new File(root(), "queue.json");

function ensureDir(d: Directory): void {
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
}

export const uploadQueue = new UploadQueue({
  load: async () => {
    const f = manifest();
    if (!f.exists) return [];
    const parsed: unknown = JSON.parse(f.textSync());
    return Array.isArray(parsed) ? (parsed as QueuedCapture[]) : [];
  },
  save: async (items) => {
    ensureDir(root());
    const f = manifest();
    if (!f.exists) f.create();
    f.write(JSON.stringify(items));
  },
  persistFrame: async (id, i, uri) => {
    const dir = new Directory(root(), id);
    ensureDir(dir);
    const dest = new File(dir, `${i}.jpg`);
    if (dest.exists) dest.delete();
    await new File(uri).copy(dest);
    return dest.uri;
  },
  removeFiles: async (id) => {
    const dir = new Directory(root(), id);
    if (dir.exists) dir.delete();
  },
  uploadFrame: (uri, slot) => uploadJpeg(uri, { path: slot.path, signed_url: slot.signed_url, token: slot.token }),
  submit: (body) => api.createSubmission(body),
  now: () => Date.now(),
  currentUser: () => {
    const s = useApp.getState();
    return s.session === "signed_in" ? s.userId : null;
  },
});

/** Queue entries for the UI (wallet, capture screen). */
export const useUploadQueue = create<{ items: readonly QueuedCapture[] }>(() => ({ items: [] }));
uploadQueue.subscribe(() => useUploadQueue.setState({ items: uploadQueue.mine() }));

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function signedIn(): boolean {
  const s = useApp.getState();
  return s.ready && s.session === "signed_in";
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const due = uploadQueue.nextDueAt();
  if (due === null) return;
  timer = setTimeout(() => void tick(false), Math.max(1_000, due - Date.now()));
}

async function tick(now: boolean): Promise<void> {
  try {
    if (!signedIn()) return;
    if (now) await uploadQueue.retryNow();
    else await uploadQueue.process();
  } catch (e) {
    log.handled("upload-queue", e);
  } finally {
    schedule();
  }
}

/** Start once from the root layout. Resumes saved captures on launch and on every foreground. */
export function startUploadQueue(): () => void {
  if (started) return () => undefined;
  started = true;
  void uploadQueue.init().then(() => tick(true));
  const sub = AppState.addEventListener("change", (s) => {
    if (s === "active") void tick(true);
  });
  const unsubApp = useApp.subscribe((s, prev) => {
    // Account switch / sign-out: re-filter what the UI shows; resume this account's captures.
    if (s.userId !== prev.userId || s.session !== prev.session) useUploadQueue.setState({ items: uploadQueue.mine() });
    if (s.ready && s.session === "signed_in" && !(prev.ready && prev.session === "signed_in" && prev.userId === s.userId)) void tick(true);
  });
  return () => {
    sub.remove();
    unsubApp();
    if (timer) clearTimeout(timer);
    started = false;
  };
}

/** Called after a capture was queued: schedule its first retry. */
export function queueChanged(): void {
  schedule();
}
