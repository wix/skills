import * as jsYaml from 'js-yaml';

export type DocEntry = {
  title: string;
  file: string;
  docsEntry?: string;
  tags?: string[];
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

export type AffectedEntry<T extends DocEntry = DocEntry> = T & { yamlPath: string };

export function deduplicateAffectedEntries<T extends DocEntry>(entries: AffectedEntry<T>[]): AffectedEntry<T>[] {
  const seen = new Set<string>();
  return entries.filter(e => {
    const key = `${e.yamlPath}::${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function diffYamlEntries(
  oldEntries: DocEntry[],
  newEntries: DocEntry[]
): DocEntry[] {
  const affectedEntries: DocEntry[] = [];
  const oldByTitle = new Map(oldEntries.map(e => [e.title, e]));

  for (const next of newEntries) {
    // Entries without docsEntry are not skills — skip regardless of prior state
    if (!next.docsEntry) continue;

    const old = oldByTitle.get(next.title);

    if (!old || !old.docsEntry) {
      // New skill entry (or docsEntry was just added)
      affectedEntries.push(next);
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

  return affectedEntries;
}
