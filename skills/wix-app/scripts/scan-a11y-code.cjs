#!/usr/bin/env node
'use strict';

// oxlint-disable no-console no-shadow preserve-caught-error

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = process.cwd();
const LOCAL_REQUIRE = createRequire(__filename);
const ROOT_REQUIRE = createRequire(path.join(ROOT, 'package.json'));
const parser = loadModule('@babel/parser');
const traverse = loadModule('@babel/traverse').default;
const t = loadModule('@babel/types');

const MAX_RESOLUTION_DEPTH = 4;
const VALID_ARIA_PROPS = new Set([
  'aria-activedescendant',
  'aria-atomic',
  'aria-autocomplete',
  'aria-braillelabel',
  'aria-brailleroledescription',
  'aria-busy',
  'aria-checked',
  'aria-colcount',
  'aria-colindex',
  'aria-colindextext',
  'aria-colspan',
  'aria-controls',
  'aria-current',
  'aria-describedby',
  'aria-description',
  'aria-details',
  'aria-disabled',
  'aria-dropeffect',
  'aria-errormessage',
  'aria-expanded',
  'aria-flowto',
  'aria-grabbed',
  'aria-haspopup',
  'aria-hidden',
  'aria-invalid',
  'aria-keyshortcuts',
  'aria-label',
  'aria-labelledby',
  'aria-level',
  'aria-live',
  'aria-modal',
  'aria-multiline',
  'aria-multiselectable',
  'aria-orientation',
  'aria-owns',
  'aria-placeholder',
  'aria-posinset',
  'aria-pressed',
  'aria-readonly',
  'aria-relevant',
  'aria-required',
  'aria-roledescription',
  'aria-rowcount',
  'aria-rowindex',
  'aria-rowindextext',
  'aria-rowspan',
  'aria-selected',
  'aria-setsize',
  'aria-sort',
  'aria-valuemax',
  'aria-valuemin',
  'aria-valuenow',
  'aria-valuetext',
]);
const VALID_ROLES = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'button',
  'cell',
  'checkbox',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'dialog',
  'directory',
  'document',
  'feed',
  'figure',
  'form',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);
const UNSUPPORTED_ARIA_ELEMENTS = new Set([
  'meta',
  'script',
  'style',
  'head',
  'html',
  'base',
  'link',
  'param',
  'source',
  'track',
  'col',
  'colgroup',
]);

const FILE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];
const parseCache = new Map();
const resolutionWarnings = [];

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

function parseFile(filePath) {
  if (parseCache.has(filePath)) return parseCache.get(filePath);

  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: [
        'jsx',
        'typescript',
        'classProperties',
        'objectRestSpread',
        'optionalChaining',
        'nullishCoalescingOperator',
      ],
      errorRecovery: true,
    });
    const recoverableErrors = Array.isArray(ast.errors)
      ? ast.errors.map((error) => error.message)
      : [];
    const parsed = { ok: true, ast, code, recoverableErrors };
    parseCache.set(filePath, parsed);
    return parsed;
  } catch (error) {
    const parsed = { ok: false, error };
    parseCache.set(filePath, parsed);
    return parsed;
  }
}

function getJsxName(node) {
  if (t.isJSXIdentifier(node)) return node.name;
  if (t.isJSXMemberExpression(node))
    return `${getJsxName(node.object)}.${getJsxName(node.property)}`;
  if (t.isJSXNamespacedName(node)) return `${node.namespace.name}:${node.name.name}`;
  return null;
}

function getAttribute(node, name) {
  return (
    node.attributes.find((attr) => t.isJSXAttribute(attr) && getJsxName(attr.name) === name) || null
  );
}

function getLiteralAttributeValue(attr) {
  if (!attr) return undefined;
  if (!attr.value) return true;
  if (t.isStringLiteral(attr.value)) return attr.value.value;
  if (t.isJSXExpressionContainer(attr.value)) {
    const expr = attr.value.expression;
    if (t.isStringLiteral(expr)) return expr.value;
    if (t.isBooleanLiteral(expr)) return expr.value;
    if (t.isNumericLiteral(expr)) return expr.value;
    if (t.isTemplateLiteral(expr) && expr.expressions.length === 0) {
      return expr.quasis.map((q) => q.value.cooked || '').join('');
    }
  }
  return undefined;
}

