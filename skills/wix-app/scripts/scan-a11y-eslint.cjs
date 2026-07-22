#!/usr/bin/env node
'use strict';

// oxlint-disable no-console preserve-caught-error

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
  'jsx-a11y/no-interactive-element-to-noninteractive-role': 'error',
  'jsx-a11y/no-noninteractive-element-interactions': 'error',
  'jsx-a11y/no-noninteractive-element-to-interactive-role': 'error',
  'jsx-a11y/no-noninteractive-tabindex': 'error',
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

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log(
      JSON.stringify(
        {
          error: 'No files specified.',
          usage: 'node <skill-root>/scripts/scan-a11y-eslint.cjs <file1> [file2] ...',
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const absoluteFiles = files.map((f) => path.resolve(f));

  const eslint = createEslint();

  const results = await eslint.lintFiles(absoluteFiles);

  const findings = [];
  const parseErrors = [];

  for (const result of results) {
    const relFile = toRelative(result.filePath);

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

  const output = {
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

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});
