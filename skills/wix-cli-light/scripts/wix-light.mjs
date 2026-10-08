#!/usr/bin/env node
// `node wix-light.mjs <command> [flags]`. Every command finishes inside one call and prints one JSON
// object per line, the Wix CLI's agent-mode vocabulary: awaiting_user, logged_in, login_failed, ...
import { requestDeviceCode, exchangeDeviceCode, saveSession, session, accessToken } from "./lib/auth.mjs";
import { readPending, writePending, clearPending, ACCOUNT_FILE } from "./lib/state.mjs";

const emit = (event, extra = {}) => process.stdout.write(JSON.stringify({ event, ...extra }) + "\n");
const fail = (event, extra = {}) => { emit(event, { ok: false, ...extra }); process.exit(1); };

const [, , command = "help", ...rest] = process.argv;
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) continue;
  const key = rest[i].slice(2);
  const next = rest[i + 1];
  if (next === undefined || next.startsWith("--")) flags[key] = true; else { flags[key] = next; i++; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const awaiting = (p) => emit("awaiting_user", {
  userCode: p.userCode, verificationUri: p.verificationUri, expiresInSeconds: Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000)),
  message: `To connect your Wix account, open ${p.verificationUri} and enter the code ${p.userCode}. Then run this command again.`,
});

// login: run 1 mints a code and returns; run 2 (after the owner approved) exchanges it. `--wait <sec>`
// keeps polling inside the call instead of returning; `--force` discards a pending code.
async function login() {
  const existing = await session();
  if (existing) { clearPending(); return emit("logged_in", { email: existing.userInfo.email, userId: existing.userInfo.userId, reused: true }); }
  let pending = flags.force ? null : readPending();
  if (pending && pending.expiresAt - Date.now() < 60_000) pending = null;
  if (!pending) {
    const d = await requestDeviceCode();
    pending = { deviceCode: d.deviceCode, userCode: d.userCode, verificationUri: d.verificationUri, expiresAt: Date.now() + d.expiresIn * 1000 };
    writePending(pending);
    awaiting(pending);
    if (!flags.wait) return;
  }
  const deadline = Date.now() + (flags.wait ? Number(flags.wait) * 1000 : 0);
  for (;;) {
    const tokens = await exchangeDeviceCode(pending.deviceCode);
    if (tokens) {
      const account = await saveSession(tokens);
      clearPending();
      return emit("logged_in", { email: account.userInfo.email, userId: account.userInfo.userId, file: ACCOUNT_FILE });
    }
    if (Date.now() >= deadline) return awaiting(pending);
    await sleep(3000);
  }
}

async function whoami() {
  const a = await session();
  if (!a) fail("login_required", { detail: "no Wix session: run `login`" });
  emit("logged_in", { email: a.userInfo.email, userId: a.userInfo.userId });
}

async function token() {
  const t = await accessToken(flags.site ? { siteId: flags.site } : {});
  if (flags.json) emit("token", { accessToken: t, ...(flags.site ? { siteId: flags.site } : {}) });
  else process.stdout.write(t + (process.stdout.isTTY ? "\n" : ""));
}

const commands = { login, whoami, token };
if (command === "help" || !commands[command]) {
  process.stdout.write(`wix-light <command>\n  login [--wait <sec>] [--force]\n  whoami\n  token [--site <siteId>] [--json]\n`);
  process.exit(commands[command] ? 0 : 1);
}
commands[command]().catch((e) => {
  if (e.code === "LoginRequired") fail("login_required", { detail: "no Wix session: run `login`" });
  fail(`${command}_failed`, { detail: String(e.message || e).slice(0, 600), status: e.status });
});
