#!/usr/bin/env node
'use strict';

// oxlint-disable no-console preserve-caught-error no-underscore-dangle

/**
 * Render audit for one Editor React Component folder.
 *
 * Renders the component with its default props in plain Node (an SSR check),
 * loads the markup into jsdom together with the component's CSS Modules, and
 * runs axe-core against the rendered root. Prints one JSON line.
 *
 * Spawned by `scan-a11y-review.cjs`; also usable standalone:
 *
 *   node <SKILL_ROOT>/scripts/scan-a11y-render.cjs <component-dir>
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();
const LOCAL_REQUIRE = createRequire(__filename);
const ROOT_REQUIRE = createRequire(path.join(ROOT, 'package.json'));

const RCU_SPECIFIER = '@wix/react-component-utils';
/** Scanner-owned wrapper around the rendered component; axe audits this, never the component's own `id`. */
const AUDIT_ROOT_ATTR = 'data-a11y-audit-root';
const COMPONENT_ID = 'component';
const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx'];
/** Everything else a relative import points at (svg, png, mp4, lottie, scss, ...) is served as its file name. */
const LOADABLE_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.json',
  '.node',
  '.css',
  ...SOURCE_EXTENSIONS,
]);
const HTML_SNIPPET_LENGTH = 200;
const PLACEHOLDER_TEXT = 'No content to display yet';
/** Test hook: comma-separated tooling packages to treat as missing. */
const SIMULATE_MISSING = new Set(
  (process.env.A11Y_SIMULATE_MISSING || '').split(',').filter(Boolean),
);

/** Rules that only make sense for a whole page, never for a component fragment. */
const PAGE_RULES = [
  'region',
  'landmark-one-main',
  'landmark-banner-is-top-level',
  'landmark-complementary-is-top-level',
  'landmark-contentinfo-is-top-level',
  'landmark-main-is-top-level',
  'landmark-no-duplicate-banner',
  'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-main',
  'landmark-unique',
  'page-has-heading-one',
  'document-title',
  'html-has-lang',
  'html-lang-valid',
  'html-xml-lang-mismatch',
  'bypass',
  'meta-viewport',
  'meta-viewport-large',
  'meta-refresh',
  'meta-refresh-no-exceptions',
  // `frame-title` stays on: an unnamed iframe inside a component is the component's defect.
  'frame-title-unique',
  'frame-tested',
  'frame-focusable-content',
  // Deprecated in axe 4.x and noisy; `duplicate-id-aria` stays on.
  'duplicate-id',
  'duplicate-id-active',
];

/** Rules that need a layout engine. Disabled on jsdom; a browser engine would enable them. */
const LAYOUT_RULES = [
  'color-contrast',
  'color-contrast-enhanced',
  'target-size',
  'scrollable-region-focusable',
  'link-in-text-block',
  'p-as-heading',
];

const NOT_CHECKED_BY_JSDOM = [
  ...LAYOUT_RULES,
  '--display-driven visibility',
  'keyboard interaction',
];

const SITE_URL = 'https://example.wixsite.com/site';
const HOME_PAGE = { id: 'home', title: 'Home', path: '/', popup: false };

/** Plain-object stand-ins for the site services `@wix/react-component-utils` hooks read. */
const SERVICES = {
  // `useIsEditMode()` returns `!previewMode`; audit live-equivalent output.
  '@wix/site-service-editor-context': { previewMode: true },
  '@wix/site-service-device-info': { deviceType: 'Desktop', reducedMotion: false },
  '@wix/site-service-locale': { language: 'en', direction: 'ltr' },
  '@wix/site-service-pages': {
    pages: { [HOME_PAGE.id]: { title: HOME_PAGE.title, path: HOME_PAGE.path, popup: false } },
    mainPage: HOME_PAGE,
    currentPage: HOME_PAGE,
  },
  '@wix/site-service-url': {
    currentUrl: SITE_URL,
    siteUrl: SITE_URL,
    pages: [],
    pageIdToPrefix: {},
  },
};

const IMPACT_SEVERITY = { critical: 'high', serious: 'high', moderate: 'medium', minor: 'low' };

// ─────────────────────────────────────────────────────────────────────────────
// Dependencies and entry discovery
// ─────────────────────────────────────────────────────────────────────────────

