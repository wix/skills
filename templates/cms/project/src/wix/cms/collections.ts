// Collection schema reads (@wix/data `collections`) over the SDK — field types, reference targets,
// and permissions at runtime. The mapper lives in ./collections-core (shared with the REST twin in
// templates/cms/rest/collections.ts); this file is the transport only.
// SDK: collections.getDataCollection(dataCollectionId) → DataCollection
//      (com.wixpress.cloud.data.api.collectionservice.DataCollectionService.GetDataCollection)
import { collections as collectionsModule } from "@wix/data";
import { wixModule } from "../sdk";
import { toCollectionSchema, type RawCollection } from "./collections-core";
import type { CmsCollectionSchema } from "./types";

const collections = wixModule(collectionsModule);

/**
 * A collection's schema — the source of truth for a field's type when the seed plan isn't at
 * hand (an imported site), and for which fields are MULTI_REFERENCEs to link after an insert.
 * Null when the collection can't be read: it doesn't exist, or the caller may not read schemas
 * (Wix's own headless CMS components read it client-side as the visitor and tolerate a null the
 * same way — confirm once on a live site that a visitor token is allowed; if it isn't, read the
 * schema server-side in the page's frontmatter and pass what the island needs).
 */
export async function getCollectionSchema(collectionId: string): Promise<CmsCollectionSchema | null> {
  try {
    const raw = await collections.getDataCollection(collectionId);
    return raw ? toCollectionSchema(raw as RawCollection) : null;
  } catch {
    return null;
  }
}
