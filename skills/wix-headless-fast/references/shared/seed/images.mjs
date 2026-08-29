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
// Generation is billed to the account behind the site, per image, per model — the response's
// `cost` field is the truth (measured: runware ~0.009, bfl ~0.03, google ~0.138).
// Authoritative reference: wix-headless/references/IMAGE_GENERATION.md.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const API = "https://www.wixapis.com";
// Order = cheap-and-permissive first (runware ~0.009 credits/img, ~5s, loosest content
// filter), then google (best fidelity, ~0.14, ~25s; rejects steps/CFGScale and free-form
// sizes), then bfl (strictest filter — refuses trademark-ish prompts). A refusal or failure
// falls through to the next model.
const MODELS = ["runware:400@1", "google:4@2", "bfl:5@1"];
/** Allowed dimensions: 1024×1024 (square — entities), 1376×768 (16:9 hero), 1200×896 (4:3). */
export const IMAGE_SIZES = { square: [1024, 1024], hero: [1376, 768], editorial: [1200, 896] };

async function req(ctx, path, body, timeoutMs = 45_000) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "wix-site-id": ctx.siteId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

/**
 * Generate one image; returns its short-lived URL (import it immediately). Tries each model
 * once — a per-model failure (bad params, 5xx, credit exhaustion, timeout) falls through to
 * the next; throws only after all models failed.
 * docs: no public reference for /runwareschemaless/v1/request — see wix-headless/references/IMAGE_GENERATION.md
 */
export async function generateImage(ctx, prompt, { width = 1024, height = 1024 } = {}) {
  let lastErr;
  for (const model of MODELS) {
    try {
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
      ]);
      const url = r?.data?.[0]?.imageURL;
      if (url) return url;
      lastErr = new Error(`no imageURL in response: ${JSON.stringify(r).slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
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
export async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { url, mimeType: "image/png", displayName });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

/**
 * THE seed entry point. Resolves a batch of image specs to Wix Media files in ONE parallel
 * wave. Each spec: { path } (LOCAL file — the user's own asset, uploaded) OR { url }
 * (verified external URL — imported) OR { prompt } (generated) — plus optional displayName,
 * width, height. Returns an array aligned with the input: { id, url, width?, height? } per
 * success, null per failure or empty spec. Never throws.
 */
export async function resolveItemImages(ctx, specs, { perImageBudgetMs = 120_000 } = {}) {
  // unref: the budget timer must never keep the seed process alive after the work is done —
  // a lingering timer delays the seed's exit (and the run's .seed-exit marker) by the budget.
  const deadline = new Promise((r) => {
    const t = setTimeout(() => r(null), perImageBudgetMs);
    t.unref?.();
  });
  const results = await Promise.allSettled(
    (specs ?? []).map(async (s) => {
      if (!s || (!s.path && !s.url && !s.prompt)) return null;
      const resolve = (async () => {
        // Dimensions travel with the file when we know them: a generated image is exactly what we
        // asked for, and a plan may state them for its own asset. The import/upload response carries
        // none (the file is still processing), so an unstated path/url resolves without them and the
        // caller applies its own default.
        const dims = s.prompt || s.width ? { width: s.width ?? 1024, height: s.height ?? 1024 } : {};
        const file = s.path
          ? await uploadImage(ctx, s.path, s.displayName)
          : await importImage(ctx, s.url ?? (await generateImage(ctx, s.prompt, dims)), s.displayName ?? "image.png");
        return { ...file, ...dims };
      })();
      // Hard per-image budget: even a pathological multi-model hang costs the seed at most
      // perImageBudgetMs of wall clock (the wave is parallel, so it's paid once, not per item).
      return Promise.race([resolve, deadline]);
    }),
  );
  return results.map((r) => (r.status === "fulfilled" ? r.value : null));
}