/** Tooling resolves from the consumer project first, then next to this script. */
function loadTooling(names) {
  const modules = {};
  const missing = [];
  for (const name of names) {
    if (SIMULATE_MISSING.has(name)) {
      missing.push(name);
      continue;
    }
    try {
      modules[name] = ROOT_REQUIRE(name);
    } catch {
      try {
        modules[name] = LOCAL_REQUIRE(name);
      } catch {
        missing.push(name);
      }
    }
  }
  return { modules, missing };
}

function listFiles(dir, predicate, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') listFiles(full, predicate, acc);
    } else if (entry.isFile() && predicate(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function resolveEntry(componentDir) {
  const basename = path.basename(componentDir);
  const existing = (name) =>
    fs.existsSync(path.join(componentDir, name)) ? path.join(componentDir, name) : null;
  const tsxFiles = listFiles(componentDir, (name) => name.endsWith('.tsx'));
  const impl =
    existing(`${basename}.tsx`) ||
    tsxFiles.find(
      (file) =>
        path.dirname(file) === componentDir && !path.basename(file).startsWith('component.'),
    ) ||
    null;

  return {
    live: existing('component.tsx'),
    preview: existing('component.preview.tsx'),
    impl,
    props: existing(`${basename}.props.ts`),
    cssFiles: listFiles(componentDir, (name) => name.endsWith('.module.css')),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compile hooks and runtime
// ─────────────────────────────────────────────────────────────────────────────

function installCompileHooks(ts) {
  const compile = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        allowJs: true,
        isolatedModules: true,
      },
    });
    module._compile(outputText, filename);
  };
  for (const ext of SOURCE_EXTENSIONS) require.extensions[ext] = compile;

  // CSS Modules map every class to its own name so the markup keeps the
  // module class names the component CSS targets.
  const cssProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === '__esModule') return true;
        if (prop === 'default') return cssProxy;
        return typeof prop === 'symbol' ? undefined : String(prop);
      },
    },
  );
  require.extensions['.css'] = (module) => {
    module.exports = cssProxy;
  };
}

/**
 * Load React and `@wix/react-component-utils` from the component's own
 * dependency tree so hooks and context share one React instance. The utils
 * package is ESM-only, so it is imported once and served to the transpiled
 * CommonJS component code through `Module._load`.
 */
async function loadRuntime(entryFile) {
  const entryRequire = createRequire(entryFile);
  const React = entryRequire('react');
  const { renderToStaticMarkup } = entryRequire('react-dom/server');

  const rcuDir = (entryRequire.resolve.paths(RCU_SPECIFIER) || [])
    .map((dir) => path.join(dir, RCU_SPECIFIER))
    .find((dir) => fs.existsSync(path.join(dir, 'package.json')));
  if (!rcuDir) {
    throw new Error(`Cannot resolve ${RCU_SPECIFIER} from ${path.relative(ROOT, entryFile)}.`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(rcuDir, 'package.json'), 'utf8'));
  const root = manifest.exports && manifest.exports['.'];
  const entry =
    (typeof root === 'string' ? root : root && (root.import || root.default)) || manifest.main;
  const rcu = { __esModule: true, ...(await import(pathToFileURL(path.join(rcuDir, entry)).href)) };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, ...rest) {
    if (request === RCU_SPECIFIER) return rcu;
    const query = request.indexOf('?');
    const bare = query === -1 ? request : request.slice(0, query);
    // Packages load as-is; only the component's own relative imports get the asset treatment.
    if (query === -1 && !/^[./]/.test(bare))
      return originalLoad.call(this, request, parent, ...rest);
    // Throws MODULE_NOT_FOUND for a missing file, which the audit reports as a loader limit.
    const file = Module._resolveFilename(bare, parent);
    if (query === -1 && LOADABLE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      return originalLoad.call(this, request, parent, ...rest);
    }
    // Vite resource queries: `?raw` is the file text, `?url`/`?inline` its name. A bare asset
    // import (mp4, lottie, scss, ...) is its name too; Node would otherwise parse it as JS.
    const raw = query !== -1 && /(^|&)raw(&|$)/.test(request.slice(query + 1));
    return { __esModule: true, default: raw ? fs.readFileSync(file, 'utf8') : path.basename(file) };
  };

  if (!globalThis.WixReactContext) globalThis.WixReactContext = React.createContext(undefined);
  return { React, renderToStaticMarkup, rcu, WixContext: globalThis.WixReactContext };
}