function hasTruthyAttribute(node, name) {
  const attr = getAttribute(node, name);
  return Boolean(attr);
}

function isNativeTag(name) {
  return Boolean(name && /^[a-z]/.test(name));
}

function getImportMap(ast) {
  const imports = new Map();

  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value;
      for (const specifier of path.node.specifiers) {
        if (t.isImportDefaultSpecifier(specifier)) {
          imports.set(specifier.local.name, { source, imported: 'default' });
        } else if (t.isImportSpecifier(specifier)) {
          imports.set(specifier.local.name, { source, imported: specifier.imported.name });
        } else if (t.isImportNamespaceSpecifier(specifier)) {
          imports.set(specifier.local.name, { source, imported: '*' });
        }
      }
    },
  });

  return imports;
}

function findRootJsx(pathLike) {
  if (!pathLike) return null;
  if (
    pathLike.isFunctionDeclaration() ||
    pathLike.isFunctionExpression() ||
    pathLike.isArrowFunctionExpression()
  ) {
    if (t.isJSXElement(pathLike.node.body) || t.isJSXFragment(pathLike.node.body))
      return pathLike.node.body;
    if (!t.isBlockStatement(pathLike.node.body)) return null;

    for (const statement of pathLike.node.body.body) {
      if (!t.isReturnStatement(statement)) continue;
      const arg = statement.argument;
      if (t.isJSXElement(arg) || t.isJSXFragment(arg)) return arg;
    }
  }
  return null;
}

function resolveSourceFile(fromFile, source) {
  const basedir = path.dirname(fromFile);
  const tryFile = (candidate) => {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    return null;
  };

  if (source.startsWith('.')) {
    const base = path.resolve(basedir, source);
    for (const ext of FILE_EXTENSIONS) {
      const direct = tryFile(base + ext);
      if (direct) return direct;
    }
    for (const ext of FILE_EXTENSIONS) {
      const indexFile = tryFile(path.join(base, `index${ext}`));
      if (indexFile) return indexFile;
    }
    return tryFile(base);
  }

  try {
    return require.resolve(source, { paths: [basedir, ROOT] });
  } catch (error) {
    resolutionWarnings.push({
      source,
      fromFile,
      method: 'require.resolve',
      message: error.message,
    });
  }

  try {
    return ROOT_REQUIRE.resolve(source);
  } catch (error) {
    resolutionWarnings.push({
      source,
      fromFile,
      method: 'rootRequire.resolve',
      message: error.message,
    });
  }

  return null;
}

function findExportedComponent(ast, exportName) {
  let found = null;

  traverse(ast, {
    FunctionDeclaration(path) {
      if (found) return;
      if (path.node.id && path.node.id.name === exportName) found = findRootJsx(path);
    },
    VariableDeclarator(path) {
      if (found) return;
      if (!t.isIdentifier(path.node.id, { name: exportName })) return;
      const initPath = path.get('init');
      found = findRootJsx(initPath);
    },
    ExportDefaultDeclaration(path) {
      if (found || exportName !== 'default') return;
      const declPath = path.get('declaration');
      if (declPath.isIdentifier()) {
        found = findNamedBindingJsx(ast, declPath.node.name);
      } else {
        found = findRootJsx(declPath);
      }
    },
  });

  return found;
}

function findNamedBindingJsx(ast, name) {
  let found = null;
  traverse(ast, {
    FunctionDeclaration(path) {
      if (found) return;
      if (path.node.id && path.node.id.name === name) found = findRootJsx(path);
    },
    VariableDeclarator(path) {
      if (found) return;
      if (!t.isIdentifier(path.node.id, { name })) return;
      found = findRootJsx(path.get('init'));
    },
  });
  return found;
}

