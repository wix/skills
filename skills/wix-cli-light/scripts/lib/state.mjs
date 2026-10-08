// Where the skill keeps what the Wix CLI keeps: the account session in the CLI's own file, so a real
// CLI beside this skill sees the same login, and the pending device code in a file of its own.
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const AUTH_DIR = process.env.WIX_CLI_LIGHT_AUTH_DIR || join(homedir(), ".wix", "auth");
export const ACCOUNT_FILE = join(AUTH_DIR, "account.json");
export const PENDING_FILE = join(AUTH_DIR, "pending-login.json");

function readJson(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, value) {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* windows */ }
}

export const readAccount = () => readJson(ACCOUNT_FILE);
export const writeAccount = (account) => writeJson(ACCOUNT_FILE, account);
export const readPending = () => readJson(PENDING_FILE);
export const writePending = (pending) => writeJson(PENDING_FILE, pending);
export const clearPending = () => { try { unlinkSync(PENDING_FILE); } catch { /* already gone */ } };
