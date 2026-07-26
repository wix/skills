#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const refsDir = join(__dirname, '..', '..', 'skills', 'wix-app', 'references');
const outDir = join(__dirname, '__generated__');

try { rmSync(outDir, { recursive: true }); } catch {}
mkdirSync(outDir, { recursive: true });

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
for (const mdFile of findMdFiles(refsDir)) {
  const blocks = extractBlocks(readFileSync(mdFile, 'utf-8'));
  if (!blocks.length) continue;

  let combined = blocks.map(({ code }, i) => transformBlock(code, i)).join('\n\n');
  combined = combined.replace(/^(import .+ from ['"]\.)/gm, '// @ts-ignore\n$1');

  const rel = mdFile.slice(refsDir.length + 1).replace(/\//g, '__').replace(/\.md$/, '');
  writeFileSync(join(outDir, `${rel}.tsx`), combined);
  count++;
}

console.log(`Extracted ${count} files into __generated__/`);

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
  include: ['__generated__/**/*.tsx'],
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
} else {
  console.log('\n✅ No type errors found.');
}
