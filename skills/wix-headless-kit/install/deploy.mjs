// Deploy the shipped code into the project. Run from the PROJECT ROOT:
//
//   node <SKILL_ROOT>/install/deploy.mjs <vertical> [<vertical> …] --stack astro|react [--client-id <id>] [--plan plan.json]
//
//   --stack astro  (default) — copies each vertical's framework-agnostic core (app/) AND its
//                  Astro overlay (app-astro/: pages, layouts) into src/. Ambient auth: no
//                  client id is needed or written.
//   --stack react  — copies only the core (app/) into src/, and writes the public OAuth
//                  client id into src/wix/config.ts (pass --client-id, or it's read from
//                  wix.config.json's appId when present).
//   --stack lib    — a bundled JS project that isn't React (Vue, Svelte, Solid, plain Vite): copies
//                  ONLY the data layer — shared app/wix/ (sdk, media, money, config) and each
//                  vertical's app/wix/<vertical>/ (data layer, cart store, types, *-core rules) —
//                  none of which imports React; writes the client id like react. No hooks, no
//                  components, no global.css, no Tailwind deps. The agent writes its framework's
//                  stores and components against the same DTO contracts.
//   --stack static — a site with NO bundler (plain HTML/CSS/JS): composes the REST layer flat into
//                  <out>/js/wix/ — shared/rest/ (client, media, config) + each vertical's rest/ + the
//                  vertical's transport-agnostic core files (types, *-core) from its app/ — writes
//                  the client id, and strips it to browser-ready ESM with tsc (comments kept, the
//                  .ts sources kept beside the .js). No package.json is touched. Storefront only
//                  until other verticals ship a rest/. `--out <dir>` (default: the project root)
//                  is the folder the site is served from — the one wix.config.json's
//                  site.outputDirectory points at — so the modules land where the pages import
//                  them and nothing else in the project gets uploaded.
//
// TWO mechanisms, driven by the same vertical arguments:
// 1. Recursive file copy with force:false — only files that AREN'T there yet are written, so
//    a re-run restores missing files without clobbering edits, and a later call can add a
//    vertical safely. Verticals ship at disjoint paths (src/wix/<vertical>/,
//    src/components/<vertical>/, …), so they never collide with each other.
// 2. package.json dependency patch — after the copy, any dependency the copied code imports
//    that is absent from BOTH dependencies and devDependencies is added to dependencies
//    (fill-only: an existing version range always wins). The script never runs npm install —
//    it only makes package.json truthful about what src/ imports; installing is the caller's
//    one command afterwards.
import {
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { templatesDir } from "./templates.mjs";
import { syncLockRoot } from "./lock.mjs";
import { siteContext } from "./context.mjs";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The shipped code: the repository's templates/ (a checkout, the cache, or fetched now).
const REF = templatesDir();
const PROJECT = process.cwd();
const SRC = join(PROJECT, "src");
const CONFIG_TS = join(SRC, "wix", "config.ts");
const PKG_JSON = join(PROJECT, "package.json");

// The vertical registry: every directory under templates/ that ships an app/ is a vertical.
const VERTICALS = readdirSync(REF, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() &&
      existsSync(join(REF, d.name, "app")) &&
      d.name !== "shared" &&
      d.name !== "blank",
  )
  .map((d) => d.name);

// What the shipped code imports, declared per layer (version ranges are the ones the shipped
// code was verified against). react/astro/typescript/@wix/astro* are scaffold-owned — never
// listed here. A new vertical adds its own entry; the patch logic below never changes.
const SHARED_DEPS = {
  "@wix/sdk": "^1.21.5",
  // The shipped components style themselves with Tailwind v4 utilities reading the @theme
  // tokens in styles/global.css (the same system the official Wix headless templates use).
  tailwindcss: "^4.1.7",
  "@tailwindcss/vite": "^4.1.7",
};
const CAPABILITY_DEPS = {
  "media-upload": {
    "@wix/media": "^1.0.271",
    "@wix/essentials": "^1.0.10",
    // the endpoint reads the caller's own session for a members policy
    "@wix/members": "^1.0.511",
  },
  "site-search": {
    "@wix/search": "^1.0.90",
  },
};
const SITE_SEARCH = join("shared", "capabilities", "site-search");
const VERTICAL_DEPS = {
  storefront: {
    core: {
      "@wix/stores": "^1.0.888",
      "@wix/categories": "^1.0.220",
      "@wix/ecom": "^1.0.2451",
      "@wix/redirects": "^1.0.125",
    },
    astro: {
      "@wix/seo": "^1.0.79",
      "@wix/essentials": "^1.0.6",
    },
  },
  bookings: {
    core: {
      "@wix/bookings": "^1.0.1650",
      "@wix/auto_sdk_ecom_cart-v-2": "^1.0.192",
      "@wix/forms": "^1.0.500",
      "@wix/redirects": "^1.0.125",
    },
    astro: {
      "@wix/seo": "^1.0.79",
      "@wix/essentials": "^1.0.6",
    },
  },
  rentals: {
    // A rental is a Bookings service with rentals-specific values: the same SDK modules as bookings.
    core: {
      "@wix/bookings": "^1.0.1650",
      "@wix/auto_sdk_ecom_cart-v-2": "^1.0.192",
      "@wix/redirects": "^1.0.125",
    },
    astro: {
      "@wix/seo": "^1.0.79",
      "@wix/essentials": "^1.0.6",
    },
  },
  blog: {
    core: {
      "@wix/blog": "^1.0.645",
      "@wix/ricos": "^11.12.0",
    },
    astro: {
      "@wix/seo": "^1.0.79",
      "@wix/essentials": "^1.0.10", // WIX_APPS.blogs needs ≥1.0.10
    },
  },
  cms: {
    core: {
      "@wix/data": "^1.0.512",
    },
  },
  forms: {
    core: {
      "@wix/forms": "^1.0.501",
    },
  },
  events: {
    core: {
      "@wix/events": "^1.0.860",
      "@wix/redirects": "^1.0.125",
    },
    astro: {
      "@wix/seo": "^1.0.79",
      "@wix/essentials": "^1.0.10",
    },
  },
  members: {
    core: {
      "@wix/members": "^1.0.511",
    },
  },
  portfolio: {
    core: {
      "@wix/portfolio": "^1.0.229",
    },
  },
  "pricing-plans": {
    core: {
      "@wix/pricing-plans": "^1.0.378",
      "@wix/redirects": "^1.0.125",
    },
  },
  restaurants: {
    core: {
      "@wix/restaurants": "^1.0.525",
      "@wix/table-reservations": "^1.0.397",
      "@wix/ecom": "^1.0.2454",
      "@wix/redirects": "^1.0.125",
    },
  },
  faq: {
    core: {
      "@wix/faq": "^1.0.76",
    },
    // no astro block: the FAQ page is a plain page (no wixMetadata item routing); its JSON-LD is inline
  },
  donations: {
    core: {
      "@wix/donations": "^1.0.64",
      "@wix/ecom": "^1.0.2454",
      "@wix/redirects": "^1.0.125",
    },
  },
};

const COPY = { recursive: true, force: false, errorOnExist: false };

// ---- args ---------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : null;
};
const stack = flag("stack") ?? "astro";
const clientIdFlag = flag("client-id");
const planPath = flag("plan");
const outDir = flag("out");
const flagArgs = new Set(
  ["--stack", "--client-id", "--plan", "--out", stack, clientIdFlag, planPath, outDir].filter(Boolean),
);
const requested = [...new Set(argv.filter((a) => !flagArgs.has(a)))];

