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

export type SkillEntry = DocEntry & { docsEntry: string };

type RawEntry = { title?: unknown; file?: unknown; docsEntry?: unknown; tags?: unknown };
type RawDoc = { apiDoc?: { docs?: RawEntry[] } };

export function parseDocumentationYaml(raw: string): DocEntry[] {
  const parsed = jsYaml.load(raw) as RawDoc | null;
  const docs = parsed?.apiDoc?.docs;
  if (!docs || !Array.isArray(docs)) return [];
  return docs.flatMap(e => {
    if (!e.title || !e.file) return [];
    return [{
      title: String(e.title),
      file: String(e.file),
      docsEntry: e.docsEntry !== undefined ? String(e.docsEntry) : undefined,
      tags: Array.isArray(e.tags) ? e.tags.map(String) : undefined,
    }];
  });
}

export function filterSkillEntries(entries: DocEntry[]): SkillEntry[] {
  return entries.filter((e): e is SkillEntry => !!e.docsEntry);
}

export type AffectedEntry = SkillEntry & { yamlPath: string };

function makeEntryKey(yamlPath: string, title: string): string {
  return JSON.stringify([yamlPath, title]);
}

export function deduplicateAffectedEntries(entries: AffectedEntry[]): AffectedEntry[] {
  const seen = new Map<string, AffectedEntry>();
  for (const e of entries) {
    const key = makeEntryKey(e.yamlPath, e.title);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, e);
    } else {
      const merged = [...new Set([...(existing.tags ?? []), ...(e.tags ?? [])])];
      seen.set(key, { ...existing, tags: merged.length > 0 ? merged : undefined });
    }
  }
  return [...seen.values()];
}

export function diffYamlEntries(
  oldEntries: DocEntry[],
  newEntries: DocEntry[]
): SkillEntry[] {
  const affectedEntries: SkillEntry[] = [];
  const oldByTitle = new Map(oldEntries.map(e => [e.title, e]));

  for (const next of filterSkillEntries(newEntries)) {
    const old = oldByTitle.get(next.title);

    // !old: brand-new entry; !old.docsEntry: existed before but wasn't a skill — treat both as newly added
    if (!old || !old.docsEntry) {
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
