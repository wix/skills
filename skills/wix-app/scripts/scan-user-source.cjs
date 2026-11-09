#!/usr/bin/env node
'use strict';

// oxlint-disable no-console

/**
 * Checks a component built from the user's code before `validate`: one command,
 * one JSON report.
 *
 *   node <SKILL_ROOT>/scripts/scan-user-source.cjs <component-dir> [--source <file|dir> ...]
 *
 * Run from the app root. The user's files default to `.wix/agentInput/attachments`
 * (unzipped folders included); pass `--source` for code saved anywhere else.
 * Each failure names the `USER-SOURCES.md` step it enforces. Warnings are things
 * the script can't decide; check each one yourself.
 *
 * Exit codes: 0 no failures, 1 at least one failure, 2 the script could not run.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SOURCE_DIR = '.wix/agentInput/attachments';
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const SOURCE_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  '.css',
  '.html',
  '.vue',
  '.svelte',
  '.json',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
// Project and tool configuration that comes along in a zipped project; never content.
const CONFIG_JSON = /^(?:package(?:-lock)?|tsconfig.*|jsconfig.*|.*\.config|\.?[\w-]*rc)\.json$/i;
// Fields an owner edits as text, in a source list's items.
const TEXT_FIELD =
  /^(?:title|text|label|name|caption|description|heading|question|answer|detail|subtitle|summary|part)$/i;
const SCAFFOLD_PROPS = new Set(['id', 'className', 'direction', 'a11y', 'elementProps']);
const PLATFORM_VARIABLE = /^--(wix|wst)-/;
// Style properties the design panel edits; set inline, they win over the panel.
const PANEL_STYLE_KEY =
  /\b(background|backgroundColor|color|fontFamily|fontSize|fontWeight|letterSpacing|lineHeight|borderColor|borderRadius|boxShadow)\s*:\s*([^,}]+)/g;
// COMPONENT-CONTRACT.md's default image pool: stock photos for slots the user gave no image for.
const DEFAULT_POOL = [
  '11062b_2f97b87dcea2446fa48e9ad9c5457ae1~mv2',
  '11062b_73f31c7e7d3544c69dc8ecd8d34c5717~mv2',
  '11062b_3682ebfcb08e4da5b3168b62819a1e68~mv2',
  '11062b_45e67783d39c4963ab9e4fc418173233~mv2',
  '11062b_4c11f014b0d04948b2e6f554076bc40a~mv2',
];
// Read by the editor itself, not by the component.
const SCAFFOLD_VARIABLES = new Set(['--display']);
// Hooks, a React import, or JSX returned from a function. Markup inside strings
// (`innerHTML = '<div>…</div>'`) is how plain logic builds elements, so it doesn't count.
const REACT_MARKERS =
  /\buse(?:State|Effect|LayoutEffect|Ref|Memo|Callback|Reducer|Context)\s*\(|\bReact\.\w|from\s+['"]react['"]|(?:return|=>)\s*\(\s*<[A-Za-z>]/;
// Markup the logic builds instead of JSX. Canvas, media and loading helpers aren't visible parts.
const ELEMENT_CREATION = /\bcreateElement\(\s*['"`]([a-z][\w-]*)['"`]/g;
const NON_VISIBLE_TAGS = new Set([
  'canvas',
  'video',
  'audio',
  'img',
  'source',
  'style',
  'script',
  'link',
  'template',
]);
const MARKUP_INJECTION = /\.(?:innerHTML|outerHTML)\s*\+?=\s*[^;]*<|insertAdjacentHTML\s*\(/;
const CANVAS_MARKERS =
  /getContext\s*\(|WebGLRenderer|WebGL2RenderingContext|from\s+['"](?:three|p5|pixi\.js|ogl|regl)(?:\/[^'"]*)?['"]|new\s+p5\s*\(|createShader\s*\(/;
const MIN_LINE_LENGTH = 12;
const COPIED_SHARE = 0.3;
// Tailwind's default breakpoints, the widths its sm:/md:/lg:/xl:/2xl: variants start at.
const TAILWIND_WIDTHS = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
// The main scaffold file legitimately keeps the source's handlers and effects, so only
// a file that is mostly the source's lines counts as the copied component.
const MAIN_COPIED_SHARE = 0.6;
// A source's logic counts as copied when this share of its lines is in the port, and is only
// checked from this many lines.
const KEPT_LOGIC_SHARE = 0.5;
const MIN_LOGIC_LINES = 25;
// Module CSS that styles this many of the source's own global classes is the source's
// stylesheet moved in whole, not rules on the component's parts.
const FOREIGN_GLOBAL_CLASSES = 3;
const USAGE =
  'Usage: node <SKILL_ROOT>/scripts/scan-user-source.cjs <component-dir> [--source <file|dir> ...]';

function parseArgs(argv) {
  const options = { componentDir: undefined, sources: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') {
      if (argv[i + 1] === undefined) throw new Error('--source needs a file or folder');
      options.sources.push(argv[i + 1]);
      i += 1;
    } else if (argv[i].startsWith('--')) {
      throw new Error(`Unknown option ${argv[i]}`);
    } else if (options.componentDir === undefined) {
      options.componentDir = argv[i];
    } else {
      throw new Error(`Unexpected argument ${argv[i]}`);
    }
  }
  if (!options.componentDir) throw new Error('No component folder given.');
  return options;
}

function listFiles(target, extensions) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return extensions.has(path.extname(target).toLowerCase()) ? [target] : [];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.name !== 'node_modules' && !entry.name.startsWith('.'))
    .flatMap((entry) => listFiles(path.join(target, entry.name), extensions));
}

// File extensions compare in lower case: `Slides.JSON` is a JSON file.
function extOf(file) {
  return path.extname(file).toLowerCase();
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function significantLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= MIN_LINE_LENGTH);
}

// Share of a file's significant lines that appear verbatim in one of the user's files.
function copiedShare(text, sourceLines) {
  const lines = significantLines(text);
  if (lines.length === 0 || sourceLines.size === 0) return 0;
  return lines.filter((line) => sourceLines.has(line)).length / lines.length;
}

function scaffoldFiles(name) {
  return {
    main: `${name}.tsx`,
    props: `${name}.props.ts`,
    css: `${name}.module.css`,
    fixed: new Set([
      'component.tsx',
      'component.preview.tsx',
      `${name}.tsx`,
      `${name}.props.ts`,
      `${name}.extension.ts`,
      `${name}.generated.ts`,
      `${name}.module.css`,
    ]),
  };
}

// Top-level keys of the exported `<Name>Props` object type, also when several share a line
// (`disabled?: boolean; name?: string;`).
function declaredProps(propsText) {
  const start = propsText.search(/export\s+(?:type|interface)\s+\w+Props\b[^{]*\{/);
  if (start < 0) return [];
  const names = [];
  let depth = 0;
  let line = '';
  for (const char of propsText.slice(propsText.indexOf('{', start))) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) break;
    if (char === '\n' || (char === ';' && depth === 1)) {
      // A JSDoc on the prop's own line (`/** @min 0 */ duration?: number;`) is not part of its name.
      const match =
        depth === 1 &&
        /^\s*(?:readonly\s+)?['"]?([A-Za-z_$][\w$]*)['"]?\??\s*:/.exec(
          line.replace(/\/\*.*?\*\//g, ''),
        );
      if (match) names.push(match[1]);
      line = '';
    } else {
      line += char;
    }
  }
  return names;
}

// What each failure means for the site owner, in words they use: no file names,
// props or CSS. The agent quotes these in its final message for what it could not fix.
const OWNER_SENTENCES = {
  'copied-react-component':
    'The component was added mostly as it was uploaded, so some of its parts can’t be edited from the editor panels yet.',
  'unread-prop': (subject) => `The “${subject}” setting doesn’t change the component yet.`,
  'dropped-source-option': (subject) =>
    `Some options the uploaded component had (such as ${subject}) aren’t in the settings panel yet.`,
  'image-without-uri': 'Some images can’t be replaced from the panel yet.',
  'source-images-replaced-by-pool':
    'The component shows stock photos instead of the images from your upload; you can replace them in the panel.',
  'inline-style-blocks-panel': 'Some colors and fonts can’t be changed from the design panel yet.',
  'logic-builds-elements':
    'Some parts of the component, like its labels and pop-ups, can’t be selected or styled in the editor yet.',
  'dropped-responsive-rules':
    'Some screen sizes, or dark mode, may look different than in your upload yet.',
  'array-prop-without-defaults': (subject) =>
    `The “${subject}” list in Manage Items starts empty, though the component shows its items.`,
  'source-list-without-array-prop':
    'Some lists of items, like its labels or points, can’t be edited from Manage Items yet.',
  'view-state-without-element-state':
    'The component’s views (like its open view) can’t be designed separately in the editor yet.',
  'global-stylesheet': 'Some parts’ styles can’t be changed from the design panel yet.',
  'root-display': 'The layout may look different in the editor than in your upload.',
  'new-handler-condition':
    'Some clicks on the component don’t work the way they did in your upload yet.',
  'dropped-source-measurement': 'Some parts may not line up the way they did in your upload yet.',
  'fixed-data-attribute':
    'Some of the component’s effects may not run the way they did in your upload yet.',
  'number-without-range':
    'Some number settings have no limits, so they can be set to values that don’t work.',
  'color-as-text-prop':
    'Some colors are typed as text in the settings panel instead of picked in the design panel.',
  'generated-image-without-default':
    'The images the component draws itself don’t appear in the panel, so they can’t be replaced yet.',
  'undeclared-css-variable': 'Some colors or sizes can’t be changed from the design panel yet.',
  'unread-css-variable': 'Some colors in the design panel don’t change the component yet.',
  'unregistered-canvas-variable':
    'Some colors of the drawing can’t be picked from the design panel yet.',
  'no-variable-change-listener':
    'Color changes from the design panel show only after the page reloads.',
  'play-state-beside-animation':
    'The motion can start again in the editor after a change, though it should stay paused there.',
  'added-background': 'The component has a background color your upload didn’t have.',
  'object-prop': (subject) =>
    `The “${subject}” settings start empty in the panel and have no limits yet.`,
  'dropped-children-slot':
    'Nothing can be placed inside the component yet, though your upload had room for content.',
  'dropped-link-default':
    'Some links from your upload can’t be changed in the panel, or don’t show until a link is set.',
  'dropped-source-color': (subject) =>
    `Some colors your upload offered (such as ${subject}) can’t be changed from the design panel yet.`,
  'pointer-listener-on-child':
    'The component reacts to the pointer only over part of it, not over its text and buttons.',
  'engine-recreated':
    'The animation can restart or disappear after pausing it or changing a setting.',
  'font-as-text-prop':
    'Some fonts are typed as text in the settings panel instead of picked in the design panel.',
  'color-without-panel-default':
    'Some colors show no value in the design panel, though the component has them.',
  'duplicate-link-field': 'Some buttons have two link settings; only one of them is needed.',
  'screen-reader-text-prop':
    'Some settings hold text only screen readers hear; they don’t change anything on the page.',
  'form-name-prop': 'The settings panel has a “Name” field the page never shows.',
  'part-style-not-literal':
    'Some text styles show code instead of a font or color in the design panel.',
  'hex-parser-on-css-color':
    'Changing some colors in the design panel doesn’t change the drawing yet.',
  'value-in-both-panels': (subject) =>
    `Some settings (such as ${subject}) appear in both the settings and design panels, and only one of them works.`,
  'text-part-without-color': 'Some text shows an empty color in its text panel, though it has one.',
  'rewritten-source-logic':
    'Parts of your upload’s animation or drawing were rebuilt, so they may look or move differently.',
  'dropped-source-library':
    'Some animations or effects work differently than in your upload, because a library it used wasn’t added.',
  'replaced-source-font': (subject) =>
    `The component uses different fonts than your upload (it should use ${subject}).`,
};

function ownerSentence(check, subject) {
  const sentence = OWNER_SENTENCES[check];
  return typeof sentence === 'function' ? sentence(humanize(subject ?? '')) : sentence;
}

function humanize(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
}

// The option props (numbers, booleans, fixed choices) a source's `…Props` type
// offers. Content props are often renamed or split in a port; options rarely are.
function sourceOptionProps(text) {
  const options = [];
  for (const match of text.matchAll(
    /(?:export\s+)?(?:interface|type)\s+\w*Props\b[^{=]*=?\s*\{/g,
  )) {
    let depth = 0;
    let line = '';
    for (const char of text.slice(match.index + match[0].length - 1)) {
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) break;
      if (char === '\n') {
        const prop =
          depth === 1 && /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*([^;/]+)/.exec(line);
        if (prop && /^(?:number|boolean|(?:\s*\|?\s*['"][^'"]+['"])+)\s*$/.test(prop[2].trim())) {
          options.push(prop[1]);
        }
        line = '';
      } else {
        line += char;
      }
    }
  }
  return options;
}

// The body of the exported `<Name>Props` type, one field per line, for checks that look at its
// fields: fields written several to a line are split at their top-level `;`.
function declaredPropsBlock(propsText) {
  const start = propsText.search(/export\s+(?:type|interface)\s+\w+Props\b[^{]*\{/);
  if (start < 0) return '';
  const open = propsText.indexOf('{', start);
  let depth = 0;
  let block = '';
  for (let i = open; i < propsText.length; i += 1) {
    const char = propsText[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    block += char === ';' && depth === 1 ? ';\n' : char;
    if (depth === 0) return block;
  }
  return block;
}

// Top-level fields of the exported `<Name>Props` type, with their written types.
function declaredPropTypes(propsText) {
  const fields = [];
  let depth = 0;
  for (const line of declaredPropsBlock(propsText).split('\n')) {
    const match =
      depth === 1 &&
      /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*([^;]+);?/.exec(
        line.replace(/\/\*.*?\*\//g, ''),
      );
    if (match) fields.push({ name: match[1], type: match[2].trim() });
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return fields;
}

// Number fields of the `<Name>Props` type with no @min/@max on their line or the one above.
function numberPropsWithoutRange(propsText) {
  const lines = declaredPropsBlock(propsText).split('\n');
  return lines
    .map((line, index) => ({ line, above: lines[index - 1] ?? '' }))
    .filter(({ line }) =>
      /^\s*(?:readonly\s+)?[A-Za-z_$][\w$]*\??\s*:\s*number\s*;?\s*$/.test(
        line.replace(/\/\*\*.*?\*\//, ''),
      ),
    )
    .filter(({ line, above }) => !/@(?:min|max)\b/.test(line + above))
    .map(({ line }) => /([A-Za-z_$][\w$]*)\??\s*:/.exec(line.replace(/\/\*\*.*?\*\//, ''))[1]);
}

function hexDefault(propsText, name) {
  return new RegExp(`\\b${name}\\s*:\\s*['"\`]#[0-9a-f]{3,8}['"\`]`, 'i').test(propsText);
}

