// Shared seed util: entity images by URL or by AI GENERATION (Wix AI / Runware via the
// wixapis proxy). BUILD-TIME only — imported by the vertical seed scripts, never shipped.
//
// The contract every seed relies on:
//   - RESILIENT: nothing here ever throws out of resolveItemImages — a failed image resolves
//     to null and the entity stays text-only; the seed's exit code never depends on images.
//   - PARALLEL: all images resolve in one concurrent wave (each generation is its own
//     single-task request — the google model 504s when one body bundles ≥3 tasks).
//   - PASS-2: seeds create entities first, then attach what this returns — an image is never
//     a precondition for an entity.
//
// Generation costs 1 Wix AI credit per image, billed to the account behind the site.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { createHash } from "node:crypto";

const API = "https://www.wixapis.com";
// Order = cheap-and-permissive first (runware ~0.009 credits/img, ~5s, loosest content
// filter), then google (best fidelity, ~0.14, ~25s; rejects steps/CFGScale and free-form
// sizes), then bfl (strictest filter — refuses trademark-ish prompts). A refusal or failure
// falls through to the next model.
const MODELS = ["runware:400@1", "google:4@2", "bfl:5@1"];
// runware answers in ~5s, but some requests hang until the timeout: a model that has not
// answered by HEDGE_MS gets the next one started beside it, and the first image wins.
const HEDGE_MS = 10_000;
/** Allowed dimensions: 1024×1024 (square — entities), 1376×768 (16:9 hero), 1200×896 (4:3). */
export const IMAGE_SIZES = { square: [1024, 1024], hero: [1376, 768], editorial: [1200, 896] };

async function req(ctx, path, body, timeoutMs = 45_000, signal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "wix-site-id": ctx.siteId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function generateWith(ctx, model, prompt, width, height, signal) {
  const r = await req(ctx, "/runwareschemaless/v1/request", [
    {
      taskType: "imageInference",
      taskUUID: randomUUID(), // must be a real UUIDv4 — slugs 400
      outputType: "URL",
      outputFormat: "PNG",
      positivePrompt: prompt,
      width,
      height,
      model,
      numberResults: 1,
    },
  ], 45_000, signal);
  const url = r?.data?.[0]?.imageURL;
  if (!url) throw new Error(`no imageURL in response: ${JSON.stringify(r).slice(0, 200)}`);
  return url;
}

/**
 * Generate one image; returns its short-lived URL (import it immediately). Models are tried in
 * order: a model that fails (bad params, 5xx, a refusal, credit exhaustion, a timeout) starts the
 * next at once, and one still silent after HEDGE_MS gets the next started beside it; the first
 * image wins and the others are aborted. Throws only after every model failed.
 * docs: no public reference page for /runwareschemaless/v1/request; the request shape is the one below, verified live
 */
export function generateImage(ctx, prompt, { width = 1024, height = 1024, hedgeMs = HEDGE_MS } = {}) {
  return new Promise((resolve, reject) => {
    const running = new Set();
    let next = 0;
    let settled = false;
    let lastErr;
    let timer;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      for (const ac of running) ac.abort();
    };
    const launch = () => {
      if (settled || next >= MODELS.length) return;
      const model = MODELS[next++];
      const ac = new AbortController();
      running.add(ac);
      clearTimeout(timer);
      if (next < MODELS.length) timer = setTimeout(launch, hedgeMs);
      generateWith(ctx, model, prompt, width, height, ac.signal).then(
        (url) => {
          running.delete(ac);
          if (settled) return;
          finish();
          resolve(url);
        },
        (e) => {
          running.delete(ac);
          if (settled) return;
          lastErr = e;
          if (next < MODELS.length) launch();
          else if (!running.size) {
            finish();
            reject(lastErr);
          }
        },
      );
    };
    launch();
  });
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" };

/**
 * Upload a LOCAL file (a path on this machine — the user's own asset) into Wix Media;
 * returns { id, url } (permanent). Two steps per the Upload API: generate-upload-url, then
 * PUT the bytes to it — the PUT response carries the file descriptor.
 * docs: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/generate-file-upload-url.md
 */
export async function uploadImage(ctx, path, displayName) {
  const ext = extname(path).toLowerCase();
  const mimeType = MIME[ext];
  if (!mimeType) throw new Error(`unsupported image extension: ${path}`);
  const bytes = readFileSync(path); // throws loud on a wrong path (caught per-item by resolveItemImages)
  // fileName's extension MUST match the real file type — a mismatch (slug.png for a .jpg) is
  // rejected; keep the caller's display name, swap in the file's own extension.
  const fileName = (displayName ?? basename(path)).replace(/\.[a-z0-9]+$/i, "") + ext;
  const { uploadUrl } = await req(ctx, "/site-media/v1/files/generate-upload-url", {
    mimeType,
    fileName,
  });
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => ({}));
  const f = json.file || json;
  if (!res.ok || !f?.id) throw new Error(`upload failed (${res.status}): ${JSON.stringify(json).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

/** Import an external/generated URL into Wix Media; returns { id, url } (permanent). */
// docs: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file.md
/**
 * A file this seed already put in the Media Manager under this display name, or null. The seed
 * names a file after its product/choice AND a hash of its source, so a re-run finds the same
 * file instead of importing (or generating, a credit each) again — and the product gallery can
 * recognise it by name instead of growing a duplicate per run.
 */
// docs: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/search-files.md
async function findExisting(ctx, displayName) {
  try {
    const r = await req(ctx, "/site-media/v1/files/search", { search: displayName, rootFolder: "MEDIA_ROOT", mediaTypes: ["IMAGE"], paging: { limit: 20 } });
    const f = (r.files ?? []).find((x) => x.displayName === displayName && x.url && x.operationStatus !== "FAILED");
    return f ? { id: f.id, url: f.url, reused: true } : null;
  } catch {
    return null;
  }
}

/**
 * The Media Manager file a spec names, when it names one: `mediaId`, or the file id at the end of a
 * `static.wixstatic.com/media/<fileId>` URL. Returns { id, url, existing: true } for a file on this
 * site, waiting out a short PENDING (an upload still processing), or null when the URL's file is
 * not on this site (it is then imported like any external URL). An explicit `mediaId` that is not
 * on the site throws, so the product is reported text-only with the reason.
 */
// docs: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/get-file-descriptor.md
const WIX_MEDIA_URL = /^https?:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/;
async function existingMediaFile(ctx, s) {
  const id = s.mediaId ?? s.url?.match(WIX_MEDIA_URL)?.[1];
  if (!id) return null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(`${API}/site-media/v1/files/get-file-by-id?fileId=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${ctx.token}`, "wix-site-id": ctx.siteId },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) {
      if (s.mediaId) throw new Error(`no Media Manager file ${id} on this site`);
      return null;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GET get-file-by-id -> ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    const f = json.file;
    if (f?.operationStatus === "FAILED") throw new Error(`Media Manager file ${id} failed processing`);
    if (f?.url && f.operationStatus !== "PENDING") return { id: f.id, url: f.url, existing: true };
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Media Manager file ${id} still processing`);
}

