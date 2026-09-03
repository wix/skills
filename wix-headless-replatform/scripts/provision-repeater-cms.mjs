import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseArgs } from "./lib/common.mjs";

const API = "https://www.wixapis.com";
async function main() {
  const args = parseArgs(); if (!args.out) throw new Error("--out is required");
  const plan = JSON.parse(await readFile(path.join(args.out, "docs", "site-clone", "repeater-cms.json"), "utf8"));
  if (!args.execute) return console.log(JSON.stringify({ dryRun: true, collections: plan.collections.map((c) => ({ id: c.id, rows: c.items.length })) }, null, 2));
  const token = process.env.WIX_AUTH_TOKEN; const siteId = process.env.WIX_SITE_ID;
  if (!token || !siteId) throw new Error("--execute requires WIX_AUTH_TOKEN and WIX_SITE_ID");
  for (const collection of plan.collections) {
    const definition = { id: collection.id, displayName: collection.displayName, fields: fields(), permissions: permissions() };
    const created = await send("/wix-data/v2/collections", { collection: definition }, token, siteId, [409]);
    const existing = created?.collection || (await send(`/wix-data/v2/collections/${collection.id}`, undefined, token, siteId, [], "GET"))?.collection;
    const collectionId = existing?.id || existing?._id || collection.id;
    if (existing) await send("/wix-data/v2/collections", { collection: { ...existing, permissions: permissions() } }, token, siteId, [], "PUT");
    await send("/wix-data/v1/permissions", { dataCollectionId: collectionId, dataPermissions: { id: collectionId, itemRead: "ANYONE", itemInsert: "PRIVILEGED", itemUpdate: "PRIVILEGED", itemRemove: "PRIVILEGED" } }, token, siteId);
    for (const data of collection.items) await send("/wix-data/v2/items", { dataCollectionId: collectionId, dataItem: { id: data.sourceKey, data: { ...data, _id: data.sourceKey } } }, token, siteId, [409]);
  }
}
function fields() { return [["sourceKey","TEXT"],["label","TEXT"],["body","TEXT"],["imagesJson","TEXT"],["linksJson","TEXT"],["sortOrder","NUMBER"],["initialExpanded","BOOLEAN"],["itemStructure","TEXT"]].map(([key,type]) => ({ key, displayName: key, type })); }
function permissions() { return { read: "ANYONE", insert: "ADMIN", update: "ADMIN", remove: "ADMIN" }; }
async function send(endpoint, body, token, siteId, allowed = [], method = "POST") { const value = String(token).trim(); const authorization = /^Bearer\s/i.test(value) || /^IST\./.test(value) ? value : `Bearer ${value}`; const res = await fetch(`${API}${endpoint}`, { method, headers: { Authorization: authorization, "wix-site-id": siteId, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); if (!res.ok && !allowed.includes(res.status)) throw new Error(`${endpoint}: ${res.status} ${await res.text()}`); return res.ok ? res.json() : null; }
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