function inferByName(name) {
  const lower = String(name || '').toLowerCase();
  if (!lower) return null;
  if (
    /(^|\.)(img|image|avatar|thumbnail|photo|picture)$/.test(lower) ||
    /(image|avatar|thumbnail|photo|picture)/.test(lower)
  ) {
    return {
      semanticType: 'img',
      confidence: 'low',
      sourceKind: 'heuristic',
      evidence: `Component name "${name}" looks image-like.`,
    };
  }
  if (/(^|\.)(link|anchor|navlink)$/.test(lower) || /(link|anchor)/.test(lower)) {
    return {
      semanticType: 'a',
      confidence: 'low',
      sourceKind: 'heuristic',
      evidence: `Component name "${name}" looks link-like.`,
    };
  }
  if (/(button|btn|iconbutton|textbutton|closebutton)/.test(lower)) {
    return {
      semanticType: 'button',
      confidence: 'low',
      sourceKind: 'heuristic',
      evidence: `Component name "${name}" looks button-like.`,
    };
  }
  if (/(textarea|editor)/.test(lower)) {
    return {
      semanticType: 'textarea',
      confidence: 'low',
      sourceKind: 'heuristic',
      evidence: `Component name "${name}" looks textarea-like.`,
    };
  }
  if (/(input|textfield|search|select|checkbox|radio|switch|toggle)/.test(lower)) {
    return {
      semanticType: 'input',
      confidence: 'low',
      sourceKind: 'heuristic',
      evidence: `Component name "${name}" looks input-like.`,
    };
  }
  return null;
}

function inferFromProps(openingElement) {
  const asValue = getLiteralAttributeValue(getAttribute(openingElement, 'as'));
  if (typeof asValue === 'string' && isNativeTag(asValue)) {
    return {
      semanticType: asValue,
      confidence: 'high',
      sourceKind: 'polymorphic-prop',
      evidence: `The component explicitly sets as="${asValue}".`,
    };
  }

  const componentValue = getLiteralAttributeValue(getAttribute(openingElement, 'component'));
  if (typeof componentValue === 'string' && isNativeTag(componentValue)) {
    return {
      semanticType: componentValue,
      confidence: 'high',
      sourceKind: 'polymorphic-prop',
      evidence: `The component explicitly sets component="${componentValue}".`,
    };
  }

  if (hasTruthyAttribute(openingElement, 'src')) {
    return {
      semanticType: 'img',
      confidence: hasTruthyAttribute(openingElement, 'alt') ? 'low' : 'medium',
      sourceKind: 'prop-evidence',
      evidence: 'The component receives src-related props that suggest image semantics.',
    };
  }

  if (hasTruthyAttribute(openingElement, 'href') || hasTruthyAttribute(openingElement, 'to')) {
    return {
      semanticType: 'a',
      confidence: 'medium',
      sourceKind: 'prop-evidence',
      evidence: 'The component receives href/to props that suggest link semantics.',
    };
  }

  if (hasTruthyAttribute(openingElement, 'onClick')) {
    return {
      semanticType: 'button',
      confidence: 'low',
      sourceKind: 'prop-evidence',
      evidence: 'The component receives onClick, which may indicate button-like behavior.',
    };
  }

  return null;
}

function chooseResolution(current, next) {
  if (!next) return current;
  if (!current) return next;
  const rank = { high: 3, medium: 2, low: 1, unknown: 0 };
  return rank[next.confidence] > rank[current.confidence] ? next : current;
}