// Names of array literals of objects that carry text an owner would edit
// (a title, label or caption with a space in it), e.g. `const DEFAULT_HOTSPOTS = [{ title: 'Weatherproof lid', … }]`.
function textLists(text) {
  const lists = [];
  for (const match of text.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\[\s*\{/g,
  )) {
    let depth = 0;
    let end = match.index + match[0].lastIndexOf('[');
    for (; end < text.length; end += 1) {
      if (text[end] === '[') depth += 1;
      if (text[end] === ']') depth -= 1;
      if (depth === 0) break;
    }
    const body = text.slice(match.index, end);
    if (
      /\b(?:title|text|label|name|caption|description|heading|question|answer|detail|subtitle|summary|part|t|s)\s*:\s*['"`][^'"`\n]*\s[^'"`\n]*['"`]/.test(
        body,
      )
    ) {
      lists.push(match[1]);
    }
  }
  return lists;
}

// Lists in an attached JSON data file (`items.json`, or `{ "slides": [...] }` inside one):
// arrays whose objects carry text an owner would edit.
function jsonTextLists(text, file) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const lists = [];
  const holdsText = (item) =>
    item &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    Object.entries(item).some(
      ([key, value]) => TEXT_FIELD.test(key) && typeof value === 'string' && value.trim() !== '',
    );
  const visit = (value, name) => {
    if (Array.isArray(value)) {
      if (value.some(holdsText)) lists.push(name);
    } else if (value && typeof value === 'object') {
      for (const [key, field] of Object.entries(value)) visit(field, `${name}.${key}`);
    }
  };
  visit(data, path.basename(file));
  return lists;
}