const result = { stack, verticals: [], skillRoot: SKILL_ROOT, templates: REF };

if (!["astro", "react", "lib", "static"].includes(stack)) {
  console.log(
    JSON.stringify({
      error: `unknown --stack "${stack}" — expected astro|react|lib|static`,
    }),
  );
  process.exit(1);
}

let plan = {};
if (planPath) {
  if (!existsSync(planPath)) {
    console.log(JSON.stringify({ error: `plan file not found: ${planPath}` }));
    process.exit(1);
  }
  try {
    plan = JSON.parse(readFileSync(planPath, "utf8"));
  } catch (error) {
    console.log(JSON.stringify({ error: `invalid --plan JSON: ${error.message}` }));
    process.exit(1);
  }
}

const uploadPolicies = plan.capabilities?.mediaUpload?.policies ?? [];
if (!Array.isArray(uploadPolicies)) {
  console.log(JSON.stringify({ error: "plan.capabilities.mediaUpload.policies must be an array" }));
  process.exit(1);
}
// Site search is on when the plan carries the entry (`{}` is enough; `true` too). Its fields are
// data for the generated config; the shipped core drops unknown type names, so only shapes are checked.
const siteSearchEntry = plan.capabilities?.siteSearch;
const siteSearch = siteSearchEntry === true ? {} : siteSearchEntry && typeof siteSearchEntry === "object" ? siteSearchEntry : null;
if (siteSearchEntry != null && siteSearchEntry !== false && !siteSearch) {
  console.log(JSON.stringify({ error: "plan.capabilities.siteSearch must be an object (or true)" }));
  process.exit(1);
}
if (siteSearch) {
  const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
  const map = (v) => v === undefined || (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string"));
  if ((siteSearch.types !== undefined && !strings(siteSearch.types)) || !map(siteSearch.routes) || !map(siteSearch.labels)) {
    console.log(JSON.stringify({ error: "plan.capabilities.siteSearch: types must be string[]; routes and labels must be objects of strings" }));
    process.exit(1);
  }
}
// The generated file is data only; the shipped core resolves defaults (types, routes, labels) from it.
const siteSearchConfigSource = () =>
  `// Generated by wix-headless-kit install/deploy.mjs from plan.capabilities.siteSearch.\n` +
  `// Edit the plan and redeploy. Defaults for anything omitted are in search-core.ts (resolveConfig).\n` +
  `export const siteSearchPlan = ${JSON.stringify(siteSearch, null, 2)};\n`;
// ---- static stack: the REST layer, composed flat and stripped ------------------------------------
if (stack === "static") {
  const { spawnSync } = await import("node:child_process");
  const { rmSync } = await import("node:fs");
  const OUT = outDir ? resolve(PROJECT, outDir) : PROJECT;
  const JS = join(OUT, "js", "wix");
  result.out = outDir ?? ".";
  // The client id the browser mints visitor tokens with: --client-id, else the CONTENT app from
  // .env.local (`wix env pull`; on a migration preview the parent site's app), else the config's appId.
  let clientId = clientIdFlag ?? (existsSync(join(PROJECT, "wix.config.json")) ? siteContext({ cwd: PROJECT }).content.clientId : null);
  if (!clientId) {
    console.log(JSON.stringify({ error: "static stack needs the public OAuth client id — run `npm create @wix/new@latest init` here first, or pass --client-id" }));
    process.exit(1);
  }
  const missing = requested.filter((v) => !existsSync(join(REF, v, "rest")));
  if (missing.length) {
    console.log(JSON.stringify({ error: `no rest/ layer yet for ${missing.map((v) => `"${v}"`).join(", ")} — the static stack ships: ${VERTICALS.filter((v) => existsSync(join(REF, v, "rest"))).join(", ")}` }));
    process.exit(1);
  }
  // Only files that aren't there yet — a re-run restores, never clobbers (same as the copy below).
  cpSync(join(REF, "shared", "rest"), JS, COPY);
  // Every layer with a rest/ twin: the requested verticals, plus the site-search capability when the
  // plan turns it on (same shape — rest/ beside app/wix/<name>/ — at templates/shared/capabilities).
  const layers = requested.map((vertical) => [vertical, join(REF, vertical)]);
  if (siteSearch) layers.push(["site-search", join(REF, SITE_SEARCH)]);
  for (const [vertical, root] of layers) {
    cpSync(join(root, "rest"), JS, COPY);
    // The vertical's transport-agnostic core: types, every *-core.ts, and every *-store.ts under its
    // app/wix/<vertical>/ — the stores are the hooks' logic without React, over the same function
    // names the REST twin exports, so they run against it unchanged.
    const appWix = join(root, "app", "wix", vertical);
    for (const f of readdirSync(appWix)) {
      // Every vertical has a types.ts; flat in one folder they would collide, so each lands as
      // <vertical>-types.ts and the vertical's own files are pointed at it below.
      if (f === "types.ts") cpSync(join(appWix, f), join(JS, `${vertical}-types.ts`), COPY);
      // *.generated.ts: data a core file imports (the forms' per-country address templates).
      else if (f.endsWith("-core.ts") || f.endsWith("-store.ts") || f.endsWith(".generated.ts")) cpSync(join(appWix, f), join(JS, f), COPY);
    }
    const own = new Set([...readdirSync(join(root, "rest")), ...readdirSync(appWix)].filter((f) => f.endsWith(".ts") && f !== "types.ts"));
    for (const f of own) {
      const fp = join(JS, f);
      if (!existsSync(fp)) continue;
      const src = readFileSync(fp, "utf8");
      const fixed = src.replace(/from\s+"\.\/types(?:\.js)?"/g, `from "./${vertical}-types.js"`);
      if (fixed !== src) writeFileSync(fp, fixed);
    }
    if (VERTICALS.includes(vertical)) result.verticals.push(vertical);
  }
  if (siteSearch) {
    // The REST twin imports the plan as data from beside it (shared/rest already owns config.ts).
    writeFileSync(join(JS, "site-search-config.generated.ts"), siteSearchConfigSource());
    result.capabilities = { ...result.capabilities, siteSearch: true };
  }
  // Browser ESM resolves nothing: every relative import needs its .js. The rest/ files are written
  // that way; the files borrowed from app/wix/ are bundler-style and get the suffix here.
  for (const f of readdirSync(JS).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(JS, f), "utf8");
    const fixed = src.replace(/(from\s+"\.\/[^"]+?)(?<!\.js)"/g, '$1.js"');
    if (fixed !== src) writeFileSync(join(JS, f), fixed);
  }
  const cfg = join(JS, "config.ts");
  const current = readFileSync(cfg, "utf8");
  if (/WIX_CLIENT_ID: string = ""/.test(current)) {
    writeFileSync(cfg, current.replace(/WIX_CLIENT_ID: string = ""/, `WIX_CLIENT_ID: string = "${clientId}"`));
    result.clientId = "written";
  } else {
    result.clientId = "already_set";
  }
  // Strip to ESM with tsc — comments are the spec for whoever reads js/wix/, so they stay.
  const sources = readdirSync(JS).filter((f) => f.endsWith(".ts")).map((f) => join(JS, f));
  const tsc = spawnSync(
    "npx",
    ["-y", "-p", "typescript@5", "tsc", ...sources, "--outDir", JS, "--module", "esnext", "--target", "es2022",
     "--moduleResolution", "bundler", "--lib", "es2022,dom", "--strict", "--skipLibCheck", "--removeComments", "false"],
    { encoding: "utf8", timeout: 180_000 },
  );
  if (tsc.status !== 0) {
    console.log(JSON.stringify({ ...result, error: `tsc strip failed: ${(tsc.stdout || tsc.stderr || "").slice(-800)}` }));
    process.exit(1);
  }
  rmSync(join(JS, "tsconfig.json"), { force: true });
  result.js = `${outDir ? outDir.replace(/\/$/, "") + "/" : ""}js/wix/*.js`;
  // The note lists what actually landed, so it holds for every vertical (and several at once).
  const stores = readdirSync(JS).filter((f) => f.endsWith("-store.js")).map((f) => `./js/wix/${f}`);
  const dataFiles = readdirSync(JS).filter((f) => f.endsWith(".js") && !f.endsWith("-store.js") && !f.endsWith("-core.js") && !f.endsWith("-types.js") && !f.endsWith(".generated.js") && !["client.js", "config.js", "media.js"].includes(f)).map((f) => `./js/wix/${f}`);
  result.note = `import the data layer (${dataFiles.join(", ")})${stores.length ? ` and the stores (${stores.join(", ")})` : ""} relative to ${outDir ?? "the project root"} in a <script type="module">; the .ts beside them are the same files with types, for reading; point wix.config.json site.outputDirectory at "./${outDir ?? "."}"`;
  console.log(JSON.stringify(result));
  process.exit(0);
}

