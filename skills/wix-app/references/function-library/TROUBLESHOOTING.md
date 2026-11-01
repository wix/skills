# Troubleshooting

## Function not found at runtime

**Cause:** The exported function name in the library's `{library-name}.ts` does not match the key in the `functions` map.

**Solution:** Ensure every key in the `functions` map has an identically-named named export in the library's `{library-name}.ts`. The match is case-sensitive.

## Text renders blank after binding a function

**Possible cause:** The function declares `returns: { dataType: 'richText' }` but returns an HTML string. The function can execute successfully while the target element receives a value without the required `html` field.

**Solution:** Match the implementation to the declaration. For `richText`, return a typed `RichText` object containing `text`, `html`, and `linkList`; see [RichText values](DATA_TYPES.md#richtext-values). For plain text, return a string and declare `text` instead.

## Error: Parameter has both `dataType` and `domEvent`

**Cause:** A function parameter was defined with both `dataType` and `domEvent`.

**Solution:** Each parameter must have exactly one of `dataType` or `domEvent`, never both. Use `dataType` for data values and `domEvent` for browser events.

## Error: Disallowed data type

**Cause:** A parameter or return type uses a deprecated or disallowed `dataType` such as `onClick` or `onChange`.

**Solution:** Replace deprecated event-handler data types with the corresponding `domEvent` value:
- `onClick` → `domEvent: 'POINTER'`
- `onChange` → `domEvent: 'CHANGE'`
- `onKeyPress`/`onKeyUp`/`onKeyDown` → `domEvent: 'KEYBOARD'`
- `onFocus` → `domEvent: 'FOCUS'`
- `onSubmit` → `domEvent: 'SUBMIT'`

## Error: `Error during component specifier upsert`

The checkpoint fails when a `moduleSpecifier` is already registered by another app (module specifiers are unique across all of Wix) or when an existing one was changed (a registered module specifier cannot be renamed). For a function library added since the last checkpoint, set `resources.moduleSpecifier` to `<moduleSpecifierPrefix><its current value>` (`@/` by default, or the prefix the user gives you). For a library that already existed, restore the `moduleSpecifier` it had before (`git log -p -- <its .extension.ts>`). Change only that string; `type`, `id` and the files stay as they are.

## Error: `componentType already exists` (code 2018)

**`Component type '<type>' is already registered by another component` (code 2018, `componentType already exists`).** The platform's background preview reports it. The `type` is built from `name` (`<codeIdentifier>.<camelCaseName>`) and is globally unique, so a second extension with the same name is rejected. Give the new extension a different `name` and `type`, and a different `moduleSpecifier` (never rename one that was already released).
