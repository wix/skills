
# Wix App Validation

Validates Wix CLI applications through a four-step sequential workflow: package installation, TypeScript compilation check, build, and preview.

## Validation Workflow

Execute these steps sequentially. Stop and report errors if any step fails.

### Step 1: Package Installation

Ensure all dependencies are installed before proceeding with the build.

**Detect package manager:**
- Check for `package-lock.json` → use `npm`
- Check for `yarn.lock` → use `yarn`
- Check for `pnpm-lock.yaml` → use `pnpm`
- Default to `npm` if no lock file is found

**Run installation command:**

```bash
# For npm
npm install

# For yarn
yarn install

# For pnpm
pnpm install
```

**Success criteria:**
- Exit code 0
- All dependencies installed successfully
- No missing peer dependencies warnings (unless expected)
- `node_modules` directory exists and contains expected packages

**On failure:** Report the installation errors, [check the debug log](#debug-log-on-errors) for detailed diagnostics, and stop validation. Common issues:
- Network connectivity problems
- Corrupted lock files
- Version conflicts
- Missing Node.js or package manager

### Step 2: TypeScript Compilation Check

Run TypeScript compiler to check for type errors.

```bash
npx tsc --noEmit -p .
```

**This is the only form to use, and there is no targeted variant.** Passing filenames or globs makes
TypeScript ignore `tsconfig.json` altogether — no `strict`, no `noImplicitAny`, no `jsx`, no `paths`,
no `lib`, no `skipLibCheck` — so the run checks the code against *no* configuration: it misses the
errors that matter and floods the output with errors that do not. Measured on a real app, on a file
with one untyped parameter:

- `npx tsc --noEmit -p .` → `TS7006: Parameter 'x' implicitly has an 'any' type`
- `npx tsc --noEmit <that file>` → no `TS7006` at all, and instead dozens of
  `Cannot find name 'Set'` from `node_modules/@types`

And the config cannot be handed back on the side: `tsc -p tsconfig.json <file>` fails outright with
`TS5042: Option 'project' cannot be mixed with source files on a command line`. Checking a subset of
files under the project's own settings is not something the compiler offers, so check the project.

**Success criteria:**
- Exit code 0
- No TypeScript compilation errors
- All type checks pass

**On failure:** Report the specific TypeScript errors and stop validation. Common issues:
- Type mismatches between expected and actual types
- Missing type declarations for imported modules
- Incorrect generic type parameters
- Properties not existing on declared types
- Incompatible function signatures

### Step 3: Build Validation

Run the build command and check for compilation errors:

```bash
npx wix build
```

**Success criteria:**
- Exit code 0
- No TypeScript errors
- No missing dependencies

**On failure:** Report the specific compilation errors, [check the debug log](#debug-log-on-errors) for detailed diagnostics, and stop validation.

### Step 4: Preview Deployment

Start the preview server:

```bash
npx wix preview
```

**Success criteria:**
- Preview server starts successfully
- Preview URLs are generated (both site and dashboard)

**URL extraction:** Parse the terminal output to find both preview URLs. Look for patterns like:
- Site preview: `Site preview: https://...` or `Site URL: https://...`
- Dashboard preview: `Dashboard preview: https://...` or `Preview URL: https://...` or `Your app is available at: https://...`

Extract both URLs and provide them to the user for manual verification.

**On failure:** Report the preview startup errors, [check the debug log](#debug-log-on-errors) for detailed diagnostics, and stop validation.

## Validation Report

After completing all steps, provide a summary:

**Pass:**
- Dependencies: ✓ All packages installed successfully
- TypeScript: ✓ No compilation errors
- Build: ✓ Compiled successfully
- Preview: ✓ Running at [URL]

**Fail:**
- Identify which step failed
- Provide specific error messages
- Suggest remediation steps

## Debug Log on Errors

When a validation step fails (non-zero exit code, error output, or the CLI crashes/hangs), check `.wix/debug.log` in the project root for the full error trace. **Only read this file when errors occur** — skip it when steps pass or when the terminal output already makes the error clear (e.g. a straightforward TypeScript type error).

The `.wix/` directory is automatically created by the Wix CLI and contains internal configuration and log files. Don't edit it, but reading `debug.log` for troubleshooting is expected.

```
Read: .wix/debug.log

# If the file is large, read the last 100 lines for the most recent errors
Read: .wix/debug.log (with offset to the end)
```

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Package installation fails | Missing lock file, network issues, or corrupted node_modules | Delete `node_modules` and lock file, then reinstall |
| TypeScript compilation fails | Type mismatches, missing declarations, or incorrect types | Fix TypeScript errors shown in `npx tsc --noEmit -p .` output |
| Build fails | TypeScript errors, missing dependencies, or internal CLI error | Fix TypeScript errors in source; for non-obvious failures, check `.wix/debug.log` |
| Preview fails to start | Port conflict, config issue, or internal CLI error | Check `wix.config.json`; if unclear, check `.wix/debug.log` for details |
| Console errors in preview | Runtime exceptions | Check browser console output |
| UI not rendering | Component errors | Review component code and imports |
| CLI error with no clear message | Truncated terminal output | Read `.wix/debug.log` for the full error trace and stack details |
| Mysterious failures after config change | Stale CLI state | Read `.wix/debug.log` to confirm, then delete `.wix/` and rebuild |