if (uploadPolicies.length && stack !== "astro") {
  console.log(JSON.stringify({ error: "mediaUpload currently requires --stack astro because it ships a validated server endpoint" }));
  process.exit(1);
}
for (const policy of uploadPolicies) {
  if (
    !policy ||
    typeof policy.id !== "string" ||
    !Array.isArray(policy.accept) ||
    !policy.accept.every((mime) => typeof mime === "string") ||
    !Number.isSafeInteger(policy.maxBytes) ||
    policy.maxBytes < 1 ||
    (policy.audience !== undefined && policy.audience !== "members" && policy.audience !== "visitors")
  ) {
    console.log(JSON.stringify({ error: 'each mediaUpload policy needs id, accept: string[], positive integer maxBytes, and optionally audience: "members" (default) | "visitors"' }));
    process.exit(1);
  }
}

// ---- copy ---------------------------------------------------------------------------------------
// Shared core — always. The lib stack takes only the framework-free wix/ part (no styles).
if (stack === "lib") cpSync(join(REF, "shared", "app", "wix"), join(SRC, "wix"), COPY);
else cpSync(join(REF, "shared", "app"), SRC, COPY);

if (uploadPolicies.length) {
  cpSync(join(REF, "shared", "capabilities", "media-upload", "app"), SRC, COPY);
  cpSync(join(REF, "shared", "capabilities", "media-upload", "app-astro"), SRC, COPY);
}
// Site search ships like a vertical (data layer, stores, hooks, components, a search page) at a
// disjoint path (src/wix/site-search/, src/components/site-search/, …), so the same per-stack rule
// applies: lib takes only app/wix/, astro adds app-astro/.
if (siteSearch) {
  if (stack === "lib") cpSync(join(REF, SITE_SEARCH, "app", "wix"), join(SRC, "wix"), COPY);
  else cpSync(join(REF, SITE_SEARCH, "app"), SRC, COPY);
  if (stack === "astro") cpSync(join(REF, SITE_SEARCH, "app-astro"), SRC, COPY);
}

