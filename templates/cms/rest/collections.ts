// Collection schema reads over REST — the twin of app/wix/cms/collections.ts. Same export, same
// DTO; the mapper comes from collections-core (the SAME file the SDK transport uses, deployed flat
// next to this one by deploy.mjs --stack static), so this file is only the transport.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-collections/create-data-collection.md (the Data Collections API; get is GET /wix-data/v2/collections/{id} per the SDK's route table)
import { WixApiError, wixRequest } from "./client.js";
import { toCollectionSchema, type RawCollection } from "./collections-core.js";
import type { CmsCollectionSchema } from "./types.js";

const unreadable = (e: unknown): boolean => e instanceof WixApiError && (e.status === 404 || e.status === 403);

/**
 * A collection's schema — field types, reference targets, permissions. Null when the collection
 * can't be read: it doesn't exist (404), or the caller may not read schemas (403 — confirm once on
 * a live site that a visitor token is allowed; if it isn't, read it where an elevated call runs).
 * GET /wix-data/v2/collections/{dataCollectionId}  → { collection: { id, displayName, fields: [{ key, displayName, type, typeMetadata, systemField, required }], permissions: { insert, update, remove, read } } }
 */
export async function getCollectionSchema(collectionId: string): Promise<CmsCollectionSchema | null> {
  try {
    const res = await wixRequest<RawCollection>(`/wix-data/v2/collections/${encodeURIComponent(collectionId)}`, { method: "GET" });
    return res?.collection ? toCollectionSchema(res.collection) : null;
  } catch (e) {
    if (unreadable(e)) return null;
    throw e;
  }
}
