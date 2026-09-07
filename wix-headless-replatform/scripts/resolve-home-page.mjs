#!/usr/bin/env node
import path from "node:path";
import { docsDir, normalizeUrl, parseArgs, resolveOutputDir, writeJson } from "./lib/common.mjs";
import { EXTRACTION_SCHEMA_VERSION, createGap, freezeSpec } from "./lib/extraction-contract.mjs";

const LOCALE_SEGMENT = /^[a-z]{2}(?:-[a-z]{2})?$/i;

export async function resolveHomePage(requestedUrl, { fetchImpl = fetch } = {}) {
  const requested = normalizeUrl(requestedUrl);
  requested.search = "";
  const candidate = homeCandidate(requested);
  let response;
  try {
    response = await fetchImpl(candidate, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "wix-headless-replatform/0083" },
    });
  } catch (error) {
    const gap = createGap({
      id: "gap:page-resolution:navigation",
      ownerUnitId: "page-resolution:home",
      scope: "global",
      missingFields: ["source.resolvedUrl"],
      reason: `Home-page candidate could not be resolved: ${error.message}`,
      evidenceRefs: [],
      unblockAction: "Provide a reachable public home-page URL or restore source availability.",
    });
    return { artifact: null, gaps: [gap] };
  }
  if (!response.ok) {
    const gap = createGap({
      id: "gap:page-resolution:http",
      ownerUnitId: "page-resolution:home",
      scope: "global",
      missingFields: ["source.resolvedUrl"],
      reason: `Home-page candidate returned HTTP ${response.status}.`,
      evidenceRefs: [],
      unblockAction: "Provide a public home-page URL that returns a successful HTML response.",
    });
    return { artifact: null, gaps: [gap] };
  }
  const resolved = normalizeUrl(response.url || candidate);
  resolved.hash = "";
  const html = await response.text();
  const canonical = extractCanonical(html, resolved) || resolved.toString();
  const artifact = freezeSpec({
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    kind: "page-resolution",
    id: "page-resolution:home",
    pageKey: "home",
    destinationRoute: "/",
    status: "accepted",
    source: {
      requestedUrl: requested.toString(),
      candidateUrl: candidate,
      resolvedUrl: resolved.toString(),
      canonicalUrl: canonical,
      redirectsFollowed: requested.toString() !== resolved.toString(),
    },
    evidence: [{ kind: "read-only-navigation", responseStatus: response.status }],
    gapRefs: [],
  });
  return { artifact, gaps: [] };
}

function homeCandidate(requested) {
  const parts = requested.pathname.split("/").filter(Boolean);
  const localePrefix = parts[0] && LOCALE_SEGMENT.test(parts[0]) ? `/${parts[0]}/` : "/";
  return new URL(localePrefix, requested.origin).toString();
}

function extractCanonical(html, baseUrl) {
  const match = String(html).match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>|<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i);
  const href = match?.[1] || match?.[2];
  if (!href) return null;
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}

async function main() {
  const args = parseArgs();
  const sourceUrl = args._[0] || args.url;
  if (!sourceUrl) throw new Error("source URL is required");
  const outputDir = resolveOutputDir(sourceUrl, args.out);
  const result = await resolveHomePage(sourceUrl);
  const target = path.join(docsDir(outputDir), "page-resolution.spec.json");
  await writeJson(target, result.artifact || { schemaVersion: EXTRACTION_SCHEMA_VERSION, kind: "page-resolution", gaps: result.gaps });
  if (result.gaps.some((gap) => gap.scope === "global")) {
    const error = new Error(result.gaps[0].reason);
    error.code = "PAGE_RESOLUTION_BLOCKED";
    throw error;
  }
  console.log(JSON.stringify({ path: target, resolvedUrl: result.artifact.source.resolvedUrl, hash: result.artifact.hash }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