// A prop counts as read when the component takes it from its props, destructured in the
// component's parameters or from `props`, or as `props.name`, and then uses that name. A
// field of something else (`item.title`) or a comment doesn't count.
function propIsRead(prop, code) {
  const name = prop.replace(/\$/g, '\\$');
  if (
    new RegExp(`\\bprops\\??\\.${name}\\b|\\bprops\\[\\s*['"\`]${name}['"\`]\\s*\\]`).test(code)
  ) {
    return true;
  }
  const destructured = [
    ...code.matchAll(
      /(?:\bfunction\s*[\w$]*\s*\(|=\s*(?:async\s*)?\(|\bforwardRef\(\s*(?:function\s*[\w$]*\s*)?\()\s*\{([^{}]*)\}/g,
    ),
    ...code.matchAll(/\{([^{}]*)\}\s*=\s*props\b/g),
  ];
  for (const [, body] of destructured) {
    for (const entry of body.split(',')) {
      const match = new RegExp(`^\\s*${name}\\s*(?::\\s*([A-Za-z_$][\\w$]*))?\\s*(?:=|$)`).exec(
        entry,
      );
      if (!match) continue;
      const local = (match[1] ?? prop).replace(/\$/g, '\\$');
      // One match is the destructuring itself. `name:` is an object key, except as the
      // middle of a ternary (`dark ? darkImage : image`).
      const uses =
        code.match(
          new RegExp(`(?<![\\w$.])${local}\\b(?!\\s*:)|(?<=\\?\\s*)${local}\\b(?=\\s*:)`, 'g'),
        ) ?? [];
      if (uses.length > 1) return true;
    }
  }
  // Props handed on whole (`{...props}`, `propsRef.current = props`) are read field by field.
  return (
    /\.\.\.props\b|=\s*props\b|\(\s*props\s*[,)]/.test(code) &&
    new RegExp(`\\.${name}\\b`).test(code)
  );
}

// The class strings a file renders with: `className="a b"`, `className={'a b'}`, and the
// string arguments of cn/clsx/classnames calls, nested parentheses included.
function classStrings(code) {
  const strings = [
    ...matchAll(code, /\bclassName\s*=\s*["']([^"']+)["']/g),
    ...matchAll(code, /\bclassName\s*=\s*\{\s*["'`]([^"'`$]+)["'`]\s*\}/g),
  ];
  for (const match of code.matchAll(/\b(?:cn|clsx|cx|classNames|classnames|twMerge)\(/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < code.length && depth > 0) {
      if (code[end] === '(') depth += 1;
      else if (code[end] === ')') depth -= 1;
      end += 1;
    }
    strings.push(
      ...matchAll(code.slice(match.index + match[0].length, end - 1), /["'`]([^"'`$]+)["'`]/g),
    );
  }
  return strings.map((value) => value.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

function withoutComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function matchAll(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

// The text from an opening `{`, `(` or `[` to its match, both included.
function balanced(text, open) {
  const close = { '{': '}', '(': ')', '[': ']' }[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === text[open]) depth += 1;
    else if (text[i] === close) depth -= 1;
    if (depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

// The object literal around a position, from its unmatched `{` to its `}`.
function enclosingObject(text, index) {
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1;
    if (text[i] === '{') {
      if (depth === 0) return balanced(text, i);
      depth -= 1;
    }
  }
  return '';
}

// The JSX opening tag that contains a position, e.g. the root element around its clsx call.
function openingTag(text, index) {
  const start = text.lastIndexOf('<', index);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') depth -= 1;
    if (text[i] === '>' && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

// Fields of the source's exported `…Props` types, with their written types.
function sourcePropFields(text, typeName) {
  const fields = [];
  for (const match of text.matchAll(/export\s+(?:interface|type)\s+(\w*Props)\b[^{=]*=?\s*\{/g)) {
    if (typeName && match[1] !== typeName) continue;
    let depth = 0;
    for (const line of balanced(text, match.index + match[0].length - 1).split('\n')) {
      const field =
        depth === 1 && /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*([^;/]+)/.exec(line);
      if (field) fields.push({ name: field[1], type: field[2].trim() });
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    }
  }
  return fields;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The component a source file exports by default (`export default function X`,
// `export default X`, or its only exported component), with its destructured props and
// the props type it is annotated with.
function mainComponent(text) {
  const exported = matchAll(text, /export\s+(?:function|const)\s+([A-Z][\w$]*)/g);
  const name =
    /export\s+default\s+function\s+([A-Z][\w$]*)/.exec(text)?.[1] ??
    /export\s+default\s+([A-Z][\w$]*)\s*;?\s*$/m.exec(text)?.[1] ??
    (exported.length === 1 ? exported[0] : undefined);
  if (!name) return undefined;
  const signature = new RegExp(
    String.raw`(?:function\s+${escapeRegExp(name)}\s*|\b${escapeRegExp(name)}\b[^=
]*=\s*(?:React\.)?(?:\w+\()?)\(\s*(\{[^}]*\})?\s*(?::\s*([A-Za-z_$][\w$]*))?`,
  ).exec(text);
  return {
    name,
    params: signature?.[1] ?? '',
    propsType: signature?.[2] ?? `${name}Props`,
  };
}

function scan({ componentDir, sources }) {
  if (!fs.existsSync(componentDir) || !fs.statSync(componentDir).isDirectory()) {
    throw new Error(`Component folder not found: ${componentDir}`);
  }
  const componentName = path.basename(path.resolve(componentDir));
  const scaffold = scaffoldFiles(componentName);
  const failures = [];
  const warnings = [];
  const fail = (check, file, step, message, subject) =>
    failures.push({ check, file, step, message, owner: ownerSentence(check, subject) });
  const warn = (check, file, step, message) => warnings.push({ check, file, step, message });

  const sourceFiles = (sources.length ? sources : [DEFAULT_SOURCE_DIR]).flatMap((target) =>
    listFiles(target, SOURCE_EXTENSIONS),
  );
  const sourceLines = new Set(sourceFiles.flatMap((file) => significantLines(read(file))));

  const codeFiles = listFiles(componentDir, CODE_EXTENSIONS).filter(
    (file) => !file.endsWith('.d.ts') && !file.endsWith('.generated.ts'),
  );
  const relative = (file) => path.relative(process.cwd(), file);
  const texts = new Map(codeFiles.map((file) => [file, read(file)]));
  const cssPath = path.join(componentDir, scaffold.css);
  const css = fs.existsSync(cssPath) ? read(cssPath) : '';
  const mainPath = path.join(componentDir, scaffold.main);
  const mainText = texts.get(mainPath) ?? '';
  const propsPath = path.join(componentDir, scaffold.props);
  const propsText = fs.existsSync(propsPath) ? read(propsPath) : '';

  const sourceCode = sourceFiles
    .filter((file) => CODE_EXTENSIONS.has(extOf(file)))
    .map(read)
    .join('\n');

  // Step 1: the source's React component is never copied, imported or rendered.
  const mainShare = copiedShare(mainText, sourceLines);
  if (mainShare >= MAIN_COPIED_SHARE) {
    fail(
      'copied-react-component',
      relative(mainPath),
      1,
      `${Math.round(mainShare * 100)}% of ${scaffold.main} is the user's code: the source's component was copied into the scaffold file. Rewrite it as the scaffold component: named parts with their global and module classes and elementProps (PARTS.md), the props from ${scaffold.props}, and the source's handlers and effects moved in as they are.`,
    );
  }
  // A file beside the scaffold may hold a sub-component kept as the source wrote it (a canvas
  // child with its effect). It fails when it holds the source's exported component, which the
  // main file then renders, or when it is the engine copy and still has React in it.
  const sourceComponents = [
    ...matchAll(sourceCode, /export\s+(?:default\s+)?(?:function|class)\s+([A-Z][\w$]*)/g),
    ...matchAll(sourceCode, /export\s+(?:default\s+)?const\s+([A-Z][\w$]*)\s*[:=]/g),
    ...matchAll(sourceCode, /export\s+default\s+([A-Z][\w$]*)\s*;?\s*$/gm),
  ];
  for (const [file, text] of texts) {
    const base = path.basename(file);
    if (scaffold.fixed.has(base)) continue;
    const share = copiedShare(text, sourceLines);
    const hasReact = REACT_MARKERS.test(text);
    const imported = new RegExp(`from\\s+['"]\\./${path.parse(base).name}(?:\\.[jt]sx?)?['"]`).test(
      mainText,
    );
    const holdsSourceComponent = sourceComponents.some((name) =>
      new RegExp(`\\b(?:function|class)\\s+${name}\\b|\\bconst\\s+${name}\\s*[:=]`).test(text),
    );
    if (hasReact && share >= COPIED_SHARE && (holdsSourceComponent || /-engine\./.test(base))) {
      fail(
        'copied-react-component',
        relative(file),
        1,
        `${Math.round(share * 100)}% of this file is the user's code and it still has React code (hooks or JSX)${
          imported ? `, and ${scaffold.main} imports it` : ''
        }. Keep only the logic with no hooks or JSX in an engine file, and move the source's component into ${scaffold.main} as the scaffold component (named parts, props from ${scaffold.props}, its hooks and effects as they are); delete this copy.`,
      );
    } else if (hasReact && /\.[jt]sx$/.test(base)) {
      warn(
        'extra-react-file',
        relative(file),
        1,
        `A React file outside the scaffold. If it is the source's component or a copy of it, move its markup, props and styles into ${scaffold.main} instead.`,
      );
    }
  }

  // Step 1: the source's logic (an engine, models, a painter) is copied, never rewritten. Its
  // top-level functions with no hooks or JSX should mostly reappear in the port. Lines compare
  // without spacing, semicolons or quote style, so a reformatted copy still counts.
  const normalize = (code) => code.replace(/[\s;]+/g, '').replace(/["`]/g, "'");
  const flatPort = normalize(withoutComments([...texts.values()].join('\n')));
  const inPort = (line) => flatPort.includes(line);
  const logicOf = (code) =>
    withoutComments(code)
      .split(/\n(?=(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\b)/)
      .filter(
        (chunk) =>
          !REACT_MARKERS.test(chunk) &&
          (/\bfunction\b|=>/.test(chunk) || /^(?:export\s+)?(?:default\s+)?class\b/.test(chunk)),
      )
      .map((chunk) => ({
        name: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([\w$]+)/.exec(
          chunk,
        )?.[1],
        lines: chunk
          .split('\n')
          .map(normalize)
          .filter((line) => line.length >= MIN_LINE_LENGTH),
      }));
  const flatName = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sourcesWithLogic = sourceFiles
    .filter((file) => CODE_EXTENSIONS.has(extOf(file)))
    .map((file) => ({ file, text: read(file), logic: logicOf(read(file)) }))
    .filter(({ logic }) => logic.flatMap((chunk) => chunk.lines).length >= MIN_LOGIC_LINES);
  // The source this port came from: the one whose component has its name, else the only one.
  const portedSource =
    sourcesWithLogic.find(({ text }) =>
      matchAll(text, /export\s+default\s+(?:function|class)\s+([A-Z][\w$]*)/g).some(
        (name) => flatName(name) === flatName(componentName),
      ),
    ) ?? (sourcesWithLogic.length === 1 ? sourcesWithLogic[0] : undefined);
  if (portedSource) {
    const logicLines = portedSource.logic.flatMap((chunk) => chunk.lines);
    const kept = logicLines.filter(inPort).length / logicLines.length;
    if (kept < KEPT_LOGIC_SHARE) {
      const rewritten = portedSource.logic
        .filter(
          ({ name, lines }) =>
            name && lines.filter(inPort).length < lines.length * KEPT_LOGIC_SHARE,
        )
        .map(({ name }) => name);
      fail(
        'rewritten-source-logic',
        relative(mainPath),
        1,
        `Only ${Math.round(kept * 100)}% of the logic in ${path.basename(portedSource.file)} (${rewritten.slice(0, 6).join(', ')}${rewritten.length > 6 ? ', …' : ''}) is in the port: it was rewritten, so what it draws and how it moves differ from the source. cp the source file to ${componentName}-engine.${/\.tsx?$/.test(portedSource.file) ? 'ts' : 'js (plus a .d.ts)'}, delete only its components, hooks and JSX, and change the rest only to read props and CSS variables (USER-SOURCES.md steps 1-2).`,
      );
    }
  }

  // Step 3: an inline style beats every design-panel edit of the same property,
  // including a design-panel variable the module CSS declares.
  const panelVariables = new Set([
    ...matchAll(css, /(--[\w-]+)\s*:/g),
    ...matchAll(css, /@property\s+(--[\w-]+)/g),
  ]);
  for (const [file, text] of texts) {
    for (const [, body] of text.matchAll(/style=\{\{([^{}]*)\}/g)) {
      const blocked = [
        ...[...body.matchAll(PANEL_STYLE_KEY)]
          .filter((match) => !/^\s*['"`]?var\(/.test(match[2]))
          .map((match) => match[1]),
        ...matchAll(body, /['"`](--[\w-]+)['"`]\s*:/g).filter((variable) =>
          panelVariables.has(variable),
        ),
      ];
      if (blocked.length) {
        fail(
          'inline-style-blocks-panel',
          relative(file),
          3,
          `An inline style sets ${[...new Set(blocked)].join(', ')}, which overrides the design panel. Put the source's values in the part's module CSS rule; for a theme or mode, toggle a class or data attribute and keep each value in CSS.`,
        );
      }
    }
  }

  // Step 3: styles live in module CSS, never in a plain stylesheet or a <style> tag.
  for (const [file, text] of texts) {
    const sheets = [
      ...matchAll(
        text,
        /import\s+(?:[\w${},\s*]+\s+from\s+)?['"](\.{1,2}\/[^'"?]+\.css)(?:\?[^'"]*)?['"]/g,
      ),
      ...matchAll(text, /require\(\s*['"](\.{1,2}\/[^'"?]+\.css)['"]/g),
    ].filter((sheet) => !sheet.endsWith('.module.css'));
    const styleTag = /<style[\s>]/.test(text) || /createElement\(\s*['"`]style['"`]/.test(text);
    if (sheets.length || styleTag) {
      fail(
        'global-stylesheet',
        relative(file),
        3,
        `This file ${[...sheets.map((sheet) => `imports ${sheet}`), ...(styleTag ? ['adds a <style> tag'] : [])].join(' and ')}, which the design panel can't edit. Move each rule into ${scaffold.css}, on the part it styles (a named part's rule, or the root), with the same values, and delete the import or tag.`,
      );
    }
  }
  // The source's stylesheet moved into module CSS as :global(.its-classes) is still a stylesheet
  // the design panel can't edit: the parts' rules must be on their own module classes.
  const foreignGlobals = [
    ...new Set(
      matchAll(css, /:global\(\s*\.([A-Za-z_][\w-]*)/g).filter(
        (cls) => cls !== componentName && !cls.startsWith(`${componentName}-`),
      ),
    ),
  ];
  if (foreignGlobals.length >= FOREIGN_GLOBAL_CLASSES) {
    fail(
      'global-stylesheet',
      relative(cssPath),
      3,
      `${scaffold.css} styles the source's own global classes (${foreignGlobals
        .slice(0, 6)
        .map((cls) => `.${cls}`)
        .join(
          ', ',
        )}${foreignGlobals.length > 6 ? ', …' : ''}), so the design panel can't edit them. Move each rule onto the module class of the part it styles, with the same values, and drop the global class.`,
    );
  }
  // Step 3: the root's display is the editor's (`--display`, CSS-GUIDELINES.md); a copied
  // `display` on the root rule overrides it and breaks the source's flex or grid layout.
  // The root's module class is the first styles.X in the clsx call that starts with the
  // component's own class, also after other strings (`clsx('name', 'sh-root', styles.x)`).
  const rootCall = new RegExp(`clsx\\(\\s*['"\`]${componentName}['"\`]([^)]*)\\)`).exec(mainText);
  const rootClass = /styles\.([A-Za-z_$][\w$]*)/.exec(rootCall?.[1] ?? '')?.[1] ?? 'root';
  const rootRuleSetsDisplay = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(
    ([, selector, body]) =>
      selector.split(',').some((part) => part.trim() === `.${rootClass}`) &&
      /(?:^|[;\s])display\s*:/.test(body),
  );
  if (rootRuleSetsDisplay) {
    fail(
      'root-display',
      relative(cssPath),
      3,
      `The .${rootClass} rule sets display directly, which overrides the editor's --display and breaks the layout. Write the source's root display as --display (e.g. --display: flex; flex-direction: column) and keep its other values.`,
    );
  }
  // Step 5: the source's breakpoints and dark mode stay: @container queries at the same widths
  // (Tailwind's md: is 768px) and a prefers-color-scheme rule for its dark: variants.
  const sourceStyleText = [
    sourceCode,
    ...sourceFiles.filter((file) => !CODE_EXTENSIONS.has(extOf(file))).map(read),
  ].join('\n');
  const sourceTokens = classStrings(withoutComments(sourceCode)).flatMap((value) =>
    value.split(' '),
  );
  const breakpoints = new Set([
    ...sourceTokens.flatMap((token) => {
      const prefix = /^(sm|md|lg|xl|2xl):/.exec(token)?.[1];
      return prefix ? [TAILWIND_WIDTHS[prefix]] : [];
    }),
    ...matchAll(sourceStyleText, /@media[^{]*?\((?:min|max)-width\s*:\s*(\d+)px/g).map(Number),
  ]);
  const containerWidths = matchAll(css, /@container[^{]*?\((?:min|max)-width\s*:\s*(\d+)px/g).map(
    Number,
  );
  const missingWidths = [...breakpoints].filter(
    (width) => !containerWidths.some((query) => Math.abs(query - width) <= 1),
  );
  const darkInSource =
    sourceTokens.some((token) => token.startsWith('dark:')) ||
    /prefers-color-scheme\s*:\s*dark/.test(sourceStyleText);
  const darkInPort =
    /prefers-color-scheme\s*:\s*dark/.test(css) ||
    /['"]dark['"]/.test(declaredPropsBlock(propsText));
  const droppedRules = [
    ...(missingWidths.length
      ? [
          `${missingWidths.map((width) => `${width}px`).join(', ')} breakpoint${missingWidths.length > 1 ? 's' : ''}`,
        ]
      : []),
    ...(darkInSource && !darkInPort ? ['dark-mode colors'] : []),
  ];
  if (droppedRules.length) {
    fail(
      'dropped-responsive-rules',
      relative(cssPath),
      5,
      `The port drops the source's ${droppedRules.join(' and ')}. Write each source breakpoint as a @container query at the same width with the source's values (Tailwind sm/md/lg/xl/2xl are 640/768/1024/1280/1536px), and its dark: variants or dark @media rules as a @media (prefers-color-scheme: dark) rule.`,
    );
  }
  for (const sheet of matchAll(css, /@import\s+(?:url\()?['"]?(\.{1,2}\/[^'")\s]+\.css)/g)) {
    fail(
      'global-stylesheet',
      relative(cssPath),
      3,
      `${scaffold.css} imports ${sheet}, whose rules the design panel can't edit. Move them into ${scaffold.css} on the parts they style, and delete the import.`,
    );
  }

  // Step 4: a view or mode the whole component switches into is a root ElementState.
  if (!/\bElementState\b/.test(declaredPropsBlock(propsText))) {
    const views = [];
    for (const [file, text] of texts) {
      const base = path.basename(file);
      if (!/\.[jt]sx$/.test(base) || base === 'component.tsx' || base === 'component.preview.tsx')
        continue;
      for (const match of text.matchAll(
        /const\s+\[\s*([A-Za-z_$][\w$]*)\s*,\s*set\w*\s*\]\s*=\s*(?:React\.)?useState(?:<[^>]*>)?\(\s*([^)]*)\)/g,
      )) {
        const [, state, initial] = match;
        const isMode =
          /^['"`]/.test(initial.trim()) && /mode|view|screen|layout|display/i.test(state);
        const isView =
          /^(?:true|false)$/.test(initial.trim()) &&
          /open|expand|explod|flip|detail|collaps|zoom|fullscreen|reveal/i.test(state);
        if (isMode || isView) views.push(state);
      }
    }
    if (views.length) {
      fail(
        'view-state-without-element-state',
        relative(propsPath),
        4,
        `The component switches views with ${[...new Set(views)].join(', ')} in useState, and ${scaffold.props} has no ElementState prop, so the editor has no state to design it in. Add a root ElementState prop per DESIGN-STATES.md and keep the state in sync with it.`,
      );
    }
  }

  // Step 7: every declared prop is read by the component.
  const readers = [...texts]
    .filter(([file]) => {
      const base = path.basename(file);
      return (
        base !== scaffold.props &&
        base !== 'component.tsx' &&
        base !== 'component.preview.tsx' &&
        !base.endsWith('.extension.ts')
      );
    })
    .map(([, text]) => text)
    .join('\n');
  const readerCode = withoutComments(readers);
  for (const prop of declaredProps(propsText)) {
    if (SCAFFOLD_PROPS.has(prop)) continue;
    if (!propIsRead(prop, readerCode)) {
      fail(
        'unread-prop',
        relative(propsPath),
        7,
        `"${prop}" is declared but nothing reads it. Wire it to what it controls, or remove it if the source has no such option.`,
        prop,
      );
    }
  }

  // Step 2: visible elements are JSX named parts, never markup the logic builds.
  for (const [file, text] of texts) {
    const built = [
      ...matchAll(text, ELEMENT_CREATION).filter((tag) => !NON_VISIBLE_TAGS.has(tag.toLowerCase())),
      ...(MARKUP_INJECTION.test(text) ? ['innerHTML'] : []),
    ];
    if (built.length) {
      fail(
        'logic-builds-elements',
        relative(file),
        2,
        `This file builds visible markup itself (${[...new Set(built)].join(', ')}), so the editor can't select or style it. Render each element (hotspots, tooltips, labels, slides) in JSX as a named part per PARTS.md, and have the logic find it through a data-* attribute and only position, show or update it.`,
      );
    }
  }

  // Step 2: every list of items the source holds becomes an array prop.
  const listSources = [
    ...sourceFiles.filter((file) => CODE_EXTENSIONS.has(extOf(file))).map(read),
    ...[...texts]
      .filter(([file]) => !scaffold.fixed.has(path.basename(file)))
      .map(([, text]) => text),
  ];
  const sourceLists = [
    ...new Set([
      ...listSources.flatMap(textLists),
      ...sourceFiles
        .filter((file) => extOf(file) === '.json' && !CONFIG_JSON.test(path.basename(file)))
        .flatMap((file) => jsonTextLists(read(file), file)),
    ]),
  ];
  if (sourceLists.length && !/\bArray<|\[\]\s*;/.test(declaredPropsBlock(propsText))) {
    fail(
      'source-list-without-array-prop',
      relative(propsPath),
      2,
      `The source holds ${sourceLists.join(', ')} as lists of items, and ${scaffold.props} has no array prop. Make each an Array<{…}> prop whose defaults are the source's items, so Manage Items can edit them, and have the logic read the list from props.`,
    );
  }
  // An array prop with no defaults starts Manage Items empty, while the code still shows the
  // source's own list as a fallback (`hotspotList || DEFAULT_HOTSPOTS`).
  const defaultsBlock = propsText.slice(Math.max(0, propsText.search(/\bdefaultProps\b/)));
  const emptyLists = sourceLists.length
    ? declaredPropTypes(propsText)
        .filter(({ type }) => /\bArray</.test(type) || /\[\]\s*$/.test(type))
        .map(({ name }) => name)
        .filter((name) => !new RegExp(`\\b${name}\\s*:`).test(defaultsBlock))
    : [];
  if (emptyLists.length) {
    fail(
      'array-prop-without-defaults',
      relative(propsPath),
      2,
      `${emptyLists.join(', ')} ${emptyLists.length > 1 ? 'have' : 'has'} no defaults, so Manage Items starts empty while the code falls back to the source's own list. Put the source's items in defaultProps and have the code read only the prop.`,
      emptyLists[0],
    );
  }
  // A list of texts written into the component's own JSX files is never editable.
  for (const [file, text] of texts) {
    const base = path.basename(file);
    if (!/\.[jt]sx$/.test(base) || base === 'component.tsx' || base === 'component.preview.tsx')
      continue;
    const lists = textLists(text);
    if (lists.length) {
      fail(
        'source-list-without-array-prop',
        relative(file),
        2,
        `${lists.join(', ')} ${lists.length > 1 ? 'are lists' : 'is a list'} of texts written into the component, so the owner can't edit them. Move each into ${scaffold.props} as an Array<{…}> prop (or text props) with these values as defaults.`,
      );
    }
  }

  // Step 3: numbers carry their range (COMPONENT-CONTRACT.md: @min/@max).
  const unranged = numberPropsWithoutRange(propsText);
  if (unranged.length) {
    fail(
      'number-without-range',
      relative(propsPath),
      3,
      `${unranged.join(', ')} ${unranged.length > 1 ? 'are numbers' : 'is a number'} without @min/@max. Add the range the source allows (its clamp, slider or docs) in the unit the owner thinks in.`,
    );
  }

  // Step 2: colors are design-panel variables, not text the owner types.
  const colorProps = declaredPropTypes(propsText)
    .filter(
      ({ name, type }) =>
        /^string$/.test(type) && (/colou?r/i.test(name) || hexDefault(propsText, name)),
    )
    .map(({ name }) => name);
  if (colorProps.length) {
    fail(
      'color-as-text-prop',
      relative(propsPath),
      2,
      `${colorProps.join(', ')} ${colorProps.length > 1 ? 'are colors' : 'is a color'} typed as a string prop, a text field in the settings panel. Make each a CSS custom property declared on the root (registered with @property on a canvas) that the code reads, so the owner picks it in the design panel.`,
    );
  }

  // Step 3: every option the source offers stays a prop ("never drop it").
  const portedProps = declaredProps(propsText).map((name) => name.toLowerCase());
  const dropped = [
    ...new Set(
      sourceFiles
        .filter((file) => CODE_EXTENSIONS.has(extOf(file)))
        .flatMap((file) => sourceOptionProps(read(file))),
    ),
  ].filter((name) => {
    const lower = name.toLowerCase();
    return !portedProps.some((ported) => ported.includes(lower) || lower.includes(ported));
  });
  if (dropped.length) {
    fail(
      'dropped-source-option',
      relative(propsPath),
      3,
      `The source offers ${dropped.join(', ')} as options, and ${scaffold.props} has none of them. Keep each as a prop with the source's default (numbers with @min/@max), and pass it to what it controls; never hardcode it.`,
      dropped.slice(0, 3).map(humanize).join(', '),
    );
  }

  // Step 6: the source's own images (painted or linked) are the defaults, never the stock pool.
  const PAINTS = /\.(?:toDataURL|toBlob)\s*\(|URL\.createObjectURL\s*\(/;
  const sourceMarkup = sourceFiles
    .filter((file) => !CODE_EXTENSIONS.has(extOf(file)) && extOf(file) !== '.json')
    .map(read)
    .join('\n');
  const sourceText = `${sourceCode}\n${sourceMarkup}`;
  // Images the source has: painted ones, attached image files, imported or `url()` files, and
  // image URLs, also extensionless CDN links when they sit in a src, an image field or `url()`.
  const sourceHasImages =
    PAINTS.test(sourceCode) ||
    (sources.length ? sources : [DEFAULT_SOURCE_DIR]).some(
      (target) => listFiles(target, IMAGE_EXTENSIONS).length > 0,
    ) ||
    /https?:\/\/[^\s'"`)]+\.(?:png|jpe?g|webp|gif|avif)\b/i.test(sourceText) ||
    /(?:\bfrom\s*|\brequire\(\s*|\burl\(\s*)['"]?[^'"()\s]+\.(?:png|jpe?g|webp|gif|avif)\b/i.test(
      sourceText,
    ) ||
    /(?:\bsrc\s*[=:]\s*\{?\s*|\b(?:image|img|photo|picture|poster|thumbnail|backgroundImage)\s*:\s*|\burl\(\s*)['"`]?https?:\/\//i.test(
      sourceText,
    );
  const poolDefaults = DEFAULT_POOL.filter((file) => propsText.includes(file));
  if (sourceHasImages && poolDefaults.length) {
    fail(
      'source-images-replaced-by-pool',
      relative(propsPath),
      6,
      `The source has its own images, but ${poolDefaults.length} default${poolDefaults.length > 1 ? 's come' : ' comes'} from the contract's stock pool. Upload the source's images (render the ones it paints with render-images.cjs) and use those as the defaults. If uploading or rendering one fails, keeping the pool image for it is fine: say so in your final message with the script's error.`,
    );
  }

  // Step 6: every Image default is a Wix Media file.
  for (const literal of propsText.match(/\{[^{}]*\burl\s*:[^{}]*\}/g) ?? []) {
    if (!/\buri\s*:\s*['"`][^'"`]+['"`]/.test(literal)) {
      fail(
        'image-without-uri',
        relative(propsPath),
        6,
        `This default has a url and no uri: ${literal.replace(/\s+/g, ' ').slice(0, 120)}. Upload it with upload-media.cjs and use the { uri, url } it prints.`,
      );
    }
  }

  // Step 6: images the code generates become uploaded defaults too, also when the port
  // dropped the painter (a CSS gradient in its place): the source still paints them.
  const allCode = [...texts.values()].join('\n');
  const hasImageField = /\bImage\b/.test(propsText.replace(/import[^;]*;/g, ''));
  // A Wix Media file ID counts however it is written (`uri: '…'` or a helper like `image('…', alt)`).
  const hasImageDefault = /\buri\s*:\s*['"`][^'"`]+['"`]|\b[0-9a-f]{6}_[0-9a-f]{32}~mv2\.\w+/.test(
    propsText,
  );
  if (hasImageField && !hasImageDefault && (PAINTS.test(allCode) || PAINTS.test(sourceCode))) {
    fail(
      'generated-image-without-default',
      relative(propsPath),
      6,
      `The ${PAINTS.test(allCode) ? 'code generates' : 'source paints'} its images at runtime (toDataURL, toBlob or createObjectURL), and no Image default has a uri, so the panel shows no images. Copy the painter from the source unchanged into the engine file and export it (step 1), render each default from there with render-images.cjs, upload the files with upload-media.cjs, and use the results as the Image defaults; keep the generator for items left without an image. Never replace the painter with CSS or a new drawing.`,
    );
  }

  // Step 3: the source's handlers move as they are; an added element stops its own events.
  // `event.target === ref.current`, `e.target !== e.currentTarget`, either way round.
  const TARGET = String.raw`\b(?:event|e|evt|ev)\.target\b`;
  const OTHER = String.raw`(?:\b[\w$]+\.current\b|\b(?:event|e|evt|ev)\.currentTarget\b)`;
  const targetGuard = new RegExp(
    `${TARGET}\\s*[!=]==?\\s*${OTHER}|${OTHER}\\s*[!=]==?\\s*${TARGET}`,
  );
  if (!targetGuard.test(withoutComments(sourceCode))) {
    for (const [file, text] of texts) {
      if (!targetGuard.test(withoutComments(text))) continue;
      fail(
        'new-handler-condition',
        relative(file),
        3,
        "A handler checks event.target against a ref, which the source never does, so clicks on the component's children (its slides, images or text) are ignored. Keep the source's handler as it is, and have the element you added (the play button) call event.stopPropagation() in its own onPointerDown, onPointerUp and onClick.",
      );
    }
  }

  // Step 3: a source that measures its parts to place them (the arc picker's anchor and
  // selection frame) loses its layout when a port replaces the measuring with fixed CSS.
  const MEASURES = {
    ResizeObserver: /\bResizeObserver\b/,
    offsetWidth: /\.offsetWidth\b/,
    clientWidth: /\.clientWidth\b/,
    getBoundingClientRect: /\.getBoundingClientRect\s*\(/,
    useLayoutEffect: /\buseLayoutEffect\b/,
  };
  const portCode = withoutComments(allCode);
  const sourceMeasures = Object.keys(MEASURES).filter((name) =>
    MEASURES[name].test(withoutComments(sourceCode)),
  );
  if (sourceMeasures.length && !Object.values(MEASURES).some((pattern) => pattern.test(portCode))) {
    fail(
      'dropped-source-measurement',
      relative(mainPath),
      3,
      `The source measures its parts to place them (${sourceMeasures.join(', ')}), and the port measures nothing, so its layout comes from fixed values instead. Port the source's measuring code and what it positions as they are, with only prop and ref names changed.`,
    );
  }

  // Step 3: an attribute only the source's code sets (`root.dataset.gl = 'on'`) starts unset;
  // a fixed value in the port's JSX (`data-gl="off"`) trips the source's own checks of it.
  const sourceLogic = withoutComments(sourceCode);
  for (const [file, text] of texts) {
    const fixed = new Map();
    for (const match of withoutComments(text).matchAll(
      /\s(data-[a-z][\w-]*)=(?:"([^"]*)"|'([^']*)'|\{\s*(['"`])([^'"`]*)\4\s*\})/g,
    )) {
      fixed.set(match[1], match[2] ?? match[3] ?? match[5]);
    }
    for (const [attribute, value] of fixed) {
      const key = attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const setInJsx = new RegExp(`\\s${attribute}=`).test(sourceLogic);
      const setByCode = new RegExp(
        `\\.dataset\\.${key}\\b|\\.dataset\\[\\s*['"\`]${key}['"\`]|(?:get|set|remove|toggle|has)Attribute\\(\\s*['"\`]${attribute}['"\`]`,
      ).test(sourceLogic);
      if (setInJsx || !setByCode) continue;
      fail(
        'fixed-data-attribute',
        relative(file),
        3,
        `The JSX sets ${attribute}="${value}", which the source never does: only the source's code sets ${attribute} (dataset.${key}), and its checks expect it to start unset. Remove ${attribute}="${value}" from the JSX and keep the source's code as it is.`,
      );
    }
  }

  // Step 2: CSS variables the code or CSS reads are declared on the root.
  const declaredInCss = new Set(matchAll(css, /(--[\w-]+)\s*:/g));
  const registered = new Set(matchAll(css, /@property\s+(--[\w-]+)/g));
  const setByCode = new Set([
    ...matchAll(allCode, /['"`](--[\w-]+)['"`]\s*:/g),
    ...matchAll(allCode, /setProperty\(\s*['"`](--[\w-]+)/g),
  ]);
  // A read through a variable (`getPropertyValue(token)`) reads the names the code spells out.
  const readsByName = /getPropertyValue\(\s*[A-Za-z_$`]/.test(allCode);
  const readByCode = new Set([
    ...matchAll(allCode, /getPropertyValue\(\s*['"`](--[\w-]+)/g),
    ...(readsByName
      ? matchAll(allCode, /['"`](--[\w-]+)['"`]/g).filter((name) => !setByCode.has(name))
      : []),
  ]);
  const readByCss = new Set(matchAll(css, /var\(\s*(--[\w-]+)/g));
  for (const variable of readByCode) {
    if (PLATFORM_VARIABLE.test(variable) || declaredInCss.has(variable)) continue;
    fail(
      'undeclared-css-variable',
      relative(cssPath),
      2,
      `The code reads ${variable}, but ${scaffold.css} never declares it on the root${registered.has(variable) ? ' (an @property rule alone is not a declaration)' : ''}. Declare it on the root with the source's value, so it shows in the design panel.`,
    );
  }
  for (const variable of readByCss) {
    if (
      PLATFORM_VARIABLE.test(variable) ||
      declaredInCss.has(variable) ||
      registered.has(variable) ||
      setByCode.has(variable)
    )
      continue;
    fail(
      'undeclared-css-variable',
      relative(cssPath),
      2,
      `The CSS reads ${variable}, but nothing declares or sets it.`,
    );
  }

  const mentionedByCode = new Set(matchAll(allCode, /['"`](--[\w-]+)['"`]/g));
  for (const variable of declaredInCss) {
    if (PLATFORM_VARIABLE.test(variable) || SCAFFOLD_VARIABLES.has(variable)) continue;
    if (readByCss.has(variable) || readByCode.has(variable) || mentionedByCode.has(variable))
      continue;
    fail(
      'unread-css-variable',
      relative(cssPath),
      2,
      `${variable} is declared, but neither the CSS nor the code reads it, so changing it in the design panel does nothing. Read it where the source uses that value${
        CANVAS_MARKERS.test(allCode)
          ? ' (on a canvas, through the cached reader in CANVAS-COMPONENTS.md)'
          : ''
      }, or remove it.`,
    );
  }

  // CANVAS-COMPONENTS.md: values a canvas draws with are registered, and edits are heard.
  if (CANVAS_MARKERS.test(allCode)) {
    for (const variable of readByCode) {
      if (PLATFORM_VARIABLE.test(variable) || registered.has(variable)) continue;
      fail(
        'unregistered-canvas-variable',
        relative(cssPath),
        2,
        `The canvas reads ${variable}, but it has no @property rule, so the design panel can't type it. Register it per CANVAS-COMPONENTS.md.`,
      );
    }
    // An edit is heard only with both: a transitionend listener, and a transition on the variable.
    const listens = /\baddEventListener\(\s*['"`]transitionend['"`]|\bonTransitionEnd\s*=/.test(
      withoutComments(allCode),
    );
    const transitioned = new Set(
      matchAll(css, /transition(?:-property)?\s*:([^;}]*)/g).flatMap(
        (value) => value.match(/--[\w-]+/g) ?? [],
      ),
    );
    const heard = [...readByCode].some((variable) => transitioned.has(variable));
    if (readByCode.size > 0 && (!listens || !heard)) {
      fail(
        'no-variable-change-listener',
        relative(mainPath),
        2,
        `The canvas reads CSS variables, but ${
          listens ? '' : 'nothing calls addEventListener("transitionend")'
        }${!listens && !heard ? ' and ' : ''}${
          heard ? '' : 'no CSS transition names the variables it reads'
        }, so a design-panel edit does not repaint it. Add the 1ms transition on those variables and the transitionend listener with the cached reader from CANVAS-COMPONENTS.md.`,
      );
    }
    if (readByCode.size === 0) {
      warn(
        'no-design-panel-variables',
        relative(cssPath),
        2,
        'The component draws on a canvas but reads no CSS variables, so the owner cannot change the colors or fonts it draws in the design panel. If the source draws with colors or fonts, expose them per CANVAS-COMPONENTS.md.',
      );
    }
  }

  // ANIMATED-COMPONENTS.md: React writes the `animation` shorthand again whenever its value
  // changes (a new duration after a resize or a panel edit), which resets the play state
  // beside it to running, so paused motion starts moving in the editor.
  for (const [file, text] of texts) {
    const code = withoutComments(text);
    const mixed = [...code.matchAll(/\banimationPlayState\s*:/g)].some((match) =>
      /(?:^|[{,\s])animation\s*:/.test(enclosingObject(code, match.index)),
    );
    if (mixed) {
      fail(
        'play-state-beside-animation',
        relative(file),
        5,
        "An inline style sets both animation and animationPlayState. When the animation value changes (a new duration or name after a resize or a panel edit), React writes the shorthand again, which resets the play state to running, so paused motion moves in the editor. Put the play state inside the shorthand (`${name} ${duration}s linear infinite ${isPlaying ? 'running' : 'paused'}`), or use only the separate properties (animationName, animationDuration, animationDelay, animationPlayState).",
      );
    }
  }

  // Step 5: no background the source doesn't have. VISUAL-QUALITY.md gives a self-contained
  // block a background, but a port of a transparent source stays transparent.
  const SOURCE_BACKGROUND = /\bbg-|background|setClearColor|clearColor\s*\(|fillRect\s*\(/i;
  const rootBackground = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.split(',').some((part) => part.trim() === `.${rootClass}`))
    .map(([, , body]) => /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1].trim())
    .find((value) => value && !/^(?:transparent|none|inherit|initial|unset)$/i.test(value));
  if (sourceCode && rootBackground && !SOURCE_BACKGROUND.test(withoutComments(sourceStyleText))) {
    fail(
      'added-background',
      relative(cssPath),
      5,
      `The .${rootClass} rule sets background: ${rootBackground}, and the source sets no background anywhere, so the component covers what the source lets show through. Remove it; the source decides how the component looks, over the VISUAL-QUALITY.md defaults.`,
    );
  }

  // Step 3: an object prop becomes one prop per field. The panel shows its fields with no
  // defaults or ranges, and COMPONENT-CONTRACT.md keeps group fields flat.
  const localObjectTypes = new Set([
    ...matchAll(propsText, /\btype\s+([A-Z][\w$]*)\s*=\s*\{/g),
    ...matchAll(propsText, /\binterface\s+([A-Z][\w$]*)\s*\{/g),
  ]);
  const objectProps = declaredPropTypes(propsText)
    .filter(({ name, type }) => {
      if (SCAFFOLD_PROPS.has(name)) return false;
      const bare = type.replace(/^(?:Partial|Required|Readonly)<(.+)>$/, '$1').trim();
      return bare.startsWith('{') || (localObjectTypes.has(bare) && !bare.endsWith('Props'));
    })
    .map(({ name }) => name);
  if (objectProps.length) {
    fail(
      'object-prop',
      relative(propsPath),
      3,
      `${objectProps.join(', ')} ${objectProps.length > 1 ? 'are object props' : 'is an object prop'}, which the settings panel shows with no defaults or ranges. Make each field a top-level prop with the source's default (from its defaults object) and @min/@max where the source still works, keep the source's comment on each field as its JSDoc, and rebuild the object from them in the code.`,
      objectProps[0],
    );
  }

  // Step 3: content the source renders inside itself (`{children}`) stays a ReactNode slot.
  const sourceLogicCode = withoutComments(sourceCode);
  // Only the component the source exports by default: an exported helper's `children` isn't
  // a slot, and the port keeps the slot as its own `children` prop.
  const sourceComponent = mainComponent(sourceLogicCode);
  const sourceTakesChildren =
    sourceComponent !== undefined &&
    (sourcePropFields(sourceLogicCode, sourceComponent.propsType).some(
      ({ name }) => name === 'children',
    ) ||
      /\bchildren\b/.test(sourceComponent.params));
  const portChildren = declaredPropTypes(propsText).find(({ name }) => name === 'children');
  if (sourceTakesChildren && !/\bReactNode\b/.test(portChildren?.type ?? '')) {
    fail(
      'dropped-children-slot',
      relative(propsPath),
      3,
      `The source renders children inside itself, and ${scaffold.props} has no children prop typed React.ReactNode, so nothing can be placed in the component. Keep a children?: React.ReactNode slot where the source renders children, with dir="ltr" on its wrapper (COMPONENT-CONTRACT.md, Container Components).`,
    );
  }

  // Step 3: a link the source defaults (`href = '#'`) keeps that default; without it an element
  // the source shows by default (a CTA rendered only when it has a link) stays hidden.
  // A stylesheet or font link the source injects (`link.href = 'https://fonts.googleapis.com/…'`)
  // is not a destination.
  // Each source default needs a port default with the same URL, as a Link (`cta: { href }`) or
  // a flat prop (`ctaHref`).
  const sourceLinks = [
    ...sourceLogicCode.matchAll(
      /\b(\w*href\w*)\s*[:=]\s*\{?\s*['"`]((?:#|https?:\/\/|\/)[^'"`]*)['"`]/gi,
    ),
  ]
    .map(([, name, url]) => ({ name, url }))
    .filter(({ url }) => !/fonts\.(?:googleapis|gstatic)\.com|\.css(?:[?#]|$)/i.test(url))
    // A named default (`ctaHref = '#'`) counts once; each JSX `href="#"` is its own link.
    .filter(
      (link, index, all) =>
        /^href$/i.test(link.name) ||
        all.findIndex(({ name, url }) => name === link.name && url === link.url) === index,
    );
  const portLinkUrls = matchAll(
    withoutComments(propsText),
    /\b\w*href\w*\s*:\s*['"`]([^'"`]*)['"`]/gi,
  );
  const droppedLinks = sourceLinks.filter(({ url }) => {
    const index = portLinkUrls.indexOf(url);
    if (index < 0) return true;
    portLinkUrls.splice(index, 1);
    return false;
  });
  if (droppedLinks.length) {
    fail(
      'dropped-link-default',
      relative(propsPath),
      3,
      `The source gives its links a default (${droppedLinks
        .map(({ name, url }) => `${name} "${url}"`)
        .join(
          ', ',
        )}), and the defaults in ${scaffold.props} have no link with that URL, so the owner can't change it, and an element rendered only when it has a link (a button, a CTA) is hidden. Make each link a Link prop with the source's URL as its default (also "#"), never a URL written in the JSX, and keep the source's render condition.`,
    );
  }

  // Step 2: color props the source offers become CSS variables the design panel edits.
  const cssVariableWords = [...declaredInCss, ...registered].map((variable) =>
    variable.slice(2).split('-'),
  );
  const droppedColors = sourcePropFields(sourceLogicCode)
    .filter(
      ({ name, type }) =>
        // `accentColor`, `darkBackground`, `accent`; not `headlineAccent` (a text) or `accentFont`.
        /^string\b/.test(type) &&
        /(?:colou?r|background)$|^(?:bg|accent|tint|fill|stroke)$/i.test(name),
    )
    .map(({ name }) => name)
    .filter((name) => {
      // A port may rename the variable (`background` → `--sh-bg`): it counts when the name's
      // words match (background as bg) or when a variable holds the source's default value.
      const words = humanize(name)
        .split(' ')
        .map((word) => (word === 'background' ? 'bg' : word));
      const named = cssVariableWords.some((variable) =>
        words.every(
          (word) => variable.includes(word) || (word === 'bg' && variable.includes('background')),
        ),
      );
      // Source text is compared, never built into a regex.
      const flat = (value) => value.replace(/\s+/g, '').toLowerCase();
      const fallback = [
        ...sourceLogicCode.matchAll(
          /\b([\w$]+)\s*[:=]\s*['"`](#[0-9a-f]{3,8}|rgba?\([^)]{0,80}\))['"`]/gi,
        ),
      ].find(([, field]) => field === name)?.[2];
      const valued =
        fallback !== undefined &&
        matchAll(css, /--[\w-]+\s*:\s*([^;}]*)/g).some((value) => flat(value) === flat(fallback));
      return !named && !valued;
    });
  if (droppedColors.length) {
    fail(
      'dropped-source-color',
      relative(cssPath),
      2,
      `The source takes ${droppedColors.join(', ')} as color props, and ${scaffold.css} declares no CSS variable for ${droppedColors.length > 1 ? 'them' : 'it'}, so the owner can't change ${droppedColors.length > 1 ? 'them' : 'it'} in the design panel. Declare each on the root with the source's default (--${humanize(droppedColors[0]).replace(/ /g, '-')}) and read it where the source uses the prop.`,
      droppedColors.slice(0, 3).map(humanize).join(', '),
    );
  }

  // Step 2: fonts are design-panel variables with a font-family anchor, not text the owner types.
  const fontProps = declaredPropTypes(propsText)
    .filter(
      ({ name, type }) => type === 'string' && /font/i.test(name) && !/size|weight/i.test(name),
    )
    .map(({ name }) => name);
  if (fontProps.length) {
    fail(
      'font-as-text-prop',
      relative(propsPath),
      2,
      `${fontProps.join(', ')} ${fontProps.length > 1 ? 'are fonts' : 'is a font'} typed as a string prop, a text field in the settings panel. Make each a CSS custom property declared on the root with the source's font stack (--${humanize(fontProps[0]).replace(/ /g, '-')}) and a font-family: var(…) anchor, so the owner picks it in the design panel (CANVAS-COMPONENTS.md, Design-Panel Values).`,
    );
  }

  // Step 2: a color the CSS reads from a variable only the code sets inline (`style={{ '--sh-bg':
  // bg }}`) has no value in the stylesheet, so the design panel shows that property empty.
  const COLOR_PROPERTY =
    /(?:^|[;{\s])(background(?:-color)?|color|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|box-shadow|text-shadow)\s*:([^;}]*)/g;
  const inlineOnlyColors = [
    ...new Set(
      [...css.matchAll(COLOR_PROPERTY)].flatMap(([, , value]) =>
        matchAll(value, /var\(\s*(--[\w-]+)/g).filter(
          (variable) =>
            !PLATFORM_VARIABLE.test(variable) &&
            !declaredInCss.has(variable) &&
            !registered.has(variable) &&
            setByCode.has(variable),
        ),
      ),
    ),
  ];
  if (inlineOnlyColors.length) {
    fail(
      'color-without-panel-default',
      relative(cssPath),
      2,
      `The CSS colors parts with ${inlineOnlyColors.join(', ')}, which only the code sets in an inline style, so the design panel shows those colors with no value. Declare each on the root in ${scaffold.css} with the source's default, drop it from the inline style, and have the code read it from CSS where it needs the value (on a canvas, through the cached reader in CANVAS-COMPONENTS.md).`,
    );
  }

  // COMPONENT-CONTRACT.md: a link lives in one place. A `Link` prop plus an `href` in the part's
  // elementProps entry gives the owner two link fields for one button.
  const linkProps = declaredPropTypes(propsText)
    .filter(({ type }) => /^Link\b/.test(type))
    .map(({ name }) => name);
  const elementPropsBlock =
    /elementProps\??\s*:\s*\{([\s\S]*)\}/.exec(declaredPropsBlock(propsText))?.[1] ?? '';
  const partsWithHref = matchAll(
    elementPropsBlock,
    /([A-Za-z_$][\w$]*)\??\s*:\s*\{[^{}]*\bhref\??\s*:/g,
  );
  if (linkProps.length && partsWithHref.length) {
    fail(
      'duplicate-link-field',
      relative(propsPath),
      3,
      `${partsWithHref.join(', ')} ${partsWithHref.length > 1 ? 'have' : 'has'} an href in elementProps, and the component also has Link props (${linkProps.join(', ')}), so the settings panel shows a second, plain URL field for the same link. Remove href from those elementProps entries and read the link only from its Link prop.`,
    );
  }

  // Step 3: only text the owner sees on the page is a prop. Screen-reader-only text (a hidden
  // instructions span) and a form field's `name` stay in the code.
  const stringProps = declaredPropTypes(propsText)
    .filter(({ name, type }) => type === 'string' && !SCAFFOLD_PROPS.has(name))
    .map(({ name }) => name);
  const SR_ONLY =
    /className=\{[^}]*(?:srOnly|sr-only|visuallyHidden|visually-hidden)[^}]*\}[^>]*>\s*\{([^}]*)\}/g;
  const hiddenReads = [...portCode.matchAll(SR_ONLY)].map(([, expression]) => expression);
  const screenReaderProps = stringProps.filter(
    (name) =>
      /instructions?$|screenReader|srText|ariaDescription/i.test(name) ||
      hiddenReads.some((expression) => new RegExp(`\\b${name}\\b`).test(expression)),
  );
  if (screenReaderProps.length) {
    fail(
      'screen-reader-text-prop',
      relative(propsPath),
      3,
      `${screenReaderProps.join(', ')} ${screenReaderProps.length > 1 ? 'are' : 'is'} screen-reader-only text exposed as a setting, though nothing on the page shows it. Keep the source's text in the code as written (one constant per variant) and remove the prop.`,
    );
  }
  if (stringProps.includes('name') && /<input\b[^>]*\bname=\{\s*name\s*\}/.test(portCode)) {
    fail(
      'form-name-prop',
      relative(propsPath),
      3,
      'name is a form field name (it fills a hidden <input name>), which the settings panel shows as a "Name" text field. Keep it out of the props; drop the hidden input or give it a fixed name in the code.',
    );
  }

  // CSS-GUIDELINES.md, Editable Values: a part's font and paint are literal. The Design panel
  // shows `var(--sh-fg)` or a `color-mix()` of it as raw text. A variable a part rule declares
  // itself (`--icon-color` on the button) and theme tokens (`var(wst-…)`) are fine.
  const PAINT_PROPERTY =
    /^(?:font(?:-family)?|color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline-color|fill|stroke|text-decoration-color)$/;
  const ROOT_ONLY = new RegExp(`^\\.${rootClass}(?:\\[[^\\]]*\\]|:{1,2}[\\w-]+(?:\\([^)]*\\))?)*$`);
  const cssRules = [...withoutComments(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => ({ selector: selector.trim(), body }),
  );
  const partVariables = new Set(
    cssRules
      .filter(({ selector }) => !selector.split(',').every((part) => ROOT_ONLY.test(part.trim())))
      .flatMap(({ body }) => matchAll(body, /(--[\w-]+)\s*:/g)),
  );
  const notLiteral = [];
  for (const { selector, body } of cssRules) {
    if (selector.split(',').every((part) => ROOT_ONLY.test(part.trim()))) continue;
    for (const [, property, value] of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:([^;]*)/g)) {
      if (!PAINT_PROPERTY.test(property)) continue;
      const shared = matchAll(value, /var\(\s*(--[\w-]+)/g).filter(
        (name) => !partVariables.has(name),
      );
      if (shared.length) notLiteral.push(`${selector} { ${property}: ${value.trim()} }`);
    }
  }
  if (notLiteral.length) {
    fail(
      'part-style-not-literal',
      relative(cssPath),
      3,
      `These part styles use a variable from the root, so the Design panel shows code instead of a font or color: ${notLiteral
        .slice(0, 4)
        .join(
          '; ',
        )}${notLiteral.length > 4 ? '; …' : ''}. Write the source's resolved value instead (font: 600 120px/.8 'Geist', sans-serif; color: rgb(21 21 20 / 5%)), with one literal rule per theme or mode; keep the variable only where the code reads it.`,
    );
  }

  // CSS-GUIDELINES.md, Editable Values: a text part sets its own color. One that inherits it from
  // the root renders right, but its text panel shows the color empty.
  const colorBySelector = new Set(
    cssRules
      .filter(({ body }) => /(?:^|;)\s*color\s*:/.test(body))
      .flatMap(({ selector }) => selector.split(',').map((part) => part.trim())),
  );
  const uncolored = [
    ...new Set(
      cssRules
        .filter(({ selector }) => !selector.split(',').every((part) => ROOT_ONLY.test(part.trim())))
        .filter(({ body }) => /(?:^|;)\s*font(?:-family|-size)?\s*:/.test(body))
        .flatMap(({ selector }) => selector.split(',').map((part) => part.trim()))
        .filter((part) => !part.includes('::') && !colorBySelector.has(part)),
    ),
  ];
  if (uncolored.length) {
    fail(
      'text-part-without-color',
      relative(cssPath),
      3,
      `${uncolored.slice(0, 6).join(', ')}${uncolored.length > 6 ? ', …' : ''} set a font but no color, so the text panel shows the color empty. Give each its own literal color (the one it shows now, e.g. color: #fff), with one rule per theme or mode (CSS-GUIDELINES.md, Editable Values).`,
    );
  }

  // CANVAS-COMPONENTS.md: a value is a setting or a variable, never both. A number prop beside a
  // root variable for the same value (`strength` and `--sh-strength`) leaves one field doing nothing.
  const rootVariableWords = cssRules
    .filter(({ selector }) => selector.split(',').every((part) => ROOT_ONLY.test(part.trim())))
    .flatMap(({ body }) => matchAll(body, /(--[\w-]+)\s*:/g))
    .filter((variable) => !SCAFFOLD_VARIABLES.has(variable))
    .map((variable) => ({ variable, words: variable.slice(2).split('-') }));
  const doubled = declaredPropTypes(propsText)
    .filter(({ type }) => type === 'number')
    .flatMap(({ name }) => {
      const words = humanize(name).split(' ');
      const last = words[words.length - 1];
      // The variable that holds the most of the prop's words (`mobileSculptureScale` →
      // `--sh-mobile-scale`, not `--sh-scale`), as long as their last words agree.
      const twin = rootVariableWords
        .filter(({ words: parts }) => last.length > 3 && parts[parts.length - 1] === last)
        .sort(
          (a, b) =>
            words.filter((word) => b.words.includes(word)).length -
            words.filter((word) => a.words.includes(word)).length,
        )[0];
      return twin ? [`${name} / ${twin.variable}`] : [];
    });
  if (doubled.length) {
    fail(
      'value-in-both-panels',
      relative(propsPath),
      3,
      `These values are both a setting and a design-panel variable: ${doubled.join(', ')}. Keep one: how the drawing behaves or responds (strength, reach, speed) is the setting, read through the props ref; how it looks (color, font, size, opacity) is the variable, read through the cached reader. Remove the other (CANVAS-COMPONENTS.md, Design-Panel Values).`,
      doubled[0].split(' / ')[0],
    );
  }

  // CANVAS-COMPONENTS.md: a registered `<color>` reads back as `rgb(…)`, so a hex-only parser
  // (`hexToRgb(style.getPropertyValue('--sh-bg'))`) returns its fallback and the drawing ignores
  // every design-panel edit. Directly nested or through one local name.
  const colorVariables = new Set(
    matchAll(css, /@property\s+(--[\w-]+)\s*\{[^}]*syntax\s*:\s*['"]<color>['"]/g),
  );
  const READ = String.raw`getPropertyValue\(\s*['"\`](--[\w-]+)['"\`]\s*\)`;
  const hexRead = new Set([
    ...matchAll(portCode, new RegExp(String.raw`\bhex\w*\(\s*[\w$.?]*${READ}`, 'gi')),
    ...[...portCode.matchAll(new RegExp(String.raw`\b([\w$]+)\s*=\s*[\w$.?]*${READ}`, 'g'))]
      .filter(([, local]) => new RegExp(String.raw`\bhex\w*\(\s*${local}\b`, 'i').test(portCode))
      .map(([, , variable]) => variable),
  ]);
  const misread = [...hexRead].filter((variable) => colorVariables.has(variable));
  if (misread.length) {
    fail(
      'hex-parser-on-css-color',
      relative(mainPath),
      2,
      `The code reads ${misread.join(', ')} with a hex-only parser, but a registered <color> reads back as rgb(…), so the parser returns its fallback and the drawing ignores design-panel edits. Parse rgb()/rgba() too, or pass the value as is (CANVAS-COMPONENTS.md, Use them).`,
    );
  }

  // Step 2: the source's web fonts load from @fontsource under the same family, never a stand-in.
  // Config JSON (a package.json dependency) and comments don't load a font.
  const fontSourceText = withoutComments(
    [
      sourceCode,
      ...sourceFiles
        .filter(
          (file) => !CODE_EXTENSIONS.has(extOf(file)) && !CONFIG_JSON.test(path.basename(file)),
        )
        .map((file) => read(file).replace(/<!--[\s\S]*?-->/g, '')),
    ].join('\n'),
  );
  const sourceFamilies = new Set([
    ...[...fontSourceText.matchAll(/fonts\.googleapis\.com\/css2?\?([^'"`)\s]+)/g)].flatMap(
      ([, query]) =>
        [...query.matchAll(/family=([^:&]+)/g)].map(([, family]) =>
          decodeURIComponent(family.replace(/\+/g, ' ')).trim(),
        ),
    ),
    ...matchAll(fontSourceText, /@fontsource(?:-variable)?\/([a-z0-9-]+)/g),
  ]);
  const fontPackage = (family) => family.toLowerCase().replace(/[\s_]+/g, '-');
  const portFonts = new Set(
    matchAll(`${allCode}\n${css}`, /@fontsource(?:-variable)?\/([a-z0-9-]+)/g),
  );
  const replacedFonts = [...sourceFamilies].filter((family) => !portFonts.has(fontPackage(family)));
  if (replacedFonts.length) {
    fail(
      'replaced-source-font',
      relative(mainPath),
      2,
      `The source loads ${replacedFonts.join(', ')}, and the port imports no matching font (${replacedFonts
        .map((family) => `@fontsource/${fontPackage(family)}`)
        .join(
          ', ',
        )}), so the text renders in another font. Install and import each at the weights the source uses, and keep the source's font-family stacks.`,
      replacedFonts.join(' and '),
    );
  }

  // Step 5: the libraries the source imports stay; without one, what it did (springs, gestures,
  // a renderer) gets rewritten by hand and the parts built on it are dropped.
  const packageOf = (specifier) => {
    if (/^(?:[./~#]|@\/|[a-z]+:)/.test(specifier)) return undefined;
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  };
  const importedPackages = (code) => {
    const packages = new Map();
    const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)['"]([^'"]+)['"]/g;
    for (const specifier of matchAll(
      withoutComments(code).replace(/\bimport\s+type\b[^;\n]*/g, ''),
      pattern,
    )) {
      const name = packageOf(specifier);
      if (name) packages.set(name, new Set([...(packages.get(name) ?? []), specifier]));
    }
    return packages;
  };
  // An npm alias (`three-128@npm:three@0.128.0`) imports the package under another name.
  let appDir = path.resolve(componentDir);
  while (!fs.existsSync(path.join(appDir, 'package.json')) && path.dirname(appDir) !== appDir) {
    appDir = path.dirname(appDir);
  }
  const appPackage = path.join(appDir, 'package.json');
  const aliases = new Map(
    Object.entries(
      fs.existsSync(appPackage) ? (JSON.parse(read(appPackage)).dependencies ?? {}) : {},
    ).flatMap(([alias, version]) => {
      const real = /^npm:(@?[^@]+)/.exec(String(version))?.[1];
      return real ? [[alias, real]] : [];
    }),
  );
  // `motion` is `framer-motion` renamed; either keeps the source's animations.
  const samePackage = { 'framer-motion': 'motion' };
  const canonical = (name) => samePackage[aliases.get(name) ?? name] ?? aliases.get(name) ?? name;
  const portPackages = new Set([...importedPackages(allCode).keys()].map(canonical));
  const droppedLibraries = [...importedPackages(sourceCode)].filter(
    ([name]) =>
      !/^(?:react|react-dom|next|clsx|classnames|tailwind-merge|class-variance-authority)$|^@(?:fontsource|types)\//.test(
        name,
      ) && !portPackages.has(canonical(name)),
  );
  if (droppedLibraries.length) {
    fail(
      'dropped-source-library',
      relative(mainPath),
      5,
      `The source imports ${droppedLibraries
        .map(([name, specifiers]) => `${name} (${[...specifiers].join(', ')})`)
        .join(
          ', ',
        )}, and the port doesn't, so what it did (springs, gestures, a renderer) is rewritten by hand or lost, with the parts built on it. Install it at the source's version (under an npm alias if the app has another) and keep the source's imports, calls and sub-components; never rewrite what a library does.`,
    );
  }

  // Step 3: a pointer listener the source puts on window or document follows the pointer over
  // the whole component; one on a child (the canvas) misses everything that covers it.
  const MOVE = String.raw`['"\`](?:pointer|mouse)move['"\`]`;
  const globalMove = new RegExp(
    String.raw`\b(?:window|document)\s*\.\s*addEventListener\(\s*${MOVE}`,
  );
  if (rootCall && globalMove.test(sourceLogicCode) && !globalMove.test(portCode)) {
    const rootTag = openingTag(mainText, rootCall.index);
    const rootRef = /\bref=\{\s*([\w$]+)\s*\}/.exec(rootTag)?.[1];
    // The root also counts when its ref is passed to a helper (`mountWeave(stage, rootRef.current)`):
    // the helper's parameter at that position is the root.
    const passedAs = [];
    for (const call of rootRef ? portCode.matchAll(/\b([A-Za-z_$][\w$]*)\(([^()]*)\)/g) : []) {
      const position = call[2]
        .split(',')
        .findIndex((arg) => new RegExp(`^\\s*${rootRef}\\.current\\b`).test(arg));
      if (position < 0) continue;
      const params = new RegExp(
        `\\bfunction\\s+${call[1]}\\s*\\(([^)]*)\\)|\\b${call[1]}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*(?::[^=]*)?=>`,
      ).exec(portCode);
      const param = (params?.[1] ?? params?.[2])?.split(',')[position];
      const name = /^\s*([A-Za-z_$][\w$]*)/.exec(param ?? '')?.[1];
      if (name) passedAs.push(name);
    }
    const aliases = rootRef
      ? [
          `${rootRef}\\.current\\??`,
          ...matchAll(portCode, new RegExp(`\\b([\\w$]+)\\s*=\\s*${rootRef}\\.current\\b`, 'g')),
          ...passedAs,
        ]
      : [];
    const rootListens =
      /\bon(?:Pointer|Mouse)Move\s*=/.test(rootTag) ||
      aliases.some((alias) =>
        new RegExp(String.raw`\b${alias}\.addEventListener\(\s*${MOVE}`).test(portCode),
      );
    if (!rootListens) {
      fail(
        'pointer-listener-on-child',
        relative(mainPath),
        3,
        "The source follows the pointer with a window or document listener, and the port follows it on a child element, so it stops reacting over the text and buttons that cover that child. Listen on the component root (onPointerMove on the root element, or addEventListener on the root's ref), and on pointerleave reset the pointer state the way the source does when the pointer leaves the page.",
      );
    }
  }

  // CANVAS-COMPONENTS.md: an engine with an update method is created once and updated through
  // it. Rebuilt for playback or a setting, it restarts; and after its cleanup releases the
  // WebGL context (`loseContext`), the next engine on the same canvas gets a dead context.
  const UPDATE_METHOD =
    /\b(setOptions|updateOptions|setSettings|setProps|configure)\s*\([^)]*\)\s*(?::[^{;]*)?\{/;
  const updatable = new Map();
  for (const match of sourceLogicCode.matchAll(/\bclass\s+([A-Z][\w$]*)[^{]*\{/g)) {
    const method = UPDATE_METHOD.exec(
      balanced(sourceLogicCode, match.index + match[0].length - 1),
    )?.[1];
    if (method) updatable.set(match[1], method);
  }
  const losesContext = /\bloseContext\s*\(/.test(sourceLogicCode);
  // Dependencies the source's own effect already has (a stable `relayout` callback) are kept.
  const sourceEngineDeps = new Set(
    [...sourceLogicCode.matchAll(/\buse(?:Layout)?Effect\(/g)].flatMap((match) => {
      const call = balanced(sourceLogicCode, match.index + match[0].length - 1);
      if (![...updatable.keys()].some((name) => new RegExp(`\\bnew\\s+${name}\\s*\\(`).test(call)))
        return [];
      return (/,\s*\[([^\]]*)\]\s*\)$/.exec(call)?.[1] ?? '').split(',').map((dep) => dep.trim());
    }),
  );
  for (const [file, text] of texts) {
    const code = withoutComments(text);
    for (const match of code.matchAll(/\buse(?:Layout)?Effect\(/g)) {
      const call = balanced(code, match.index + match[0].length - 1);
      const engine = [...updatable.keys()].find((name) =>
        new RegExp(`\\bnew\\s+${name}\\s*\\(`).test(call),
      );
      const deps = /,\s*\[([^\]]*)\]\s*\)$/
        .exec(call)?.[1]
        .split(',')
        .map((dep) => dep.trim())
        .filter((dep) => dep && !dep.endsWith('Ref') && !sourceEngineDeps.has(dep));
      if (!engine || !deps?.length) continue;
      fail(
        'engine-recreated',
        relative(file),
        3,
        `The effect that creates ${engine} re-runs when ${deps.join(', ')} change${deps.length > 1 ? '' : 's'}, so pausing or a panel edit destroys the engine and builds a new one${losesContext ? ', and its cleanup releases the WebGL context (loseContext), so the next engine on the same <canvas> gets a dead context and shows nothing' : ''}. The source's ${engine} has ${updatable.get(engine)}(): create it once in an effect with [] dependencies, and pass playback and settings through ${updatable.get(engine)}() in a separate effect, as the source does${losesContext ? '; if it must be rebuilt, give each engine a new <canvas>' : ''}.`,
      );
    }
  }

  if (sourceFiles.length === 0) {
    warn(
      'no-source-files',
      DEFAULT_SOURCE_DIR,
      1,
      'No user files found, so copied code could not be compared. Save pasted code, as pasted, in .wix/agentInput/attachments/pasted/ and rerun.',
    );
  }

  return {
    summary: { failures: failures.length, warnings: warnings.length },
    // For the final message: one plain sentence per kind of failure left unfixed.
    tellTheOwner: [...new Set(failures.map((failure) => failure.owner).filter(Boolean))],
    failures,
    warnings,
    exitCode: failures.length ? 1 : 0,
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  try {
    const { exitCode, ...report } = scan(options);
    console.log(JSON.stringify(report, null, 2));
    process.exit(exitCode);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = { scan, parseArgs, declaredProps, copiedShare, significantLines };

if (require.main === module) main();