const unknown = requested.filter((v) => !VERTICALS.includes(v));
// lib: only @wix/sdk from the shared deps — the Tailwind pair serves the components, which don't ship there.
const wantedDeps = stack === "lib" ? { "@wix/sdk": SHARED_DEPS["@wix/sdk"] } : { ...SHARED_DEPS };
if (uploadPolicies.length) Object.assign(wantedDeps, CAPABILITY_DEPS["media-upload"]);
if (siteSearch) Object.assign(wantedDeps, CAPABILITY_DEPS["site-search"]);
for (const vertical of requested.filter((v) => VERTICALS.includes(v))) {
  if (stack === "lib") cpSync(join(REF, vertical, "app", "wix"), join(SRC, "wix"), COPY);
  else cpSync(join(REF, vertical, "app"), SRC, COPY);
  if (stack === "astro" && existsSync(join(REF, vertical, "app-astro"))) {
    cpSync(join(REF, vertical, "app-astro"), SRC, COPY);
  }
  const deps = VERTICAL_DEPS[vertical] ?? {};
  Object.assign(
    wantedDeps,
    deps.core,
    stack === "astro" ? deps.astro : undefined,
  );
  result.verticals.push(vertical);
}

if (uploadPolicies.length) {
  const configDir = join(SRC, "wix", "media-upload");
  const configFile = join(configDir, "policies.generated.ts");
  // The generated file is data only. The shipped endpoint owns validation and elevation.
  writeFileSync(
    configFile,
    `// Generated by wix-headless-kit install/deploy.mjs from plan.capabilities.mediaUpload.\n` +
      `// Edit the plan and redeploy; do not add browser-controlled policy selection here.\n` +
      `export const mediaUploadPolicies = ${JSON.stringify(uploadPolicies, null, 2)} as const;\n`,
  );
  result.capabilities = { mediaUpload: uploadPolicies.map((policy) => policy.id) };
}
if (siteSearch) {
  // The SDK transport imports the plan as data from beside it; defaults resolve in the shipped core.
  writeFileSync(join(SRC, "wix", "site-search", "config.generated.ts"), siteSearchConfigSource());
  result.capabilities = { ...result.capabilities, siteSearch: true };
  if (siteSearch.install) {
    // Indexing needs the Wix Site Search app on the site — a site mutation the deploy never makes.
    result.note = [result.note, "siteSearch.install: run `node <SKILL_ROOT>/templates/shared/capabilities/site-search/seed/install.mjs` from the project root after the seed (results appear about half a minute later)"].filter(Boolean).join("; ");
  }
}

