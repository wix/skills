import * as jsYaml from 'js-yaml';

export type DocEntry = {
  title: string;
  file: string;
  docsEntry?: string;
  tags?: string[];
};

export type ValidationError = {
  entryTitle: string;
  message: string;
};

type RawEntry = { title?: unknown; file?: unknown; docsEntry?: unknown; tags?: unknown };
type RawDoc = { apiDoc?: { docs?: RawEntry[] } };

export function parseDocumentationYaml(raw: string): DocEntry[] {
  const parsed = jsYaml.load(raw) as RawDoc | null;
  const docs = parsed?.apiDoc?.docs;
  if (!docs || !Array.isArray(docs)) return [];
  return docs.map(e => ({
    title: String(e.title ?? ''),
    file: String(e.file ?? ''),
    docsEntry: e.docsEntry !== undefined ? String(e.docsEntry) : undefined,
    tags: Array.isArray(e.tags) ? e.tags.map(String) : undefined,
  }));
}

export function diffYamlEntries(
  oldEntries: DocEntry[],
  newEntries: DocEntry[]
): { affectedEntries: DocEntry[]; errors: ValidationError[] } {
  const affectedEntries: DocEntry[] = [];
  const errors: ValidationError[] = [];
  const oldByTitle = new Map(oldEntries.map(e => [e.title, e]));

  for (const next of newEntries) {
    const old = oldByTitle.get(next.title);

    if (!old) {
      affectedEntries.push(next);
      continue;
    }

    const docsEntryRemoved = old.docsEntry !== undefined && next.docsEntry === undefined;
    if (docsEntryRemoved) {
      errors.push({ entryTitle: next.title, message: `docsEntry removed from "${next.title}"` });
      continue;
    }

    const fileChanged = old.file !== next.file;
    const addedTags = (next.tags ?? []).filter(t => !new Set(old.tags ?? []).has(t));

    if (fileChanged) {
      affectedEntries.push(next);
    } else if (addedTags.length > 0) {
      affectedEntries.push({ ...next, tags: addedTags });
    }
  }

  return { affectedEntries, errors };
}
