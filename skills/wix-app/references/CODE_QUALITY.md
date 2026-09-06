# Code Quality Requirements

Applies to all generated code across every Wix CLI app extension type. Each per-extension reference links here instead of restating these rules.

## TypeScript Quality Guidelines

- Generated code MUST compile with zero TypeScript errors **under the project's own `tsconfig.json`** — run `npx tsc --noEmit -p .`. That file, and the base it `extends`, are the bar. Read them before writing code; do not assume a flag is on.
- **Expect `strictNullChecks` to be off.** The Wix CLI app template sets `strictNullChecks: false` and `exactOptionalPropertyTypes: false` explicitly, on top of a base that sets only `strict: true`. So of the flags this file used to demand, `strict` and `noImplicitAny` are on, two are deliberately disabled, and `noUncheckedIndexedAccess` is never set. Writing code that only type-checks under flags the project disables — or citing those flags to justify a line — makes the reasoning wrong even when the code is right.
- Because the compiler is *not* checking null and undefined for you, handling them is a discipline rather than something you will be told about. That makes the next three rules more important here, not less.
- Prefer type-narrowing and exhaustive logic over assertions; avoid non-null assertions (`!`) and unsafe casts (`as any`).
- Treat optional values, refs, and array indexing results as possibly undefined and handle them explicitly.
- Use exhaustive checks for unions (e.g., `switch` with a `never` check) and return total values (no implicit `undefined`).
- Do NOT use `// @ts-ignore` or `// @ts-expect-error`; fix the types or add guards instead.

## Core Principles

- Do NOT invent or assume new types, modules, functions, props, events, or imports. Use only entities present in the provided references or standard libraries already used in this project.
- NEVER use mocks, placeholders, or TODOs in shipped code. ALWAYS implement complete, production-ready functionality.
- If a required API, type, or module is missing, surface it to the user explicitly rather than inserting placeholder code.
- Do NOT create README.md, CHANGELOG.md, or other unprompted markdown documentation — only output the files the task actually requires.

## Code Quality Standards

- Add documentation only for complex or non-obvious logic — well-named identifiers should carry the rest.
- Prefer `async`/`await` for asynchronous operations.

## Modular Code

- If a generated file would exceed ~300 lines, split it into multiple smaller files with imports. Each component or function should stay ~50–100 lines.
- Extract utilities/helpers into separate files; put types/interfaces into dedicated type files.

## Error Handling

- Log errors with `console.error` for debugging.
- Handle network timeouts and external service failures.