function resolveComponentSemantic(filePath, openingElement, context, depth = 0) {
  const name = getJsxName(openingElement.name);
  if (!name)
    return {
      semanticType: 'unknown',
      confidence: 'unknown',
      sourceKind: 'unknown',
      evidence: 'Unable to resolve JSX element name.',
    };

  if (isNativeTag(name)) {
    return {
      semanticType: name,
      confidence: 'high',
      sourceKind: 'native',
      evidence: `The JSX element is the native tag <${name}>.`,
    };
  }

  let resolved = chooseResolution(null, inferFromProps(openingElement));
  resolved = chooseResolution(resolved, inferByName(name));

  if (depth >= MAX_RESOLUTION_DEPTH) {
    return (
      resolved || {
        semanticType: 'unknown',
        confidence: 'unknown',
        sourceKind: 'unknown',
        evidence: `Resolution depth exceeded for ${name}.`,
      }
    );
  }

  const importInfo = context.imports.get(name);
  if (importInfo) {
    const resolvedSource = resolveSourceFile(filePath, importInfo.source);
    if (resolvedSource) {
      const parsed = parseFile(resolvedSource);
      if (parsed.ok) {
        const rootJsx = findExportedComponent(parsed.ast, importInfo.imported);
        if (rootJsx && t.isJSXElement(rootJsx)) {
          const innerImports = getImportMap(parsed.ast);
          const nested = resolveComponentSemantic(
            resolvedSource,
            rootJsx.openingElement,
            { imports: innerImports },
            depth + 1,
          );
          if (nested.semanticType !== 'unknown') {
            const sourceKind = importInfo.source.startsWith('.')
              ? 'local-wrapper'
              : 'package-component';
            resolved = chooseResolution(resolved, {
              semanticType: nested.semanticType,
              confidence: nested.confidence === 'low' ? 'medium' : nested.confidence,
              sourceKind,
              evidence: `${name} resolves through ${path.relative(ROOT, resolvedSource)} to ${nested.semanticType} semantics.`,
            });
          }
        }
      }
    }
  }

  const finalResolution = resolved || {
    semanticType: 'unknown',
    confidence: 'unknown',
    sourceKind: 'unknown',
    evidence: `Could not infer reliable semantics for ${name}.`,
  };
  return finalResolution;
}

function toRelative(filePath) {
  return path.relative(ROOT, filePath) || filePath;
}

function findingFromNode(filePath, node, data) {
  return {
    file: toRelative(filePath),
    line: node.loc ? node.loc.start.line : null,
    column: node.loc ? node.loc.start.column + 1 : null,
    rule: data.rule,
    confidence: data.confidence,
    message: data.message,
    componentName: data.componentName,
    semanticType: data.semanticType,
    evidence: data.evidence,
    sourceKind: data.sourceKind,
  };
}

