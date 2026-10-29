#!/usr/bin/env node
'use strict';

// oxlint-disable no-console

/**
 * Renders images the user's code generates (a painted canvas, a gradient) to files,
 * so they can be uploaded with `upload-media.cjs` and become `Image` defaults.
 *
 *   node <SKILL_ROOT>/scripts/render-images.cjs <file> <export> '<json args>' ['<json args>' ...]
 *
 * Run from the app root. `<file>` is the .js or .ts file that holds the generator,
 * `<export>` the exported function, and each `<json args>` a JSON array of the
 * arguments for one image, in the order the defaults use them, e.g. `'[3, "dawn"]'`.
 * The function may return a `data:image/...` URL or a canvas. It runs in Node with
 * `document.createElement('canvas')`, `OffscreenCanvas` and `Image` backed by
 * `@napi-rs/canvas`; that and `esbuild` are installed under /tmp/user-images when
 * missing, so the project is never touched.
 *
 * Each run writes into its own new folder (`/tmp/user-images/renders-…`), so the report
 * lists only this run's images and two runs never touch each other's files. The generator
 * is the user's code: it runs in a child process that gets none of this process's
 * environment variables (no tokens or credentials): a fixed PATH, the locale, and HOME
 * pointed at /tmp/user-images. Whatever the generator prints goes to stderr; the report
 * comes back on its own channel, so the printed JSON is always the report.
 *
 * Prints one JSON report; each `renders[].file` is ready to pass to `upload-media.cjs`.
 * Exit codes: 0 every image rendered, 1 at least one failed, 2 the script could not run.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { execFileSync, spawnSync } = require('child_process');

const WORK_DIR = '/tmp/user-images';
const CHILD_FLAG = '--render-child';
// The child writes its report here; its stdout carries only what the generator prints.
const REPORT_FD = 3;
const CHILD_PATH = '/usr/local/bin:/usr/bin:/bin';
const RENDER_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 180_000;
const DEPENDENCIES = ['@napi-rs/canvas', 'esbuild'];
const EXTENSIONS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const USAGE =
  "Usage: node <SKILL_ROOT>/scripts/render-images.cjs <file> <export> '<json args>' ['<json args>' ...]";

function parseArgs(argv) {
  const [file, exportName, ...argSets] = argv;
  if (!file || !exportName || argSets.length === 0) {
    throw new Error('Need a file, an export name and at least one JSON args array.');
  }
  const calls = argSets.map((text) => {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`Args must be a JSON array, got: ${text}`);
    }
    if (!Array.isArray(value)) throw new Error(`Args must be a JSON array, got: ${text}`);
    return value;
  });
  return { file, exportName, calls };
}

function requireFrom(directory, name) {
  return createRequire(path.join(directory, 'noop.js'))(name);
}

function loadDependency(name) {
  for (const directory of [process.cwd(), WORK_DIR]) {
    try {
      return requireFrom(directory, name);
    } catch {
      // Not installed there.
    }
  }
  return undefined;
}

function loadDependencies() {
  const missing = DEPENDENCIES.filter((name) => !loadDependency(name));
  if (missing.length) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    execFileSync(
      'npm',
      [
        'install',
        '--prefix',
        WORK_DIR,
        '--no-save',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        ...missing,
      ],
      { stdio: 'ignore', timeout: INSTALL_TIMEOUT_MS },
    );
  }
  return { canvas: loadDependency('@napi-rs/canvas'), esbuild: loadDependency('esbuild') };
}

// The browser globals a generator touches, backed by @napi-rs/canvas.
function installBrowserGlobals(napi) {
  const createElement = (tag) => {
    if (String(tag).toLowerCase() !== 'canvas') {
      throw new Error(`document.createElement('${tag}') isn't available while rendering`);
    }
    return napi.createCanvas(300, 150);
  };
  globalThis.document = { createElement, hidden: false };
  globalThis.window = globalThis;
  globalThis.devicePixelRatio = 1;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      return napi.createCanvas(width, height);
    }
  };
  globalThis.Image = napi.Image;
}

function loadGenerator(file, exportName, esbuild) {
  const bundle = esbuild.buildSync({
    entryPoints: [path.resolve(file)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    external: ['@napi-rs/canvas'],
  });
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(
    module,
    module.exports,
    createRequire(path.resolve(file)),
  );
  const generator = module.exports[exportName];
  if (typeof generator !== 'function') {
    const found = Object.keys(module.exports).join(', ') || 'none';
    throw new Error(`${file} exports no function "${exportName}" (exports: ${found})`);
  }
  return generator;
}

function toImageBuffer(result) {
  if (typeof result === 'string') {
    const match = /^data:(image\/[\w+.-]+);base64,(.*)$/s.exec(result);
    if (!match) throw new Error('The function returned a string that is not a data:image URL');
    const extension = EXTENSIONS[match[1]];
    if (!extension) throw new Error(`Unsupported image type ${match[1]}`);
    return { bytes: Buffer.from(match[2], 'base64'), extension };
  }
  if (result && typeof result.toBuffer === 'function') {
    return { bytes: result.toBuffer('image/png'), extension: '.png' };
  }
  throw new Error('The function returned neither a data:image URL nor a canvas');
}

async function renderAll({ file, exportName, calls }, { generator, outDir }) {
  // A new folder per run: earlier runs' images are never listed, and concurrent runs don't collide.
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const folder = outDir ?? fs.mkdtempSync(path.join(WORK_DIR, 'renders-'));
  const base = `${path.parse(file).name}-${exportName}`.replace(/[^a-z0-9]+/gi, '-');
  const renders = [];
  for (const [index, args] of calls.entries()) {
    try {
      const { bytes, extension } = toImageBuffer(await generator(...args));
      const output = path.join(folder, `${base}-${index + 1}${extension}`);
      fs.writeFileSync(output, bytes);
      renders.push({ args, status: 'rendered', file: output });
    } catch (error) {
      renders.push({ args, status: 'failed', error: error.message });
    }
  }
  const failed = renders.filter((render) => render.status === 'failed').length;
  return {
    summary: { rendered: renders.length - failed, failed },
    folder,
    renders,
    exitCode: failed ? 1 : 0,
  };
}

/** The only environment the generator's process gets: enough to run Node, nothing secret. */
function childEnv(env) {
  return {
    PATH: CHILD_PATH,
    HOME: WORK_DIR,
    TMPDIR: WORK_DIR,
    LANG: env.LANG ?? 'C.UTF-8',
  };
}

