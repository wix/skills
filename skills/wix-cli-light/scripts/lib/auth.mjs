// The Wix CLI's account login as plain HTTP: a device code the owner approves in a browser, an
// exchange for an account token pair, a refresh that also mints site-scoped tokens. Same client,
// same endpoints, same headers as the CLI, so the session is interchangeable with a CLI login.
import { request, HttpError } from "./http.mjs";
import { readAccount, writeAccount } from "./state.mjs";

const MANAGE = "https://manage.wix.com";
export const CLIENT_ID = "6f95cec8-3e98-48b9-b4e5-1fb92fcd9973";
const HEADERS = { "X-XSRF-TOKEN": "nocheck", Cookie: "XSRF-TOKEN=nocheck", "User-Agent": "wix-cli" };

/** `{ deviceCode, userCode, verificationUri, expiresIn }` */
export function requestDeviceCode() {
  return request(`${MANAGE}/oauth2/device/code?clientId=${CLIENT_ID}`, { headers: HEADERS });
}

/** One exchange attempt. Returns the token set, or `null` while the owner has not approved yet. */
export async function exchangeDeviceCode(deviceCode) {
  try {
    return normalize(await request(`${MANAGE}/oauth2/token`, {
      method: "POST", headers: HEADERS,
      body: { clientId: CLIENT_ID, grantType: "urn:ietf:params:oauth:grant-type:device_code", scope: "offline_access", deviceCode },
    }));
  } catch (e) {
    if (e instanceof HttpError && e.status === 400 && /authorization_pending|slow_down/i.test(JSON.stringify(e.body))) return null;
    throw e;
  }
}

/** A fresh token pair from a refresh token; with `siteId`, the access token is scoped to that site. */
export async function refresh(refreshToken, siteId) {
  return normalize(await request(`${MANAGE}/oauth2/token`, {
    method: "POST", headers: HEADERS,
    body: { clientId: CLIENT_ID, grantType: "refresh_token", refreshToken, ...(siteId ? { siteId } : {}) },
  }));
}

/** `{ userId, email }` for an account access token. */
export function userInfo(accessToken) {
  return request(`${MANAGE}/_serverless/wix-cli-userinfo/userinfo`, { headers: HEADERS, token: accessToken });
}

function normalize(t) {
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in, issuedAt: Date.now() };
}

/** Finishes a login from a token set: resolves the user and saves the session where the CLI keeps it. */
export async function saveSession(tokens) {
  const info = await userInfo(tokens.accessToken);
  const account = { ...tokens, userInfo: { userId: info.userId, email: info.email } };
  writeAccount(account);
  return account;
}

const expired = (a) => !a.issuedAt || Date.now() > a.issuedAt + (a.expiresIn - 60) * 1000;

/** The saved session, refreshed when its access token is stale; `null` when there is none. */
export async function session() {
  const a = readAccount();
  if (!a?.refreshToken) return null;
  if (!expired(a)) return a;
  try {
    const next = { ...a, ...(await refresh(a.refreshToken)) };
    writeAccount(next);
    return next;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 400 || e.status === 401 || e.status === 403)) return null;
    throw e;
  }
}

/** An access token: the account's, or one scoped to `siteId`. Throws `LoginRequired` with no session. */
export async function accessToken({ siteId } = {}) {
  const a = await session();
  if (!a) throw Object.assign(new Error("LoginRequired"), { code: "LoginRequired" });
  if (!siteId) return a.accessToken;
  // A site-scoped exchange leaves the account's own refresh token in place.
  return (await refresh(a.refreshToken, siteId)).accessToken;
}
