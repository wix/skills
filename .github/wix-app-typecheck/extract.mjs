#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const refsDir = join(__dirname, '..', '..', 'skills', 'wix-app', 'references');
const outDir = join(__dirname, '__generated__');
const templatesDir = join(__dirname, '__generated_templates__');

try { rmSync(outDir, { recursive: true }); } catch {}
mkdirSync(outDir, { recursive: true });
try { rmSync(templatesDir, { recursive: true }); } catch {}
mkdirSync(templatesDir, { recursive: true });

function findMdFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMdFiles(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

const DECLARATION_START = /^(import|export|const|let|var|function|async\s+function|class|interface|type\s+\w|declare|abstract|enum|namespace|module\s+\w|\/\/|\/\*)/;

function transformBlock(code, index) {
  const strippedComments = code.trimStart().replace(/^(\/\/[^\n]*\n\s*)+/, '').trimStart();

  // Pattern 1 — bare object literal
  if (strippedComments.startsWith('{') && !DECLARATION_START.test(strippedComments)) {
    return `const _config_${index} = ${code}`;
  }

  // Pattern 2 — spread placeholder `(...)`
  let result = code.replace(/\(\.\.\.(\s*)\)/g, '()');

  // Pattern 3 — placeholder angle-bracket tokens like `<your-page-id>`
  result = result.replace(/<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)>/g, "'$1'");

  // Pattern 4 — remove intentional wrong-usage lines (marked with `// ❌`) and the
  // code line immediately following each one. Only correct examples get typechecked.
  result = result.replace(/[ \t]*\/\/ ❌[^\n]*\n[ \t]*[^\n]*\n?/g, '');

  return result;
}

// The draft templates name things with `{Feature}` / `{Entity}Row` / `./{feature}-api`
// placeholders. Those are parse errors, so pass 1 marks the whole file structural and
// pass 2 never type-checks a line of it — the templates people copy were the least
// verified code in the skill. Substituting the placeholders makes them real code.
//
// Braces are only stripped where `{Word}` is glued to an identifier, a `/` (import
// paths) or a `<` (JSX element name) — a standalone `{state}` is a real JSX expression
// and must survive. PLACEHOLDER_TYPES additionally covers type positions
// (`type {Entity}`, `{} as {Entity}`), where nothing is glued; they are capitalised
// and never used as real JSX identifiers in these docs.
const PLACEHOLDER_TYPES = ['Feature', 'Entity'];

function deplaceholder(code) {
  let out = code
    .replace(/(?<=[A-Za-z0-9_$/<])\{(\w+)\}/g, '$1')
    .replace(/\{(\w+)\}(?=[A-Za-z0-9_$-])/g, '$1');
  for (const name of PLACEHOLDER_TYPES) out = out.split(`{${name}}`).join(name);
  return out;
}