function scanFile(filePath) {
  const parsed = parseFile(filePath);
  if (!parsed.ok) {
    return {
      parseError: {
        file: toRelative(filePath),
        message: parsed.error.message,
      },
      findings: [],
    };
  }

  const imports = getImportMap(parsed.ast);
  const findings = [];
  const parseWarnings = parsed.recoverableErrors || [];

  traverse(parsed.ast, {
    JSXOpeningElement(path) {
      const node = path.node;
      const name = getJsxName(node.name);
      if (!name) return;

      const semantic = resolveComponentSemantic(filePath, node, { imports });
      const ariaAttrs = node.attributes.filter(
        (attr) => t.isJSXAttribute(attr) && getJsxName(attr.name)?.startsWith('aria-'),
      );
      const roleAttr = getAttribute(node, 'role');

      if (semantic.semanticType === 'img' && semantic.confidence !== 'low') {
        const altAttr = getAttribute(node, 'alt');
        if (!altAttr) {
          findings.push(
            findingFromNode(filePath, node, {
              rule: 'alt-text',
              confidence: semantic.confidence,
              message: `${name} is treated as image-like but is missing an alt prop.`,
              componentName: name,
              semanticType: semantic.semanticType,
              evidence: semantic.evidence,
              sourceKind: semantic.sourceKind,
            }),
          );
        }
      } else if (semantic.semanticType === 'img' && semantic.confidence === 'low') {
        const altAttr = getAttribute(node, 'alt');
        if (!altAttr) {
          findings.push(
            findingFromNode(filePath, node, {
              rule: 'alt-text',
              confidence: semantic.confidence,
              message: `${name} may be image-like and appears to be missing an alt prop.`,
              componentName: name,
              semanticType: semantic.semanticType,
              evidence: semantic.evidence,
              sourceKind: semantic.sourceKind,
            }),
          );
        }
      }

      if (semantic.semanticType === 'a') {
        const hrefAttr = getAttribute(node, 'href');
        const toAttr = getAttribute(node, 'to');
        const hrefValue = getLiteralAttributeValue(hrefAttr);
        const toValue = getLiteralAttributeValue(toAttr);
        const invalidLinkTarget =
          (!hrefAttr && !toAttr) ||
          hrefValue === '' ||
          hrefValue === '#' ||
          hrefValue === 'javascript:void(0)' ||
          toValue === '' ||
          toValue === '#' ||
          toValue === 'javascript:void(0)';
        if (invalidLinkTarget) {
          findings.push(
            findingFromNode(filePath, node, {
              rule: 'anchor-is-valid',
              confidence: semantic.confidence,
              message:
                semantic.confidence === 'low'
                  ? `${name} may be link-like but does not appear to provide a valid navigation target.`
                  : `${name} is treated as link-like but does not provide a valid navigation target.`,
              componentName: name,
              semanticType: semantic.semanticType,
              evidence: semantic.evidence,
              sourceKind: semantic.sourceKind,
            }),
          );
        }
      }

      for (const attr of ariaAttrs) {
        const attrName = getJsxName(attr.name);
        if (!VALID_ARIA_PROPS.has(attrName)) {
          findings.push(
            findingFromNode(filePath, attr, {
              rule: 'aria-props',
              confidence: 'high',
              message: `${attrName} is not a valid ARIA attribute name.`,
              componentName: name,
              semanticType: semantic.semanticType,
              evidence: `The attribute name "${attrName}" is not in the allowed ARIA prop set.`,
              sourceKind: semantic.sourceKind,
            }),
          );
        }
      }

      const roleValue = getLiteralAttributeValue(roleAttr);
      if (typeof roleValue === 'string' && !VALID_ROLES.has(roleValue)) {
        findings.push(
          findingFromNode(filePath, roleAttr, {
            rule: 'aria-role',
            confidence: 'high',
            message: `"${roleValue}" is not a valid ARIA role value.`,
            componentName: name,
            semanticType: semantic.semanticType,
            evidence: `The role value "${roleValue}" is not in the supported ARIA roles set.`,
            sourceKind: semantic.sourceKind,
          }),
        );
      }

      if ((ariaAttrs.length > 0 || roleAttr) && semantic.confidence !== 'low') {
        const semanticTag = semantic.semanticType;
        if (UNSUPPORTED_ARIA_ELEMENTS.has(semanticTag)) {
          findings.push(
            findingFromNode(filePath, node, {
              rule: 'aria-unsupported-elements',
              confidence: semantic.confidence,
              message: `${name} resolves to unsupported element <${semanticTag}> but carries ARIA attributes or role.`,
              componentName: name,
              semanticType: semantic.semanticType,
              evidence: semantic.evidence,
              sourceKind: semantic.sourceKind,
            }),
          );
        }
      }
    },
  });

  return { parseError: null, findings, parseWarnings };
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log(
      JSON.stringify(
        {
          error: 'No files specified.',
          usage: 'node <skill-root>/scripts/scan-a11y-code.cjs <file1> [file2] ...',
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const meta = {
    filesScanned: files.length,
    parser: '@babel/parser',
    supportedRules: [
      'alt-text',
      'anchor-is-valid',
      'aria-props',
      'aria-role',
      'aria-unsupported-elements',
    ],
    confidenceModel: ['high', 'medium', 'low', 'unknown'],
    parseErrors: [],
    resolutionWarnings,
  };

  const findings = [];

  for (const file of files.map((file) => path.resolve(file))) {
    const result = scanFile(file);
    if (result.parseError) meta.parseErrors.push(result.parseError);
    for (const warning of result.parseWarnings || []) {
      meta.parseErrors.push({
        file: toRelative(file),
        message: warning,
      });
    }
    findings.push(...result.findings);
  }

  const summary = {
    findings: findings.length,
    highConfidence: findings.filter((item) => item.confidence === 'high').length,
    mediumConfidence: findings.filter((item) => item.confidence === 'medium').length,
    lowConfidence: findings.filter((item) => item.confidence === 'low').length,
    filesWithFindings: new Set(findings.map((item) => item.file)).size,
    cleanFiles: files.length - new Set(findings.map((item) => item.file)).size,
  };

  console.log(JSON.stringify({ meta, findings, summary }, null, 2));
}

main();