/** Short stable fingerprint of an image's source (url, prompt + size, or file bytes). */
function sourceHash(s) {
  const h = createHash("sha1");
  if (s.path) {
    try { h.update(readFileSync(s.path)); } catch { h.update(String(s.path)); }
  } else h.update(s.url ?? `${s.prompt}|${s.width ?? ""}x${s.height ?? ""}`);
  return h.digest("hex").slice(0, 8);
}

/** `<name>-<hash>.<ext>`: the display name the seed gives a file, stable across runs. */
function stableName(s) {
  const given = s.displayName ?? (s.path ? basename(s.path) : "image.png");
  const ext = (given.match(/\.[a-z0-9]+$/i) ?? [".png"])[0];
  return `${given.replace(/\.[a-z0-9]+$/i, "")}-${sourceHash(s)}${ext}`;
}

export async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { url, mimeType: "image/png", displayName });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

/**
 * THE seed entry point. Resolves a batch of image specs to Wix Media files in ONE parallel
 * wave. Each spec: { mediaId } (a file already in this site's Media Manager — used as it is,
 * as is a static.wixstatic.com/media URL of one) OR { path } (LOCAL file — the user's own asset,
 * uploaded) OR { url } (verified external URL — imported) OR { prompt } (generated, ~1 credit) —
 * plus optional
 * displayName, width, height. Returns an array aligned with the input: { file, error } per
 * spec — `file` is { id, url } on success and null otherwise; `error` is the reason it is null
 * (the thrown message, "empty spec", or "timed out"). Never throws. Every failure is also
 * printed to stderr, so a seed log names the image and the reason even when the seed's
 * own report does not.
 */
export async function resolveItemImagesDetailed(ctx, specs, { perImageBudgetMs = 120_000 } = {}) {
  // unref: the budget timer must never keep the seed process alive after the work is done —
  // a lingering timer delays the seed's exit (and the run's .seed-exit marker) by the budget.
  const deadline = new Promise((r) => {
    const t = setTimeout(() => r(null), perImageBudgetMs);
    t.unref?.();
  });
  const results = await Promise.allSettled(
    (specs ?? []).map(async (s) => {
      if (!s || (!s.path && !s.url && !s.prompt && !s.mediaId)) return null;
      const resolve = (async () => {
        // A file already in this site's Media Manager is used as it is: no import, no copy.
        const inMedia = await existingMediaFile(ctx, s);
        if (inMedia) return inMedia;
        const name = stableName(s);
        // uploadImage swaps in the file's own extension; look for what it will actually be named
        const uploadedName = s.path ? name.replace(/\.[a-z0-9]+$/i, "") + extname(s.path).toLowerCase() : name;
        const existing = await findExisting(ctx, s.path ? uploadedName : name);
        if (existing) return existing;
        if (s.path) return uploadImage(ctx, s.path, name);
        const source = s.url ?? (await generateImage(ctx, s.prompt, { width: s.width, height: s.height }));
        return importImage(ctx, source, name);
      })();
      // Hard per-image budget: even a pathological multi-model hang costs the seed at most
      // perImageBudgetMs of wall clock (the wave is parallel, so it's paid once, not per item).
      return Promise.race([resolve, deadline]);
    }),
  );
  return results.map((r, i) => {
    const spec = specs?.[i] ?? {};
    const label = spec.displayName ?? spec.mediaId ?? spec.path ?? spec.url ?? (spec.prompt ? "(prompt)" : "(empty)");
    if (r.status === "fulfilled") {
      if (r.value) return { file: r.value, error: null };
      const error = !spec.path && !spec.url && !spec.prompt && !spec.mediaId ? "empty spec" : `timed out after ${perImageBudgetMs} ms`;
      if (error !== "empty spec") console.error(`image ${label}: ${error}`);
      return { file: null, error };
    }
    const error = r.reason?.message ?? String(r.reason);
    console.error(`image ${label}: ${error.slice(0, 200)}`);
    return { file: null, error };
  });
}

/** The plain array of { id, url } | null the seeds consume today; failures are still printed. */
export async function resolveItemImages(ctx, specs, opts) {
  return (await resolveItemImagesDetailed(ctx, specs, opts)).map((r) => r.file);
}