function extractBlocks(content) {
  const blocks = [];
  const re = /```(typescript|tsx)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(content)) !== null) blocks.push({ lang: m[1], code: m[2] });
  return blocks;
}

// Errors that are artifacts of extracting partial/non-self-contained code blocks —
// not real API misuse. Files with these errors are excluded from semantic checking.
const STRUCTURAL = /error TS(1\d{3}|2300|2304|2307|2395|2440|2448|2451|2528|2552|2657|2786|17008):/;

// Callback params typed as `{}` when extracted without their surrounding generic — not a real error.
const EMPTY_OBJECT_PROP = /does not exist on type '{}'/;

const BASE_COMPILER_OPTIONS = {
  target: 'ES2020',
  lib: ['ES2020', 'DOM'],
  jsx: 'react-jsx',
  jsxImportSource: 'react',
  module: 'node16',
  moduleResolution: 'node16',
  strict: false,
  noImplicitAny: false,
  skipLibCheck: true,
  noEmit: true,
};

function runTsc(args = '') {
  try {
    execSync(`npx tsc --noEmit ${args}`, { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    return '';
  } catch (err) {
    return (err.stdout ?? '').toString() + (err.stderr ?? '').toString();
  }
}

// ── Extract ───────────────────────────────────────────────────────────────────

let count = 0;
let templateCount = 0;
for (const mdFile of findMdFiles(refsDir)) {
  const blocks = extractBlocks(readFileSync(mdFile, 'utf-8'));
  if (!blocks.length) continue;

  let combined = blocks.map(({ code }, i) => transformBlock(code, i)).join('\n\n');
  combined = combined.replace(/^(import .+ from ['"]\.)/gm, '// @ts-ignore\n$1');

  const rel = mdFile.slice(refsDir.length + 1).replace(/\//g, '__').replace(/\.md$/, '');
  writeFileSync(join(outDir, `${rel}.tsx`), combined);
  count++;

  // One file per block, not the concatenation pass 1 uses: a person copies a single
  // block into a single file, and concatenating unrelated blocks invents parse errors
  // that the blocks themselves don't have.
  blocks.forEach(({ code }, i) => {
    const asRealCode = deplaceholder(code);
    if (asRealCode === code) return;
    const withIgnores = asRealCode.replace(/^(import .+ from ['"]\.)/gm, '// @ts-ignore\n$1');
    writeFileSync(join(templatesDir, `${rel}__b${i}.tsx`), withIgnores);
    templateCount++;
  });
}

console.log(`Extracted ${count} files into __generated__/ (${templateCount} placeholder block(s) into __generated_templates__/)`);

// ── Pass 1: find files with structural/parse errors ───────────────────────────

const pass1Output = runTsc();
const structuralErrors = pass1Output.split('\n').filter(l => STRUCTURAL.test(l));
const filesWithStructuralErrors = new Set(
  structuralErrors.map(l => l.match(/^(__generated__\/[^(]+)/)?.[1]).filter(Boolean),
);

if (filesWithStructuralErrors.size) {
  console.warn(`\n⚠️  ${structuralErrors.length} structural error(s) in ${filesWithStructuralErrors.size} file(s) from non-self-contained blocks (fix over time):`);
  structuralErrors.forEach(l => console.warn(' ', l));
  for (const rel of filesWithStructuralErrors) {
    const full = join(__dirname, rel);
    const existing = readFileSync(full, 'utf-8');
    if (!existing.startsWith('// @ts-nocheck')) {
      writeFileSync(full, '// @ts-nocheck\n' + existing);
    }
  }
}

// ── Pass 2: semantic type errors only ─────────────────────────────────────────
// @ts-nocheck suppresses semantic errors but NOT parse errors, so files with
// structural errors must be fully excluded from compilation.

const pass2TsconfigPath = join(__dirname, '__pass2_tsconfig.json');
writeFileSync(pass2TsconfigPath, JSON.stringify({
  compilerOptions: BASE_COMPILER_OPTIONS,
  include: ['env.d.ts', '__generated__/**/*.tsx'],
  exclude: [...filesWithStructuralErrors],
}));

let pass2Output;
try {
  pass2Output = runTsc('-p __pass2_tsconfig.json');
} finally {
  try { rmSync(pass2TsconfigPath); } catch {}
}

const typeErrors = pass2Output.split('\n').filter(l =>
  /error TS[2-9]\d{3}:/.test(l) && !STRUCTURAL.test(l) && !EMPTY_OBJECT_PROP.test(l),
);

if (typeErrors.length) {
  console.error(`\n❌ ${typeErrors.length} type error(s) found:`);
  typeErrors.forEach(l => console.error(' ', l));
  process.exit(1);
}

console.log('\n✅ No type errors found.');

// ── Pass 3: the draft templates, as real code ─────────────────────────────────
// Placeholder files are excluded from pass 2 by construction, so without this the
// copy-paste templates are never type-checked at all.
//
// Two steps, for the same reason passes 1 and 2 are split: while any file in the
// program has a parse error, tsc reports syntactic diagnostics only and skips
// semantic checking of everything else — so a broken block would mask every real
// type error in the other templates.

function runTemplatePass(exclude = []) {
  const cfg = join(__dirname, '__pass3_tsconfig.json');
  writeFileSync(cfg, JSON.stringify({
    compilerOptions: BASE_COMPILER_OPTIONS,
    include: ['env.d.ts', '__generated_templates__/**/*.tsx'],
    exclude,
  }));
  try {
    return runTsc('-p __pass3_tsconfig.json');
  } finally {
    try { rmSync(cfg); } catch {}
  }
}

// 3a — which blocks still don't parse after substitution
const templateStructural = runTemplatePass().split('\n').filter(l => STRUCTURAL.test(l));
const templateBroken = new Set(
  templateStructural.map(l => l.match(/^(__generated_templates__\/[^(]+)/)?.[1]).filter(Boolean),
);

if (templateBroken.size) {
  console.warn(`\n⚠️  ${templateStructural.length} structural error(s) in ${templateBroken.size} template block(s) — illustrative fragments, not whole files (skipped):`);
  templateStructural.forEach(l => console.warn(' ', l));
}

// 3b — semantic errors in everything that does parse
const templateTypeErrors = runTemplatePass([...templateBroken]).split('\n').filter(l =>
  /error TS[2-9]\d{3}:/.test(l) && !STRUCTURAL.test(l) && !EMPTY_OBJECT_PROP.test(l),
);

if (templateTypeErrors.length) {
  console.error(`\n❌ ${templateTypeErrors.length} type error(s) in the draft templates:`);
  templateTypeErrors.forEach(l => console.error(' ', l));
  console.error('\nThese blocks get copied verbatim — fix the template, not this check.');
  process.exit(1);
}

console.log(`✅ ${templateCount - templateBroken.size} of ${templateCount} template block(s) type-check as real code.`);
