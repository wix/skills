// The Wix CLI's account login as plain HTTP: a device code the owner approves in a browser, an
// exchange for an account token pair, a refresh that also mints site-scoped tokens. Same client,
// same endpoints, same headers and files as the CLI, so a session here is a CLI session.
import { request, HttpError, MANAGE } from "./http.mjs";
import { readAccount, writeAccount, readSite, writeSite } from "./state.mjs";

export const CLIENT_ID = "6f95cec8-3e98-48b9-b4e5-1fb92fcd9973";
const now = () => Math.floor(Date.now() / 1000);

/** `{ deviceCode, userCode, verificationUri, expiresIn }`; the URI carries the CLI's own query. */
export async function requestDeviceCode() {
  const d = await request(`${MANAGE}/oauth2/device/code?clientId=${CLIENT_ID}`);
  const uri = new URL(d.verificationUri);
  for (const [k, v] of [["color", "developer"], ["studio", "true"], ["referralInfo", "cli"]]) uri.searchParams.set(k, v);
  return { ...d, verificationUri: uri.toString() };
}

const pending = (e) => e instanceof HttpError && e.status === 400
  && (e.body?.error === "authorization_pending" || e.body?.error === "slow_down" || e.body?.message === "Device code is not yet verified");

/** One exchange attempt. The token set, or `null` while the owner has not approved yet. */
export async function exchangeDeviceCode(deviceCode) {
  try {
    return normalize(await request(`${MANAGE}/oauth2/token`, {
      method: "POST",
      body: { clientId: CLIENT_ID, grantType: "urn:ietf:params:oauth:grant-type:device_code", scope: "offline_access", deviceCode },
    }));
  } catch (e) {
    if (pending(e)) return null;
    throw e;
  }
}

/** A fresh token pair from the ACCOUNT refresh token; with `siteId`, scoped to that site. */
export async function refresh(refreshToken, siteId) {
  return normalize(await request(`${MANAGE}/oauth2/token`, {
    method: "POST",
    body: { clientId: CLIENT_ID, grantType: "refresh_token", refreshToken, ...(siteId ? { siteId } : {}) },
  }));
}

/** `{ userId, email }` for an account access token. */
export const userInfo = (accessToken) => request(`${MANAGE}/_serverless/wix-cli-userinfo/userinfo`, { token: accessToken });

const normalize = (t) => ({ accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in, issuedAt: now() });
// The CLI treats a token as stale ten minutes before the server does.
const valid = (a) => a?.accessToken && a.issuedAt + (a.expiresIn - 600) > now();
const revoked = (e) => e instanceof HttpError && (e.status === 400 || e.status === 401 || e.status === 403);

/** Finishes a login from a token set: resolves the user and saves the session where the CLI keeps it. */
export async function saveSession(tokens) {
  const info = await userInfo(tokens.accessToken);
  const account = { ...tokens, userInfo: { userId: info.userId, email: info.email } };
  writeAccount(account);
  return account;
}

/** The saved session, refreshed when stale; `null` when there is none or the refresh token is dead. */
export async function session() {
  const a = readAccount();
  if (!a?.refreshToken) return null;
  if (valid(a)) return a;
  try {
    const next = { ...a, ...(await refresh(a.refreshToken)) };
    writeAccount(next);
    return next;
  } catch (e) {
    if (revoked(e)) return null;
    throw e;
  }
}

/** An access token: the account's, or one scoped to `siteId` (cached in the CLI's per-site file). */
export async function accessToken({ siteId } = {}) {
  const a = await session();
  if (!a) throw Object.assign(new Error("LoginRequired"), { code: "LoginRequired" });
  if (!siteId) return a.accessToken;
  const cached = readSite(siteId);
  if (valid(cached)) return cached.accessToken;
  const scoped = await refresh(a.refreshToken, siteId);
  writeSite(siteId, scoped);
  return scoped.accessToken;
}
