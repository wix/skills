import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { glob } from 'glob';
import type { SkillFileContent } from './evalforge';

export type CollectLimits = {
  maxFileBytes: number;
  maxTotalBytes: number;
};

export const DEFAULT_COLLECT_LIMITS: CollectLimits = {
  maxFileBytes: 1_000_000,
  maxTotalBytes: 10_000_000,
};

export type CollectOptions = {
  limits?: CollectLimits;
  warn?: (message: string) => void;
};

/**
 * Reads `<root>/<skillDir>/**` into the file list a skill-content capability version takes.
 *
 * Paths are relative to `skillDir`, so a collected file reads `references/DASHBOARD_PAGE.md`
 * — matching what a scenario's `referenceFiles` assertions name.
 *
 * Caps throw rather than truncate: a silently shortened skill would be evaluated as if it
 * were the whole thing, and the run would report on a skill that never existed.
 */
export function collectSkillFiles(
  root: string,
  skillDir: string,
  options: CollectOptions = {},
): SkillFileContent[] {
  const limits = options.limits ?? DEFAULT_COLLECT_LIMITS;
  const skillRoot = posix.join(root, skillDir);

  const relativePaths = glob.sync('**/*', {
    cwd: skillRoot,
    nodir: true,
    dot: false,
    ignore: ['**/node_modules/**', '**/dist/**'],
    posix: true,
  }).sort();

  const files: SkillFileContent[] = [];
  let totalBytes = 0;

  for (const relativePath of relativePaths) {
    const buffer = readFileSync(posix.join(skillRoot, relativePath));

    // A NUL byte means this is not text, and skill content is text. Skipping keeps a stray
    // image from breaking the version; warning keeps it from being invisible.
    if (buffer.includes(0)) {
      options.warn?.(`Skipping non-text file in ${skillDir}: ${relativePath}`);
      continue;
    }

    if (buffer.byteLength > limits.maxFileBytes) {
      throw new Error(
        `Skill file ${relativePath} is ${buffer.byteLength} bytes, over the per-file cap of `
        + `${limits.maxFileBytes}. Split it or raise the cap — truncating would evaluate a skill `
        + `that does not exist.`,
      );
    }

    totalBytes += buffer.byteLength;
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error(
        `Skill ${skillDir} exceeds the total content cap of ${limits.maxTotalBytes} bytes at `
        + `${relativePath}. Raise the cap deliberately rather than shipping a partial skill.`,
      );
    }

    files.push({ path: relativePath, content: buffer.toString('utf8') });
  }

  if (files.length === 0) {
    throw new Error(
      `No files collected from ${skillRoot} — the skill directory is empty or mis-configured. `
      + `Check the skill-dir input.`,
    );
  }

  return files;
}
