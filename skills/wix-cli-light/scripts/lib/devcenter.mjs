// The Dev Center side of a headless project: the site, its companion app (the OAuth client), the
// app's install and secrets, versions, overrides, and the release itself.
import { randomUUID } from "node:crypto";
import { request, retrying, MANAGE, API } from "./http.mjs";

export const BLANK_SITE_TEMPLATE = "212b41cb-0da6-4401-9c72-7c579e6477a2";
export const BACKEND_WORKER_COMPONENT_ID = "ed5f3d0e-7b79-4717-9c00-c4cd7bbbe906";

/** Creates a headless site from a site template; account token. Returns the new site's id. */
export async function createSite(accountToken, { name, templateId = BLANK_SITE_TEMPLATE }) {
  const r = await request(`${API}/funnel/projects/v1/create`, { method: "POST", token: accountToken, body: { type: "HEADLESS", name, templateId } });
  return r.project.metaSiteId;
}

/** The site's companion app; site token. Its id is the project's appId and public OAuth client id. */
export const getOrCreateCompanionApp = async (siteToken) =>
  (await retrying(() => request(`${MANAGE}/_api/companion-apps/v1/companion-apps/get-or-create`, { method: "POST", token: siteToken, body: {} }))).companionApp.id;

export async function setNamespace(siteToken, appId, appName) {
  try { await request(`${MANAGE}/apps-service/v1/apps/${appId}/set-namespace`, { method: "PATCH", token: siteToken, body: { appId, appName } }); }
  catch (e) { if (e.status !== 409) throw e; }
}

export const installApp = async (siteToken, siteId, appId) =>
  (await retrying(() => request(`${MANAGE}/apps-installer-service/v1/app-instance/install`, { method: "POST", token: siteToken, body: { tenant: { id: siteId, tenantType: "SITE" }, appInstance: { appDefId: appId, version: "latest" } } }))).appInstance.id;

export const getAppSecrets = async (siteToken, appId) =>
  (await retrying(() => request(`${MANAGE}/apps-service/v1/apps/${appId}?appId=${appId}&withSecrets=true`, { token: siteToken }))).app.appSecrets;

/** Points the OAuth app at the hosting base URL and the local dev server, as the CLI does. */
export async function configureOAuthApp(siteToken, appId, baseUrl) {
  const prod = baseUrl.replace(/\/$/, "");
  const host = new URL(baseUrl).hostname;
  const local = "http://localhost:4321";
  const body = {
    oAuthApp: {
      id: appId,
      allowedDomains: [local, `https://(.*)-${host}`, prod],
      allowedRedirectUris: [`${local}/api/auth/callback`, `${local}/api/auth/logout-callback`, `https://*-${host}/api/auth/callback`, `https://*-${host}/api/auth/logout-callback`, `${prod}/api/auth/callback`, `${prod}/api/auth/logout-callback`],
      redirectUrlWixPages: prod,
      origin: "other",
    },
    mask: "allowedDomains,allowedRedirectUris,redirectUrlWixPages,origin",
  };
  await request(`${MANAGE}/oauth-app-service/v1/oauth-apps/${appId}`, { method: "PATCH", token: siteToken, body });
}

const latestProductionVersion = async (siteToken, appId) =>
  (await request(`${MANAGE}/_api/app-versions/v1/app-versions/get-latest-production?appId=${appId}`, { token: siteToken })).appVersion?.version ?? 0;

/** A components override (the CLI's "preview") for the manifest; returns its id. */
export async function createComponentsOverride(siteToken, manifest) {
  const appVersion = await latestProductionVersion(siteToken, manifest.appId);
  const modifiedComponents = manifest.components.map((c) => ({ componentId: c.compId, data: c.compData, name: c.compName, type: c.compType, createdBy: c.createdBy, createdByVersion: c.createdByVersion }));
  const experiments = manifest.components.flatMap((c) => c.experiments?.enabledBy
    ? [{ componentId: c.compId, spec: c.experiments.enabledBy, variantValue: "true", experimentActionType: "CREATE_COMPONENT", createComponentOptions: { experimentVersion: 1 } }] : []);
  const r = await request(`${MANAGE}/_api/components-overrides/v1/components-override`, {
    method: "POST", token: siteToken,
    body: { componentsOverride: { id: randomUUID(), appId: manifest.appId, appVersion, externalId: manifest.appId, modifiedComponents, experiments } },
  });
  return r.componentsOverride.id;
}

/** Releases the override as the site's live version. Returns the release base URL. */
export const release = async (siteToken, appId, componentOverrideId, { minor = false, comment } = {}) =>
  (await request(`${MANAGE}/apps-release-manager-service-web/apps/release/${appId}/${componentOverrideId}`, {
    method: "POST", token: siteToken, body: { appId, componentOverrideId, createMinorVersion: minor, ...(comment ? { notes: comment } : {}) },
  })).releaseBaseUrl;
