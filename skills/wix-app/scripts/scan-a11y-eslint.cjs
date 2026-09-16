#!/usr/bin/env node
'use strict';

// oxlint-disable no-console preserve-caught-error

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = process.cwd();
const LOCAL_REQUIRE = createRequire(__filename);
const ROOT_REQUIRE = createRequire(path.join(ROOT, 'package.json'));
const { ESLint } = loadModule('eslint');
const jsxA11y = loadModule('eslint-plugin-jsx-a11y');
const tsParser = loadModule('@typescript-eslint/parser');

const RULE_CONFIG = {
  'jsx-a11y/alt-text': 'error',
  'jsx-a11y/anchor-has-content': 'error',
  'jsx-a11y/anchor-is-valid': 'error',
  'jsx-a11y/aria-activedescendant-has-tabindex': 'error',
  'jsx-a11y/aria-props': 'error',
  'jsx-a11y/aria-proptypes': 'error',
  'jsx-a11y/aria-role': 'error',
  'jsx-a11y/aria-unsupported-elements': 'error',
  'jsx-a11y/click-events-have-key-events': 'error',
  'jsx-a11y/heading-has-content': 'error',
  'jsx-a11y/iframe-has-title': 'error',
  'jsx-a11y/img-redundant-alt': 'error',
  'jsx-a11y/interactive-supports-focus': 'error',
  'jsx-a11y/label-has-associated-control': 'error',
  'jsx-a11y/media-has-caption': 'error',
  'jsx-a11y/mouse-events-have-key-events': 'error',
  'jsx-a11y/no-access-key': 'error',
  'jsx-a11y/no-aria-hidden-on-focusable': 'error',
  'jsx-a11y/no-autofocus': 'error',
  'jsx-a11y/no-distracting-elements': 'error',
  'jsx-a11y/no-interactive-element-to-noninteractive-role': ['error', { canvas: ['img'] }],
  'jsx-a11y/no-noninteractive-element-interactions': 'error',
  'jsx-a11y/no-noninteractive-element-to-interactive-role': 'error',
  // A tabpanel with no focusable content takes tabIndex=0 (ARIA Authoring Practices).
  'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['tabpanel'] }],
  'jsx-a11y/no-redundant-roles': 'error',
  'jsx-a11y/no-static-element-interactions': 'error',
  'jsx-a11y/prefer-tag-over-role': 'error',
  'jsx-a11y/role-has-required-aria-props': 'error',
  'jsx-a11y/role-supports-aria-props': 'error',
  'jsx-a11y/scope': 'error',
  'jsx-a11y/tabindex-no-positive': 'error',
};

function toRelative(filePath) {
  return path.relative(ROOT, filePath) || filePath;
}

/** DOM handler → SDK prop it forwards (FUNCTION-HANDLERS.md). */
const SDK_HANDLER_PROPS = {
  onClick: 'onClick',
  onDoubleClick: 'onDblClick',
  onMouseEnter: 'onMouseIn',
  onMouseLeave: 'onMouseOut',
};
const isSdkRoot = (tag) => /\bid=\{\s*(?:props\.)?id\s*\}/.test(tag);

/** Every handler on the tag forwards its SDK prop, `onClick={onClick}` or `onMouseEnter={props.onMouseIn}`; anything else makes the root a control. */
function forwardsOnlySdkHandlers(tag) {
  const handlers = [...tag.matchAll(/\b(on[A-Z]\w*)=\{([^}]*)\}/g)];
  return (
    handlers.length > 0 &&
    handlers.every(([, name, value]) => {
      const sdkProp = SDK_HANDLER_PROPS[name];
      return Boolean(sdkProp) && value.trim().replace(/^props\./, '') === sdkProp;
    })
  );
}

/** Roles whose native element cannot express a styled component. */
const ROLES_WITHOUT_NATIVE_TAG = new Set(['img', 'presentation', 'none', 'group', 'status']);

/**
 * `role="img"` or `role={cond ? 'img' : undefined}`: every string literal in the role
 * attribute must be an exempt role, so `role={cond ? 'button' : 'img'}` stays flagged.
 */
