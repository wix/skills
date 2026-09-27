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
/** `A11y` fields a component may read. ZeroConfig turns each read into an editor control. */
const A11Y_FIELDS = new Set(['ariaLabel']);
const A11Y_FIELDS_LABEL = [...A11Y_FIELDS].join(', ');
const A11Y_CONVERTER = 'convertA11yKeysToHtmlFormat';
const HARDCODED_LABEL_ATTRIBUTES = new Set(['aria-label', 'aria-description']);
const SUPPORTED_RULES = [
  'alt-text',
  'anchor-is-valid',
  'aria-props',
  'aria-role',
  'aria-unsupported-elements',
  'a11y-whole-object',
  'a11y-disallowed-field',
  'hardcoded-aria-label',
];
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
    });
    const parsed = { ok: true, ast, code };
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-part a11y contract helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Peel type assertions, parentheses, and guards such as `a11y && x` or `x ?? {}`. */
function unwrapExpression(node) {
  let current = node;
  for (let guard = 0; current && guard < 20; guard++) {
    if (
      t.isTSAsExpression(current) ||
      t.isTSNonNullExpression(current) ||
      t.isTSTypeAssertion(current) ||
      t.isParenthesizedExpression(current) ||
      (t.isTSSatisfiesExpression && t.isTSSatisfiesExpression(current))
    ) {
      current = current.expression;
    } else if (t.isLogicalExpression(current)) {
      current = current.operator === '&&' ? current.right : current.left;
    } else {
      break;
    }
  }
  return current;
}

function isA11yIdentifierName(name) {
  return name === 'a11y' || name.endsWith('A11y');
}

/** `a11y`, `toggleA11y`, `props.a11y`, `elementProps?.toggle?.a11y`. */
function isA11yLike(node) {
  const expr = unwrapExpression(node);
  if (t.isIdentifier(expr)) return isA11yIdentifierName(expr.name);
  if ((t.isMemberExpression(expr) || t.isOptionalMemberExpression(expr)) && !expr.computed) {
    return t.isIdentifier(expr.property, { name: 'a11y' });
  }
  return false;
}

/** `props.elementProps?.toggle` → ['props', 'elementProps', 'toggle']; null for other shapes. */
function memberChain(node) {
  const expr = unwrapExpression(node);
  if (t.isIdentifier(expr)) return [expr.name];
  if ((t.isMemberExpression(expr) || t.isOptionalMemberExpression(expr)) && !expr.computed) {
    const parent = memberChain(expr.object);
    if (!parent || !t.isIdentifier(expr.property)) return null;
    return [...parent, expr.property.name];
  }
  return null;
}

function isElementPropsPartChain(chain, partsWithA11y) {
  if (!chain || chain.length < 2) return false;
  const index = chain.indexOf('elementProps');
  return index !== -1 && index === chain.length - 2 && partsWithA11y.has(chain[chain.length - 1]);
}

function typeLiteralHasMember(typeNode, memberName) {
  return (
    t.isTSTypeLiteral(typeNode) &&
    typeNode.members.some(
      (member) =>
        t.isTSPropertySignature(member) &&
        ((t.isIdentifier(member.key) && member.key.name === memberName) ||
          (t.isStringLiteral(member.key) && member.key.value === memberName)),
    )
  );
}

/**
 * Names of `elementProps` parts whose declared type carries an `a11y` field,
 * keyed by folder so one component's contract never applies to another.
 * Reads every `*.props.ts` next to the scanned files plus the files themselves.
 */
function collectPropsTypes(files) {
  const partsByDir = new Map();
  const candidates = new Set(files);
  for (const file of files) {
    const dir = path.dirname(file);
    if (!partsByDir.has(dir)) partsByDir.set(dir, new Set());
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.props.ts')) candidates.add(path.join(dir, name));
    }
  }

  for (const file of candidates) {
    const parsed = parseFile(file);
    if (!parsed.ok) continue;
    const partsWithA11y = partsByDir.get(path.dirname(file));
    traverse(parsed.ast, {
      TSPropertySignature(path) {
        const { key, typeAnnotation } = path.node;
        if (!t.isIdentifier(key, { name: 'elementProps' }) || !typeAnnotation) return;
        const literal = typeAnnotation.typeAnnotation;
        if (!t.isTSTypeLiteral(literal)) return;
        for (const member of literal.members) {
          if (!t.isTSPropertySignature(member) || !member.typeAnnotation) continue;
          const partName = t.isIdentifier(member.key)
            ? member.key.name
            : t.isStringLiteral(member.key)
              ? member.key.value
              : null;
          if (partName && typeLiteralHasMember(member.typeAnnotation.typeAnnotation, 'a11y')) {
            partsWithA11y.add(partName);
          }
        }
      },
    });
  }

  return partsByDir;
}

