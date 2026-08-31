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

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(SKILL_ROOT, "references");
const PROJECT = process.cwd();
const SRC = join(PROJECT, "src");
const CONFIG_TS = join(SRC, "wix", "config.ts");
const PKG_JSON = join(PROJECT, "package.json");

// The vertical registry: every directory under references/ that ships an app/ is a vertical.
const VERTICALS = readdirSync(REF, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() &&
      existsSync(join(REF, d.name, "app")) &&
      d.name !== "shared",
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
    // All shipped Astro locks already carry @wix/media >= 1.0.271 transitively. Keep this
    // range compatible with them, then promote it to a root lock dependency below.
    "@wix/media": "^1.0.271",
    "@wix/essentials": "^1.0.10",
  },
};
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
const flagArgs = new Set(
  ["--stack", "--client-id", "--plan", stack, clientIdFlag, planPath].filter(Boolean),
);
const requested = [...new Set(argv.filter((a) => !flagArgs.has(a)))];

const result = { stack, verticals: [], skillRoot: SKILL_ROOT };

if (!["astro", "react"].includes(stack)) {
  console.log(
    JSON.stringify({
      error: `unknown --stack "${stack}" — expected astro|react`,
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
    policy.maxBytes < 1
  ) {
    console.log(JSON.stringify({ error: "each mediaUpload policy needs id, accept: string[], and positive integer maxBytes" }));
    process.exit(1);
  }
}

// ---- copy ---------------------------------------------------------------------------------------
// Shared core — always.
cpSync(join(REF, "shared", "app"), SRC, COPY);

if (uploadPolicies.length) {
  cpSync(join(REF, "shared", "capabilities", "media-upload", "app"), SRC, COPY);
  cpSync(join(REF, "shared", "capabilities", "media-upload", "app-astro"), SRC, COPY);
}

const unknown = requested.filter((v) => !VERTICALS.includes(v));
const wantedDeps = { ...SHARED_DEPS };
if (uploadPolicies.length) Object.assign(wantedDeps, CAPABILITY_DEPS["media-upload"]);
for (const vertical of requested.filter((v) => VERTICALS.includes(v))) {
  cpSync(join(REF, vertical, "app"), SRC, COPY);
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
    `// Generated by wix-headless-fast install/deploy.mjs from plan.capabilities.mediaUpload.\n` +
      `// Edit the plan and redeploy; do not add browser-controlled policy selection here.\n` +
      `export const mediaUploadPolicies = ${JSON.stringify(uploadPolicies, null, 2)} as const;\n`,
  );
  result.capabilities = { mediaUpload: uploadPolicies.map((policy) => policy.id) };
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
  if (added.length)
    result.note = [
      result.note,
      "run `npm install --ignore-scripts` to pick up depsAdded",
    ]
      .filter(Boolean)
      .join("; ");
} else if (result.verticals.length) {
  result.depsAdded = [];
  result.note = [
    result.note,
    "no package.json here — run deploy from the project root",
  ]
    .filter(Boolean)
    .join("; ");
}

// ---- shipped lockfile (single vertical only) ------------------------------------------------------
// A pre-resolved package-lock.json covering the scaffold + this vertical's deps ships at
// references/<vertical>/lock/<stack>/package-lock.json. Placing it lets `npm ci` skip the whole
// resolution phase (seconds instead of minutes). URLs are canonical registry.npmjs.org form —
// npm substitutes the locally configured registry (mirrors/proxies) at fetch time. Placed only
// when the project has no lock of its own; if it ever drifts out of sync, `npm ci` fails fast
// and the `|| npm install` fallback self-heals.
const PROJECT_LOCK = join(PROJECT, "package-lock.json");
if (
  result.verticals.length === 1 &&
  existsSync(PKG_JSON) &&
  !existsSync(PROJECT_LOCK)
) {
  const shippedLock = join(
    REF,
    result.verticals[0],
    "lock",
    stack,
    "package-lock.json",
  );
  if (existsSync(shippedLock)) {
    cpSync(shippedLock, PROJECT_LOCK);
    if (uploadPolicies.length) {
      // The supplied per-vertical lock already resolves Media + Essentials transitively. Add
      // them to its root package entry too, so npm ci accepts package.json's new direct
      // dependency without falling back to a slow dependency-resolution install.
      const lock = JSON.parse(readFileSync(PROJECT_LOCK, "utf8"));
      lock.packages ??= {};
      lock.packages[""] ??= {};
      lock.packages[""].dependencies ??= {};
      const rootDeps = lock.packages[""].dependencies;
      for (const [name, range] of Object.entries(CAPABILITY_DEPS["media-upload"])) {
        if (!lock.packages?.[`node_modules/${name}`]) {
          result.lockCapability = `UNPATCHED — supplied lock lacks ${name}; npm install will resolve it`;
          break;
        }
        rootDeps[name] = range;
      }
      writeFileSync(PROJECT_LOCK, JSON.stringify(lock, null, 2) + "\n");
      if (!result.lockCapability) result.lockCapability = "media_upload_promoted";
    }
    result.lockDeployed = true;
    result.note = [
      result.note,
      "install with `npm ci --ignore-scripts || npm install --ignore-scripts`",
    ]
      .filter(Boolean)
      .join("; ");
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
const WIX_CONFIG = join(PROJECT, "wix.config.json");
if (existsSync(WIX_CONFIG)) {
  const config = JSON.parse(readFileSync(WIX_CONFIG, "utf8"));
  const siteId = config.siteId ?? config.projectId;
  if (siteId) {
    result.siteId = siteId;
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
// The shared data client is ambient on managed Astro. Members are different: their shipped
// custom credential flow always needs an explicit public OAuth client, including on Astro.
let clientId = clientIdFlag;
if (!clientId && existsSync(join(PROJECT, "wix.config.json"))) {
  // On a Wix-managed project the public OAuth client id IS the appId.
  clientId =
    JSON.parse(readFileSync(join(PROJECT, "wix.config.json"), "utf8")).appId ??
    null;
}
if (stack === "react") {
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
      "missing — pass --client-id (react stack needs the public OAuth client id)";
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