function roleHasNoNativeTag(tag) {
  const attr = tag.match(/\brole=(?:"[^"]*"|'[^']*'|\{[^}]*\})/);
  if (!attr) return false;
  const literals = [...attr[0].slice(5).matchAll(/["']([^"']*)["']/g)].map((m) => m[1]);
  return literals.length > 0 && literals.every((role) => ROLES_WITHOUT_NATIVE_TAG.has(role));
}

/**
 * Editor React Component patterns that jsx-a11y reads as defects. A rule in
 * `rules` is skipped when the opening tag of the reported element matches `tag`.
 */
const EXEMPTIONS = [
  {
    // SDK handlers (`onClick`, `onMouseIn`, ...) are forwarded on the root
    // element, which carries `id={id}`; the root itself is not the control.
    rules: new Set([
      'jsx-a11y/click-events-have-key-events',
      'jsx-a11y/mouse-events-have-key-events',
      'jsx-a11y/no-noninteractive-element-interactions',
      'jsx-a11y/no-static-element-interactions',
    ]),
    tag: (tag) => isSdkRoot(tag) && forwardsOnlySdkHandlers(tag),
  },
  {
    // Roles whose native element cannot express a styled component: graphics
    // (svg, canvas, star ratings), decorative wrappers, widget groups, live
    // regions. axe still requires their names (`role-img-alt`).
    rules: new Set(['jsx-a11y/prefer-tag-over-role']),
    tag: roleHasNoNativeTag,
  },
];

/** Text of the opening tag that contains the reported range. */
function openingTag(source, msg) {
  const lines = source.split('\n');
  const offset =
    lines.slice(0, msg.line - 1).reduce((n, line) => n + line.length + 1, 0) + msg.column - 1;
  const start = source.lastIndexOf('<', offset);
  if (start === -1) return '';
  // The tag ends at the first `>` outside braces, so `=>` inside handlers does not count.
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    else if (source[i] === '>' && depth === 0) return source.slice(start, i);
  }
  return '';
}

const isExempt = (source, msg) =>
  EXEMPTIONS.some((x) => x.rules.has(msg.ruleId) && x.tag(openingTag(source, msg)));

function severityLabel(severity) {
  if (severity === 2) return 'error';
  if (severity === 1) return 'warning';
  return 'off';
}

function loadModule(name) {
  try {
    return LOCAL_REQUIRE(name);
  } catch (localError) {
    try {
      return ROOT_REQUIRE(name);
    } catch (rootError) {
      throw new Error(
        `Missing dependency "${name}". Local resolution failed: ${localError.message}. Root resolution failed: ${rootError.message}`,
      );
    }
  }
}

function createEslint() {
  try {
    return new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.{tsx,jsx,ts,js}'],
          languageOptions: {
            parser: tsParser,
            parserOptions: {
              ecmaFeatures: { jsx: true },
              ecmaVersion: 2022,
              sourceType: 'module',
            },
          },
          plugins: {
            'jsx-a11y': jsxA11y,
          },
          rules: RULE_CONFIG,
        },
      ],
    });
  } catch (flatConfigError) {
    try {
      return new ESLint({
        useEslintrc: false,
        overrideConfig: {
          parser: '@typescript-eslint/parser',
          plugins: ['jsx-a11y'],
          parserOptions: {
            ecmaFeatures: { jsx: true },
            ecmaVersion: 2022,
            sourceType: 'module',
          },
          rules: RULE_CONFIG,
        },
        extensions: ['.tsx', '.jsx', '.ts', '.js'],
      });
    } catch (legacyConfigError) {
      throw new Error(
        `Failed to initialize ESLint. Flat config error: ${flatConfigError.message}. Legacy config error: ${legacyConfigError.message}`,
      );
    }
  }
}

/**
 * Lint the given files with the jsx-a11y rule set.
 * Returns the same report shape the CLI prints.
 */
async function scan(files) {
  const absoluteFiles = files.map((f) => path.resolve(f));

  const eslint = createEslint();

  const results = await eslint.lintFiles(absoluteFiles);

  const findings = [];
  const parseErrors = [];

  for (const result of results) {
    const relFile = toRelative(result.filePath);
    const source = () => result.source || fs.readFileSync(result.filePath, 'utf8');

    for (const msg of result.messages) {
      if (msg.fatal) {
        parseErrors.push({
          file: relFile,
          line: msg.line,
          column: msg.column,
          message: msg.message,
        });
        continue;
      }

      if (!msg.ruleId || !msg.ruleId.startsWith('jsx-a11y/')) continue;
      if (isExempt(source(), msg)) continue;

      findings.push({
        file: relFile,
        line: msg.line,
        column: msg.column,
        endLine: msg.endLine ?? null,
        endColumn: msg.endColumn ?? null,
        rule: msg.ruleId,
        severity: severityLabel(msg.severity),
        message: msg.message,
      });
    }
  }

  const ruleBreakdown = {};
  for (const f of findings) {
    ruleBreakdown[f.rule] = (ruleBreakdown[f.rule] || 0) + 1;
  }

  return {
    meta: {
      filesScanned: files.length,
      engine: 'eslint + eslint-plugin-jsx-a11y',
      rulesEnabled: Object.keys(RULE_CONFIG).length,
      parseErrors,
    },
    findings,
    summary: {
      totalFindings: findings.length,
      filesWithFindings: new Set(findings.map((f) => f.file)).size,
      cleanFiles: files.length - new Set(findings.map((f) => f.file)).size,
      ruleBreakdown,
    },
  };
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log(
      JSON.stringify(
        {
          error: 'No files specified.',
          usage: 'node <SKILL_ROOT>/scripts/scan-a11y-eslint.cjs <file1> [file2] ...',
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(JSON.stringify(await scan(files), null, 2));
}

module.exports = { scan, RULE_CONFIG };

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: err.message }, null, 2));
    process.exit(1);
  });
}