function contractFinding(filePath, node, rule, confidence, message) {
  return findingFromNode(filePath, node, {
    rule,
    confidence,
    message,
    componentName: null,
    semanticType: 'a11y-contract',
    evidence: 'Per-part accessibility contract (ACCESSIBILITY.md).',
    sourceKind: 'contract',
  });
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

function scanFile(filePath, options = {}) {
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
  const partsWithA11y = options.partsWithA11y || new Set();

  const reportDisallowedField = (node, fieldName) => {
    findings.push(
      contractFinding(
        filePath,
        node,
        'a11y-disallowed-field',
        'high',
        `a11y.${fieldName} is read; only ${A11Y_FIELDS_LABEL} may be read. Keep roles, state, and structure in component code.`,
      ),
    );
  };

  traverse(parsed.ast, {
    JSXSpreadAttribute(path) {
      const argument = unwrapExpression(path.node.argument);

      if (isA11yLike(argument)) {
        findings.push(
          contractFinding(
            filePath,
            path.node,
            'a11y-whole-object',
            'high',
            'The whole a11y object is spread onto an element; every field becomes an editor control.',
          ),
        );
        return;
      }

      // A spread identifier may alias `a11y` or an `elementProps` part; follow its declaration.
      let chain = memberChain(argument);
      if (t.isIdentifier(argument)) {
        const binding = path.scope.getBinding(argument.name);
        const declarator = binding && binding.path && binding.path.node;
        if (declarator && t.isVariableDeclarator(declarator) && t.isIdentifier(declarator.id)) {
          if (declarator.init && isA11yLike(declarator.init)) {
            findings.push(
              contractFinding(
                filePath,
                path.node,
                'a11y-whole-object',
                'high',
                `${argument.name} aliases the a11y object and is spread onto an element; read a11y.ariaLabel instead.`,
              ),
            );
            return;
          }
          chain = memberChain(declarator.init);
        }
      }
      if (isElementPropsPartChain(chain, partsWithA11y)) {
        findings.push(
          contractFinding(
            filePath,
            path.node,
            'a11y-whole-object',
            'medium',
            `elementProps.${chain[chain.length - 1]} is spread although its type declares a11y; destructure a11y out first.`,
          ),
        );
      }
    },

    CallExpression(path) {
      const callee = path.node.callee;
      const isConverter =
        t.isIdentifier(callee, { name: A11Y_CONVERTER }) ||
        ((t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
          t.isIdentifier(callee.property, { name: A11Y_CONVERTER }));
      if (isConverter) {
        findings.push(
          contractFinding(
            filePath,
            path.node,
            'a11y-whole-object',
            'high',
            `${A11Y_CONVERTER} writes every a11y field to the DOM; read only the field the part needs.`,
          ),
        );
      }
    },

    'MemberExpression|OptionalMemberExpression'(path) {
      const { node } = path;
      if (node.computed || !t.isIdentifier(node.property)) return;
      if (!isA11yLike(node.object)) return;
      if (A11Y_FIELDS.has(node.property.name)) return;
      reportDisallowedField(node.property, node.property.name);
    },

    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (!t.isObjectPattern(id) || !init || !isA11yLike(init)) return;
      for (const property of id.properties) {
        if (t.isRestElement(property)) {
          findings.push(
            contractFinding(
              filePath,
              property,
              'a11y-whole-object',
              'high',
              'Rest-destructuring a11y keeps every field; pick the single field the part needs.',
            ),
          );
          continue;
        }
        if (!t.isObjectProperty(property) || property.computed) continue;
        const fieldName = t.isIdentifier(property.key)
          ? property.key.name
          : t.isStringLiteral(property.key)
            ? property.key.value
            : null;
        if (fieldName && !A11Y_FIELDS.has(fieldName)) reportDisallowedField(property, fieldName);
      }
    },

    JSXOpeningElement(path) {
      const node = path.node;
      const name = getJsxName(node.name);
      if (!name) return;

      const semantic = resolveComponentSemantic(filePath, node, { imports });
      const ariaAttrs = node.attributes.filter(
        (attr) => t.isJSXAttribute(attr) && getJsxName(attr.name)?.startsWith('aria-'),
      );
      const roleAttr = getAttribute(node, 'role');

      for (const attr of ariaAttrs) {
        const attrName = getJsxName(attr.name);
        if (!HARDCODED_LABEL_ATTRIBUTES.has(attrName)) continue;
        const literal = getLiteralAttributeValue(attr);
        if (typeof literal === 'string' && literal.trim() !== '') {
          findings.push(
            contractFinding(
              filePath,
              attr,
              'hardcoded-aria-label',
              'high',
              `${attrName}="${literal}" is a hardcoded string; use visible text, a11y.ariaLabel, or a constants.ts label.`,
            ),
          );
        }
      }

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

  return { parseError: null, findings };
}

/** Scan the given files. Any syntax error lands in `meta.parseErrors`; the review treats it as fatal. */
function scan(files) {
  const absoluteFiles = files.map((file) => path.resolve(file));
  const partsByDir = collectPropsTypes(absoluteFiles);

  const meta = {
    filesScanned: files.length,
    parser: '@babel/parser',
    supportedRules: SUPPORTED_RULES,
    a11yFields: [...A11Y_FIELDS],
    confidenceModel: ['high', 'medium', 'low', 'unknown'],
    parseErrors: [],
    resolutionWarnings,
  };

  const findings = [];

  for (const file of absoluteFiles) {
    const result = scanFile(file, { partsWithA11y: partsByDir.get(path.dirname(file)) });
    if (result.parseError) meta.parseErrors.push(result.parseError);
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

  return { meta, findings, summary };
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log(
      JSON.stringify(
        {
          error: 'No files specified.',
          usage: 'node <SKILL_ROOT>/scripts/scan-a11y-code.cjs <file1> [file2] ...',
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(JSON.stringify(scan(files), null, 2));
}

module.exports = { scan };

if (require.main === module) {
  main();
}
