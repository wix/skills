// Members seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives); the plan file is optional:
//
//   node <SKILL_ROOT>/references/members/seed/seed-members.mjs [plan.json]
//
// Members SELF-REGISTER — there is no member content to create (see SEED.md). The one
// build-time setup this vertical needs is installing the Wix Members Area app, which serves
// member PROFILE data: without it getCurrentMember() returns nothing for a logged-in member,
// so the account page can't render who they are. Identity alone (log in / log out / gating)
// needs no install. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md): { "installMembersArea": true }   // default true
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. Authoritative source:
// wix-headless/references/SETUP.md § members (the appDefId and the identity/profile split).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const API = "https://www.wixapis.com";
// The Wix Members Area app (the profile layer). Not in the "Apps Created by Wix" table —
// the GUID comes from the App Market listing; recorded in wix-headless/references/SETUP.md.
// Installing it pulls in its Site-Members dependency automatically.
const MEMBERS_AREA_APP_ID = "14cc59bc-f0b7-15b8-e1c7-89ce41d0e0c9";

export function makeCtx({ cwd = process.cwd() } = {}) {
  const config = JSON.parse(readFileSync(`${cwd}/wix.config.json`, "utf8"));
  const siteId = config.siteId ?? config.projectId;
  if (!siteId) throw new Error("wix.config.json has no siteId — is this a Wix CLI project?");
  const token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], {
    encoding: "utf8",
    cwd,
  }).trim();
  if (!token) throw new Error("The Wix CLI returned no token — run `npx @wix/cli@latest login` first.");
  return { token, siteId };
}

async function req(ctx, path, { method = "POST", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "wix-site-id": ctx.siteId,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

// ---- operations ----------------------------------------------------------------------------------

/**
 * Install the Wix Members Area app (idempotent in effect: re-running against a site that
 * already has it errors — recorded in the result, not thrown, since "already installed" and
 * a real failure aren't distinguishable from the response).
 * docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
 */
export async function installMembersAreaApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: MEMBERS_AREA_APP_ID, enabled: true },
    } });
    return { requested: true, note: null };
  } catch (e) {
    return { requested: false, note: String(e.message).slice(0, 300) };
  }
}

/** ONE-CALL seed: install the Members Area app (the profile layer). The default path. */
export async function setupMembers(ctx, { installMembersArea = true } = {}) {
  return {
    membersAreaAppId: MEMBERS_AREA_APP_ID,
    membersAreaInstall: installMembersArea ? await installMembersAreaApp(ctx) : { skipped: true },
    membersCreated: 0, // members self-register — never created at build time
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  const plan = planPath ? JSON.parse(readFileSync(planPath, "utf8")) : {};
  const ctx = makeCtx();
  setupMembers(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