function createServicesProvider(React, WixContext) {
  const manager = {
    getService(definition) {
      const id = String(definition);
      if (!(id in SERVICES)) {
        throw new Error(`Unknown site service "${id}" requested during render.`);
      }
      return SERVICES[id];
    },
    hasService(definition) {
      return String(definition) in SERVICES;
    },
  };
  return ({ children }) => React.createElement(WixContext.Provider, { value: manager }, children);
}

const interopDefault = (loaded) =>
  loaded && loaded.__esModule && loaded.default !== undefined ? loaded.default : loaded;

function loadComponent(entry, runtime) {
  if (entry.live) {
    return { Component: interopDefault(require(entry.live)), source: 'component.tsx' };
  }
  if (!entry.impl) throw new Error('No component.tsx or implementation .tsx found.');
  const Impl = interopDefault(require(entry.impl));
  const defaultProps = entry.props ? require(entry.props).defaultProps || {} : {};
  return {
    Component: runtime.rcu.withDefaults(Impl, defaultProps),
    source: path.basename(entry.impl),
  };
}

/** The wrapper is the audit boundary, so a component that forwards `id` to an inner element still gets all of its output audited. */
function render(runtime, Provider, Component) {
  const { React, renderToStaticMarkup } = runtime;
  return renderToStaticMarkup(
    React.createElement(
      Provider,
      null,
      React.createElement(
        'div',
        { [AUDIT_ROOT_ATTR]: '' },
        React.createElement(Component, { id: COMPONENT_ID }),
      ),
    ),
  );
}

const LOADER_ERROR_CODES = new Set([
  'MODULE_NOT_FOUND',
  'ERR_REQUIRE_ESM',
  'ERR_REQUIRE_ASYNC_MODULE',
  'ERR_UNKNOWN_FILE_EXTENSION',
]);

/** The component could not be loaded at all: a scanner limitation, never a finding. */
const isLoaderError = (error) =>
  Boolean(error) &&
  (LOADER_ERROR_CODES.has(error.code) || /Cannot find module/.test(error.message || ''));

function classifyRenderError(error) {
  const message = error && error.message ? error.message : String(error);
  if (/No ServiceManagerProvider|Unknown site service/.test(message)) {
    return {
      rule: 'render-unsupported-hook',
      severity: 'low',
      confidence: 'low',
      message: `The component reads a site service the audit cannot provide: ${message}`,
    };
  }
  const browserGlobal =
    /\b(window|document|navigator|localStorage|sessionStorage|matchMedia)\b.*is not defined/.test(
      message,
    );
  return {
    rule: 'render-failed',
    severity: 'high',
    confidence: 'high',
    message: browserGlobal
      ? `The first render touches a browser global: ${message}`
      : `Rendering with defaultProps threw: ${message}`,
  };
}

const checkPreviewPlaceholder = (html) =>
  html.includes(PLACEHOLDER_TEXT) || /class="[^"]*_placeholder_/.test(html);

// ─────────────────────────────────────────────────────────────────────────────
// jsdom + axe
// ─────────────────────────────────────────────────────────────────────────────

/** Strip CSS Modules syntax jsdom cannot parse; keep every declaration. */
function normalizeModuleCss(css) {
  return css
    .replace(/@value[^;]*;/g, '')
    .replace(/\bcomposes\s*:[^;{}]*;/g, '')
    .replace(/:global\(([^)]*)\)/g, '$1')
    .replace(/:local\(([^)]*)\)/g, '$1')
    .replace(/:global\s+/g, '');
}

function truncate(text, length) {
  const compact = String(text || '').replace(/\s+/g, ' ');
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact;
}

