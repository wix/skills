// Collection schema rules and DTO mapping — transport-agnostic, imported by BOTH transports:
// ./collections.ts (the SDK) and the REST twin in templates/cms/rest/collections.ts. A raw
// DataCollection comes from the SDK (`_id`) or from REST (`id`, wrapped as `{ collection }` by the
// caller); the mapper accepts both. Imports are type-only so a strip to JS emits no imports.
import type { CmsCollectionSchema, CmsFieldSchema, CmsFieldType, CmsRole } from "./types";

/** A raw DataCollection / Field as either transport returns it. */
export type RawCollection = Record<string, any>;

/** A verb's role as the API spells it; ADMIN (the most restrictive reading) when absent. */
const role = (r: unknown): CmsRole => (typeof r === "string" && r ? r : "ADMIN");

/** One raw field → DTO. The reference target sits under typeMetadata.reference | .multiReference. */
export function toFieldSchema(f: RawCollection): CmsFieldSchema {
  const ref = f.typeMetadata?.reference?.referencedCollectionId ?? f.typeMetadata?.multiReference?.referencedCollectionId;
  return {
    key: f.key ?? "",
    displayName: f.displayName ?? f.key ?? "",
    type: f.type ?? "TEXT",
    systemField: f.systemField === true,
    required: f.required === true,
    ...(ref ? { referencedCollectionId: ref } : {}),
  };
}

/** A raw DataCollection → the schema DTO (id, display name, fields, the four verbs' roles). */
export function toCollectionSchema(raw: RawCollection): CmsCollectionSchema {
  const id = raw._id ?? raw.id ?? "";
  const p = raw.permissions ?? {};
  return {
    id,
    displayName: raw.displayName ?? id,
    fields: ((raw.fields ?? []) as RawCollection[]).map(toFieldSchema),
    permissions: { read: role(p.read), insert: role(p.insert), update: role(p.update), remove: role(p.remove) },
  };
}

/** The fields of one type — e.g. every MULTI_REFERENCE to link after an insert, every IMAGE to guard. */
export function fieldsOfType(schema: CmsCollectionSchema, type: CmsFieldType): CmsFieldSchema[] {
  return schema.fields.filter((f) => f.type === type);
}
