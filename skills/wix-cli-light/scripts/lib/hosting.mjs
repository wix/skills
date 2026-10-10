// Wix hosting for a headless project: the app project, its environment variables, and a deployment
// (metadata, upload, complete). Every call takes a site-scoped token.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { request, retrying, MANAGE } from "./http.mjs";

const BASE = `${MANAGE}/_api/wix-code-app-projects/v1/app-projects`;
const DEPLOY = `${MANAGE}/_api/wix-code-app-deployments/v1/app-projects`;
const ENVS = `${MANAGE}/_api/wix-code-app-environments/v2`;
export const HEADLESS_PROJECT_TYPE_ID = "eb363dea-85a0-4159-9b05-949542be5079";

export async function getAppProject(token, appId) {
  try { return (await retrying(() => request(`${BASE}/${appId}?appProjectId=${appId}`, { token }))).appProject; }
  catch (e) { if (e.status === 404) return null; throw e; }
}

export async function createAppProject(token, { id, displayName, slug, cloudProvider }) {
  const body = { appProject: { id, displayName, slug, appProjectTypeId: HEADLESS_PROJECT_TYPE_ID, ...(cloudProvider ? { cloudProviderOverride: cloudProvider } : {}) } };
  return (await request(BASE, { method: "POST", token, body })).appProject;
}

export async function getEnvironmentVariables(token, appId, environment = "prod") {
  const r = await retrying(() => request(`${ENVS}/app-projects/${appId}/app-environment-variables/environment/${environment}?appProjectId=${appId}&environment=${environment}`, { token }));
  return Object.fromEntries((r.appEnvironmentVariables ?? []).map((v) => [v.key, v.value]));
}

export async function upsertEnvironmentVariables(token, appId, environment, variables) {
  const r = await request(`${ENVS}/bulk/app-projects/${appId}/app-environment-variables/upsert`, {
    method: "POST", token,
    body: { appProjectId: appId, environment, variables, mutability: "STATIC", returnEntity: true, returnAllEnvironment: true },
  });
  if (r.bulkActionMetadata?.totalFailures || r.bulkActionMetadata?.undetailedFailures) throw new Error(`environment variables upsert failed: ${JSON.stringify(r.bulkActionMetadata)}`);
  return Object.fromEntries((r.appEnvironmentVariables ?? []).map((v) => [v.key, v.value]));
}

const MIME = { html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json", map: "application/json", xml: "application/xml", txt: "text/plain", md: "text/markdown", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf", wasm: "application/wasm", webmanifest: "application/manifest+json", zip: "application/zip" };
export const contentType = (file) => MIME[extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";

/**
 * Uploads a build: `client` files are served as statics, `server` files run on the hosting runtime.
 * Each file is `{ path (absolute), relativePath }`. Returns `{ deploymentId, deploymentBaseUrl }`.
 */
export async function deploy(token, appId, { client = [], server = [], groupId = false }) {
  const serverFiles = server.map((f) => ({ path: f.relativePath, content: readFileSync(f.path).toString("base64") }));
  if (client.length === 0) {
    const { appDeployment } = await retrying(() => request(`${DEPLOY}/${appId}/app-deployments`, { method: "POST", token, body: { appDeployment: { appProjectId: appId, files: serverFiles, ...(groupId ? { appDeploymentGroupId: randomUUID() } : {}) } } }));
    return { deploymentId: appDeployment.id, deploymentBaseUrl: appDeployment.deploymentBaseUrl };
  }
  const metadata = client.map((f) => {
    const content = readFileSync(f.path);
    return { size: content.length, hash: createHash("md5").update(content).digest("hex"), contentType: contentType(f.path), path: `/${f.relativePath}` };
  });
  const byPath = new Map(client.map((f) => [`/${f.relativePath}`, f.path]));
  const created = await retrying(() => request(`${DEPLOY}/${appId}/app-deployments`, { method: "POST", token, body: { appDeployment: { appProjectId: appId, staticFilesMetadata: metadata, ...(groupId ? { appDeploymentGroupId: randomUUID() } : {}) } } }));
  const { appDeployment, staticFilesUploadUrls = [], uploadAuthToken, uploadBuckets = [] } = created;
  let completionToken = uploadAuthToken;
  if (staticFilesUploadUrls[0]) {
    if (appDeployment.cloudProviderOverride === "KUBERNETES") {
      await Promise.all(staticFilesUploadUrls.map(({ uploadUrl, staticFileMetadata }) => retrying(async () => {
        const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": staticFileMetadata.contentType }, body: readFileSync(byPath.get(staticFileMetadata.path)) });
        if (!res.ok) throw Object.assign(new Error(`upload ${staticFileMetadata.path}: HTTP ${res.status}`), { status: res.status });
      })));
    } else if (uploadAuthToken) {
      const byHash = new Map(staticFilesUploadUrls.map((u) => [u.staticFileMetadata.hash, u.staticFileMetadata]));
      for (const bucket of uploadBuckets) {
        if (!bucket.hashes?.length) continue;
        const form = new FormData();
        for (const hash of bucket.hashes) {
          const meta = byHash.get(hash);
          if (!meta) continue;
          // The part is the file's base64 text, named by its hash, as the CLI sends it.
          form.append(hash, new Blob([readFileSync(byPath.get(meta.path)).toString("base64")], { type: meta.contentType }), hash);
        }
        const r = await retrying(async () => {
          const res = await fetch(staticFilesUploadUrls[0].uploadUrl, { method: "POST", headers: { Authorization: `Bearer ${uploadAuthToken}` }, body: form });
          if (!res.ok) throw Object.assign(new Error(`static upload: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
          return res.json();
        });
        if (r?.result?.jwt) completionToken = r.result.jwt;
      }
    }
  }
  const done = await retrying(() => request(`${DEPLOY}/${appId}/app-deployments/${appDeployment.id}/complete`, { method: "POST", token, body: { appDeployment: { ...appDeployment, files: serverFiles }, staticsCompletionToken: completionToken } }));
  return { deploymentId: done.appDeployment.id, deploymentBaseUrl: done.appDeployment.deploymentBaseUrl };
}