async function runAxe(jsdom, axe, html, css) {
  const dom = new jsdom.JSDOM(
    `<!doctype html><html lang="en"><head><style>${css}</style></head><body>${html}</body></html>`,
    { virtualConsole: new jsdom.VirtualConsole() },
  );

  const { window } = dom;
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = window;
  globalThis.document = window.document;
  try {
    const known = new Set(axe.getRules().map((rule) => rule.ruleId));
    const rules = {};
    for (const ruleId of [...PAGE_RULES, ...LAYOUT_RULES]) {
      if (known.has(ruleId)) rules[ruleId] = { enabled: false };
    }
    const root = window.document.querySelector(`[${AUDIT_ROOT_ATTR}]`) || window.document.body;
    const results = await axe.run(root, { rules, resultTypes: ['violations'], elementRef: false });

    const findings = [];
    for (const violation of results.violations) {
      for (const node of violation.nodes) {
        findings.push({
          rule: violation.id,
          source: 'render',
          severity: IMPACT_SEVERITY[violation.impact] || 'medium',
          confidence: 'high',
          message: violation.help,
          detail: truncate(node.failureSummary, 240),
          target: node.target.join(' '),
          html: truncate(node.html, HTML_SNIPPET_LENGTH),
          helpUrl: violation.helpUrl,
        });
      }
    }
    return { findings, rulesRun: known.size - Object.keys(rules).length };
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    if (previous.window === undefined) delete globalThis.window;
    if (previous.document === undefined) delete globalThis.document;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function audit(componentDir) {
  const report = {
    ok: false,
    engine: 'jsdom',
    componentDir: path.relative(ROOT, componentDir) || '.',
    entry: null,
    preview: null,
    ssr: null,
    axe: null,
    findings: [],
    notChecked: [...NOT_CHECKED_BY_JSDOM],
  };

  if (!fs.existsSync(componentDir) || !fs.statSync(componentDir).isDirectory()) {
    report.error = `Component directory not found: ${componentDir}`;
    return report;
  }

  const { modules, missing } = loadTooling(['typescript', 'jsdom', 'axe-core']);
  if (missing.length > 0) {
    report.reason = 'missing-deps';
    report.missing = missing;
    report.error = `Missing render dependencies: ${missing.join(', ')}. Install them (SKILL.md step 2) and rerun.`;
    return report;
  }

  const entry = resolveEntry(componentDir);
  if (!entry.live && !entry.impl) {
    report.error = 'No component.tsx or implementation .tsx found.';
    return report;
  }

  installCompileHooks(modules.typescript);
  const runtime = await loadRuntime(entry.live || entry.impl);
  const Provider = createServicesProvider(runtime.React, runtime.WixContext);

  // Live render: the markup visitors get.
  let liveHtml = null;
  try {
    const { Component, source } = loadComponent(entry, runtime);
    report.entry = source;
    liveHtml = render(runtime, Provider, Component);
    report.ssr = { ok: true, bytes: liveHtml.length };
  } catch (error) {
    if (isLoaderError(error)) {
      report.reason = 'loader';
      report.error = truncate(error.stack || error.message, 600);
      return report;
    }
    report.ssr = { ok: false, error: truncate(error && error.stack ? error.stack : error, 600) };
    report.findings.push({ ...classifyRenderError(error), source: 'render' });
  }

  // Preview render: must not fall back to the placeholder with default props.
  if (entry.preview) {
    try {
      const Preview = interopDefault(require(entry.preview));
      const placeholder = checkPreviewPlaceholder(render(runtime, Provider, Preview));
      report.preview = placeholder ? 'placeholder' : 'ok';
      if (placeholder) {
        report.findings.push({
          rule: 'preview-placeholder',
          source: 'render',
          severity: 'high',
          confidence: 'high',
          message:
            'component.preview.tsx renders the fallback placeholder with defaultProps, so the editor shows an empty box.',
        });
      }
    } catch (error) {
      if (isLoaderError(error)) {
        report.reason = 'loader';
        report.error = truncate(error.stack || error.message, 600);
        return report;
      }
      report.preview = 'failed';
      report.findings.push({
        rule: 'preview-render-failed',
        source: 'render',
        severity: 'medium',
        confidence: 'high',
        message: `component.preview.tsx threw with defaultProps: ${truncate(error && error.message, 200)}`,
      });
    }
  }

  if (liveHtml !== null) {
    const css = entry.cssFiles
      .map((file) => normalizeModuleCss(fs.readFileSync(file, 'utf8')))
      .join('\n');
    const result = await runAxe(modules.jsdom, modules['axe-core'], liveHtml, css);
    report.axe = { rulesRun: result.rulesRun };
    report.findings.push(...result.findings);
  }

  report.ok = true;
  return report;
}

async function main() {
  const componentDir = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!componentDir) {
    console.log(
      JSON.stringify({
        ok: false,
        usage: 'node <SKILL_ROOT>/scripts/scan-a11y-render.cjs <component-dir>',
      }),
    );
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(await audit(path.resolve(componentDir))));
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        error: truncate(error && error.stack ? error.stack : error, 800),
      }),
    );
    process.exit(2);
  }
}

module.exports = {
  PAGE_RULES,
  LAYOUT_RULES,
  normalizeModuleCss,
  classifyRenderError,
  checkPreviewPlaceholder,
};

if (require.main === module) main();