// ---- dependency patch (fill-only) ----------------------------------------------------------------
if (result.verticals.length && existsSync(PKG_JSON)) {
  const pkg = JSON.parse(readFileSync(PKG_JSON, "utf8"));
  pkg.dependencies ??= {};
  const present = { ...pkg.devDependencies, ...pkg.dependencies };
  const added = Object.entries(wantedDeps).filter(
    ([name]) => !(name in present),
  );
  for (const [name, range] of added) pkg.dependencies[name] = range;
  if (added.length)
    writeFileSync(PKG_JSON, JSON.stringify(pkg, null, 2) + "\n");
  result.depsAdded = added.map(([name]) => name);
} else if (result.verticals.length) {
  result.depsAdded = [];
  result.note = [
    result.note,
    "no package.json here — run deploy from the project root",
  ]
    .filter(Boolean)
    .join("; ");
}

// ---- the project's lockfile ---------------------------------------------------------------------
// A project created from a composed template (templates/<vertical>/project) carries that
// template's package-lock.json, so `npm ci` installs it without resolving. When this run added
// dependencies to package.json, the lock's root entry is brought in line where the tree already
// holds the package (install/lock.mjs); anything the tree lacks makes `npm ci` fail fast and the
// `|| npm install` fallback resolve it. A project without a lock installs with `npm install`.
const PROJECT_LOCK = join(PROJECT, "package-lock.json");
if (result.verticals.length && existsSync(PKG_JSON)) {
  if (existsSync(PROJECT_LOCK)) {
    const sync = syncLockRoot(PROJECT);
    if (sync && (sync.promoted.length || sync.missing.length)) result.lock = sync;
    result.note = [result.note, "install with `npm ci --ignore-scripts || npm install --ignore-scripts`"].filter(Boolean).join("; ");
  } else if (result.depsAdded?.length) {
    result.note = [result.note, "run `npm install --ignore-scripts` to pick up depsAdded"].filter(Boolean).join("; ");
  }
}

