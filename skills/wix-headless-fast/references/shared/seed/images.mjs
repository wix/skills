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
// Authoritative reference: wix-headless/references/IMAGE_GENERATION.md.
import { randomUUID } from "node:crypto";

const API = "https://www.wixapis.com";
// Fallbacks for repeated model failures; google:4@2 rejects steps/CFGScale and free-form sizes.
const MODELS = ["google:4@2", "bfl:5@1", "runware:400@1"];
/** Allowed dimensions: 1024×1024 (square — entities), 1376×768 (16:9 hero), 1200×896 (4:3). */
export const IMAGE_SIZES = { square: [1024, 1024], hero: [1376, 768], editorial: [1200, 896] };

async function req(ctx, path, body, timeoutMs = 90_000) {
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

/** Import an external/generated URL into Wix Media; returns { id, url } (permanent). */
export async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { url, mimeType: "image/png", displayName });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

/**
 * THE seed entry point. Resolves a batch of image specs to Wix Media files in ONE parallel
 * wave. Each spec: { url } (verified external URL — imported as-is) OR { prompt } (generated,
 * 1 credit) — plus optional displayName, width, height. Returns an array aligned with the
 * input: { id, url } per success, null per failure or empty spec. Never throws.
 */
export async function resolveItemImages(ctx, specs) {
  const results = await Promise.allSettled(
    (specs ?? []).map(async (s) => {
      if (!s || (!s.url && !s.prompt)) return null;
      const source = s.url ?? (await generateImage(ctx, s.prompt, { width: s.width, height: s.height }));
      return importImage(ctx, source, s.displayName ?? "image.png");
    }),
  );
  return results.map((r) => (r.status === "fulfilled" ? r.value : null));
}