// Runs in the child process: loads the user's generator and renders each call.
async function renderInChild(argv) {
  let options;
  let generator;
  try {
    options = parseArgs(argv);
    const canvas = loadDependency('@napi-rs/canvas');
    const esbuild = loadDependency('esbuild');
    if (!canvas || !esbuild) throw new Error('@napi-rs/canvas and esbuild are not installed');
    installBrowserGlobals(canvas);
    generator = loadGenerator(options.file, options.exportName, esbuild);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  const { exitCode, ...report } = await renderAll(options, { generator });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  try {
    fs.writeSync(REPORT_FD, json);
  } catch {
    process.stdout.write(json); // run by hand, without the report channel
  }
  process.exit(exitCode);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === CHILD_FLAG) return renderInChild(argv.slice(1));
  try {
    parseArgs(argv);
    const { canvas, esbuild } = loadDependencies();
    if (!canvas || !esbuild)
      throw new Error('Could not install @napi-rs/canvas and esbuild under /tmp/user-images');
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const child = spawnSync(process.execPath, [__filename, CHILD_FLAG, ...argv], {
    cwd: process.cwd(),
    env: childEnv(process.env),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    timeout: RENDER_TIMEOUT_MS,
  });
  if (child.error) {
    console.error(`Rendering did not finish: ${child.error.message}\n${USAGE}`);
    process.exit(2);
  }
  // What the generator printed is diagnostics, never part of the report.
  process.stderr.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');
  process.stdout.write(child.output[REPORT_FD] ?? '');
  process.exit(child.status ?? 2);
}

module.exports = { parseArgs, toImageBuffer, renderAll, childEnv };

if (require.main === module) main();
