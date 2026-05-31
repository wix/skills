#!/usr/bin/env node
// Write the initial .wix/site.json shape during Setup. Site.json is the
// single source of truth that every downstream phase reads from / appends
// to. This script writes the canonical initial structure deterministically
// so the orchestrator never has to compose the shape inline (which used
// to be LLM-emitted JSON, with the obvious drift risks).
//
// Usage:
//   node init-site-json.mjs <project-dir> <brand-name> <brand-description> <verticals-csv>
//
// Optional intent payload:
//   Pipe a JSON object via stdin to populate the `intent` block.
//   Shape:
//     {
//       "imagery": "themed-blocks" | "ai-generated",
//       "stores":     { "productCount": 3, "categoriesNamed": ["..."] },
//       "cms":        { "collections": [{ "purpose": "about", "itemCount": 1 }] },
//       "blog":       { "postCount": 6, "topics": ["..."] },
//       "forms":      { "forms": [{ "purpose": "contact", "fields": ["name","email","message"] }] },
//       "gift-cards": { "enabled": true },
//       "bookings":   { "serviceCount": 3, "serviceType": "APPOINTMENT", "hasStaff": false }
//     }
//   Only blocks whose key is in <verticals-csv> are written. `imagery` defaults
//   to "themed-blocks" when the payload is omitted or missing the field.
//
// Example (no intent):
//   node init-site-json.mjs /tmp/proj "Acme Coffee" "Warm cream-and-forest editorial" "stores,ecom,cms,gift-cards"
//
// Example (with intent):
//   echo '{"imagery":"themed-blocks","stores":{"productCount":3}}' \
//     | node init-site-json.mjs /tmp/proj "Acme Coffee" "Warm cream-and-forest editorial" "stores,ecom,cms,gift-cards"
//
// Behavior:
//   - Refuses to overwrite an existing .wix/site.json (exit 2). The orchestrator
//     should call this exactly once during Setup. To re-init for testing, the
//     caller can rm the file first.
//   - Creates .wix/ if it doesn't exist.
//   - Outputs a JSON summary to stdout.

import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [, , projectDir, brandName, brandDescription, verticalsCsv] = process.argv;

if (!projectDir || !brandName || brandDescription === undefined || !verticalsCsv) {
  console.error("usage: init-site-json.mjs <project-dir> <brand-name> <brand-description> <verticals-csv>");
  process.exit(2);
}

const verticals = verticalsCsv
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

if (verticals.length === 0) {
  console.error("init-site-json: <verticals-csv> resolved to zero verticals — cms is always loaded, so this is a bug");
  process.exit(2);
}

const KNOWN_VERTICAL_INTENT_KEYS = new Set([
  "stores",
  "ecom",
  "cms",
  "blog",
  "forms",
  "gift-cards",
  "bookings",
]);
const VALID_IMAGERY = new Set(["themed-blocks", "ai-generated"]);

let stdinPayload = null;
if (!process.stdin.isTTY) {
  const raw = readFileSync(0, "utf8").trim();
  if (raw) {
    try {
      stdinPayload = JSON.parse(raw);
    } catch (err) {
      console.error(`init-site-json: stdin contained non-JSON intent payload: ${err.message}`);
      process.exit(2);
    }
    if (typeof stdinPayload !== "object" || Array.isArray(stdinPayload) || stdinPayload === null) {
      console.error("init-site-json: intent payload must be a JSON object");
      process.exit(2);
    }
  }
}

const intent = { imagery: "themed-blocks" };

if (stdinPayload) {
  if (stdinPayload.imagery !== undefined) {
    if (!VALID_IMAGERY.has(stdinPayload.imagery)) {
      console.error(`init-site-json: intent.imagery must be "themed-blocks" or "ai-generated"; got ${JSON.stringify(stdinPayload.imagery)}`);
      process.exit(2);
    }
    intent.imagery = stdinPayload.imagery;
  }
  for (const [key, value] of Object.entries(stdinPayload)) {
    if (key === "imagery") continue;
    if (!KNOWN_VERTICAL_INTENT_KEYS.has(key)) {
      console.error(`init-site-json: unknown intent key "${key}" — expected one of ${[...KNOWN_VERTICAL_INTENT_KEYS].join(", ")}, or "imagery"`);
      process.exit(2);
    }
    if (!verticals.includes(key)) {
      // Silently drop intent blocks for verticals that aren't loaded — the
      // orchestrator may pass a superset payload during prompt iteration.
      continue;
    }
    intent[key] = value;
  }
}

const wixDir = join(projectDir, ".wix");
const sitePath = join(wixDir, "site.json");

if (existsSync(sitePath)) {
  console.error(`init-site-json: ${sitePath} already exists — refusing to overwrite. Setup should call this exactly once.`);
  process.exit(2);
}

mkdirSync(wixDir, { recursive: true });

const site = {
  brand: {
    name: brandName,
    description: brandDescription,
  },
  intent,
  seeded: {},
  designTokens: {},
  verticals,
};

writeFileSync(sitePath, JSON.stringify(site, null, 2) + "\n");

console.log(JSON.stringify({ status: "ok", path: sitePath, verticals, intent }, null, 2));
