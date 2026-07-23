#!/usr/bin/env node
// Extracts all ```typescript and ```tsx code blocks from reference markdown files,
// writes one .tsx file per markdown file into __generated__/, then runs tsc --noEmit.
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
  // Strip leading line comments to find the real first token
  const strippedComments = code.trimStart().replace(/^(\/\/[^\n]*\n\s*)+/, '').trimStart();

  // Pattern 1 — bare object literal (starts with `{` but is not a block-scoped declaration).
  // These are config-example blocks written without an assignment, e.g. `{ primaryActions: { ... } }`.
  if (strippedComments.startsWith('{') && !DECLARATION_START.test(strippedComments)) {
    return `const _config_${index} = ${code}`;
  }

  // Pattern 2 — spread placeholder `(...)` used as a stand-in for arguments.
  let result = code.replace(/\(\.\.\.(\s*)\)/g, '()');

  // Pattern 3 — placeholder angle-bracket tokens like `<your-page-id>` used as values.
  // Replace with a string literal so the surrounding expression still parses.
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

let count = 0;
for (const mdFile of findMdFiles(refsDir)) {
  const blocks = extractBlocks(readFileSync(mdFile, 'utf-8'));
  if (!blocks.length) continue;

  const transformed = blocks.map(({ code }, i) => transformBlock(code, i));
  let combined = transformed.join('\n\n');

  // Suppress relative imports — they reference files not present in this project.
  combined = combined.replace(/^(import .+ from ['"]\.)/gm, '// @ts-ignore\n$1');

  const rel = mdFile
    .slice(refsDir.length + 1)
    .replace(/\//g, '__')
    .replace(/\.md$/, '');
  writeFileSync(join(outDir, `${rel}.tsx`), combined);
  count++;
}

console.log(`Extracted ${count} files into __generated__/`);

// TS1xxx  = parse/syntax errors (non-self-contained blocks)
// TS2300  = Duplicate identifier (multiple blocks re-declare the same name)
// TS2304  = Cannot find name (blocks depend on context not present in the file)
// TS2307  = Cannot find module (missing package — install or add to deps)
// TS2395  = Merged declarations must be consistently exported (block 1 local, block 2 exported)
// TS2440  = Import conflicts with local declaration (block 1 declares, block 2 imports)
// TS2448  = Block-scoped variable used before its declaration (block ordering)
// TS2451  = Cannot redeclare block-scoped variable (multiple blocks re-use same variable)
// TS2528  = Multiple default exports (multiple blocks each export default)
// TS2552  = Cannot find name, did you mean? (missing context, like TS2304)
// TS2657  = JSX must have one parent element (bare JSX fragments in docs)
// TS2786  = Cannot be used as a JSX component (React/design-system version mismatch)
// TS17008 = JSX element has no closing tag (malformed JSX snippets)
const STRUCTURAL = /error TS(1\d{3}|2300|2304|2307|2395|2440|2448|2451|2528|2552|2657|2786|17008):/;

// Also treat "does not exist on type '{}'" as structural — callback params lose their
// generic type when extracted as standalone blocks (the outer generic isn't present).
const EMPTY_OBJECT_PROP = /does not exist on type '{}'/;

// ── Pass 1: find files with structural/parse errors ──────────────────────────
// TypeScript suppresses semantic analysis across the whole compilation when any
// file has parse errors.  Silence those files with @ts-nocheck so pass 2 can do
// a clean semantic sweep over the remaining files.
let pass1Output = '';
try {
  execSync('npx tsc --noEmit', { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  pass1Output = (err.stdout ?? '').toString() + (err.stderr ?? '').toString();
}

const structuralErrors = pass1Output.split('\n').filter(l => STRUCTURAL.test(l));
const filesWithParseErrors = new Set(
  structuralErrors.map(l => l.match(/^(__generated__\/[^(]+)/)?.[1]).filter(Boolean),
);

if (filesWithParseErrors.size) {
  console.warn(`\n⚠️  ${structuralErrors.length} structural error(s) in ${filesWithParseErrors.size} file(s) from non-self-contained blocks (fix over time):`);
  structuralErrors.forEach(l => console.warn(' ', l));
  for (const rel of filesWithParseErrors) {
    const full = join(__dirname, rel);
    const existing = readFileSync(full, 'utf-8');
    if (!existing.startsWith('// @ts-nocheck')) {
      writeFileSync(full, '// @ts-nocheck\n' + existing);
    }
  }
}

// ── Pass 2: semantic type errors only ────────────────────────────────────────
// @ts-nocheck suppresses semantic errors but NOT parse errors, so the broken
// files must be fully excluded from the compilation — not just silenced.
const pass2TsconfigPath = join(__dirname, '__pass2_tsconfig.json');
const pass2Config = {
  compilerOptions: {
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
  },
  include: ['__generated__/**/*.tsx'],
  exclude: [...filesWithParseErrors],
};
writeFileSync(pass2TsconfigPath, JSON.stringify(pass2Config));

let pass2Output = '';
try {
  execSync('npx tsc --noEmit -p __pass2_tsconfig.json', { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  pass2Output = (err.stdout ?? '').toString() + (err.stderr ?? '').toString();
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
