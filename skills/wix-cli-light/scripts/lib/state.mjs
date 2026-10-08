// Where the skill keeps what the Wix CLI keeps, in the CLI's own files: the account session, one
// site-scoped token per site, and (this skill's addition) a device code waiting for the owner.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const AUTH_DIR = process.env.WIX_CLI_LIGHT_AUTH_DIR || join(homedir(), ".wix", "auth");
export const ACCOUNT_FILE = join(AUTH_DIR, "account.json");
export const PENDING_FILE = join(AUTH_DIR, "pending-login.json");
export const siteFile = (siteId) => join(AUTH_DIR, `${siteId}.json`);

function readJson(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

// Compact single-line JSON plus a newline, the CLI's own writer's shape.
function writeJson(file, value) {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(value) + "\n", { mode: 0o600 });
}

export const readAccount = () => readJson(ACCOUNT_FILE);
export const writeAccount = (account) => writeJson(ACCOUNT_FILE, account);
export const readSite = (siteId) => readJson(siteFile(siteId));
export const writeSite = (siteId, auth) => writeJson(siteFile(siteId), auth);
export const readPending = () => readJson(PENDING_FILE);
export const writePending = (pending) => writeJson(PENDING_FILE, pending);
export const clearPending = () => { try { unlinkSync(PENDING_FILE); } catch { /* already gone */ } };