// ---- astro config: wire the Tailwind vite plugin ---------------------------------------------------
// The blank scaffold's astro.config.mjs has no Tailwind wiring. Fill-only, like everything
// else: patch only when the plugin isn't referenced yet, and only when both anchors are found.
const ASTRO_CONFIG = join(PROJECT, "astro.config.mjs");
if (stack === "astro" && result.verticals.length && existsSync(ASTRO_CONFIG)) {
  const config = readFileSync(ASTRO_CONFIG, "utf8");
  if (config.includes("@tailwindcss/vite")) {
    result.astroConfig = "tailwind_already_wired";
  } else if (config.includes("export default defineConfig({")) {
    const patched =
      `import tailwindcss from "@tailwindcss/vite";\n` +
      config.replace(
        "export default defineConfig({",
        "export default defineConfig({\n  vite: { plugins: [tailwindcss()] },",
      );
    writeFileSync(ASTRO_CONFIG, patched);
    result.astroConfig = "tailwind_wired";
  } else {
    result.astroConfig =
      "UNPATCHED — add `vite: { plugins: [tailwindcss()] }` (import from @tailwindcss/vite) to astro.config.mjs by hand";
  }
}

// ---- ready-made links -----------------------------------------------------------------------------
// Emit the siteId and the dashboard deep links so nothing downstream re-derives or retypes them.
// The site the links point at is the CONTENT site — the parent on a migration preview, where the
// config's site only hosts the deployment (install/context.mjs).
const WIX_CONFIG = join(PROJECT, "wix.config.json");
const ctx = existsSync(WIX_CONFIG) ? siteContext({ cwd: PROJECT }) : null;
if (ctx) {
  const siteId = ctx.content.siteId;
  if (siteId) {
    result.siteId = siteId;
    if (ctx.migration.active) result.migration = { parentSiteId: ctx.migration.parentSiteId, deploySiteId: ctx.deploy.siteId };
    result.dashboardUrl = `https://manage.wix.com/dashboard/${siteId}`;
    if (result.verticals.includes("storefront")) {
      result.productsUrl = `https://manage.wix.com/dashboard/${siteId}/wix-stores/products`;
      result.categoriesUrl = `https://manage.wix.com/dashboard/${siteId}/wix-stores/categories/list`;
    }
  }
}

if (unknown.length) {
  result.error = `unknown vertical(s) ${unknown.map((v) => `"${v}"`).join(", ")} — available: ${VERTICALS.join(", ")}`;
}
if (!requested.length) {
  result.note = `no vertical given — deployed the shared core only. Available: ${VERTICALS.join(", ")}`;
}

// ---- client ids ---------------------------------------------------------------------------------
// The shared data client is ambient on managed Astro, and so is the members flow there (the
// integration's built-in /api/auth routes). WIX_MEMBERS_CLIENT_ID is still filled for projects whose
// members code predates the shared seam; the shipped code reads WIX_CLIENT_ID only.
// --client-id, else the CONTENT app: .env.local's WIX_CLIENT_ID (what `wix env pull` writes — on a
// migration preview the parent site's app, the one the Astro integration itself runs as), else the
// config's appId. Never the config first: on a preview that is the deploy-only child app.
const clientId = clientIdFlag ?? ctx?.content.clientId ?? null;
if (stack === "react" || stack === "lib") {
  if (clientId) {
    const current = readFileSync(CONFIG_TS, "utf8");
    // A non-null id already set wins; only fill the shipped null placeholder.
    if (/WIX_CLIENT_ID:\s*string\s*\|\s*null\s*=\s*null/.test(current)) {
      writeFileSync(
        CONFIG_TS,
        current.replace(
          /WIX_CLIENT_ID:\s*string\s*\|\s*null\s*=\s*null/,
          `WIX_CLIENT_ID: string | null = "${clientId}"`,
        ),
      );
      result.clientId = "written";
    } else {
      result.clientId = "already_set";
    }
  } else {
    result.clientId =
      `missing — pass --client-id (the ${stack} stack needs the public OAuth client id)`;
  }
}
if (requested.includes("members")) {
  if (!clientId) {
    result.membersClientId =
      "missing — pass --client-id (custom members login needs the public OAuth client id)";
  } else {
    const current = readFileSync(CONFIG_TS, "utf8");
    if (
      /WIX_MEMBERS_CLIENT_ID:\s*string\s*\|\s*null\s*=\s*null/.test(current)
    ) {
      writeFileSync(
        CONFIG_TS,
        current.replace(
          /WIX_MEMBERS_CLIENT_ID:\s*string\s*\|\s*null\s*=\s*null/,
          `WIX_MEMBERS_CLIENT_ID: string | null = "${clientId}"`,
        ),
      );
      result.membersClientId = "written";
    } else {
      result.membersClientId = "already_set";
    }
  }
}

console.log(JSON.stringify(result, null, 2));
