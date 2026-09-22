#!/usr/bin/env node
// Prints the install directory of a package — the folder holding its
// package.json — resolved from the current working directory.
//
//   node pkg-root.cjs @wix/patterns
//
// Takes the package name as an argument and knows nothing about any particular
// package, so it stays correct as the packages it is pointed at change.
//
// Three steps, because one is not enough in the repos this runs in:
//   1. Activate Yarn PnP if a .pnp.cjs exists at or above cwd. A bare
//      require.resolve throws in a Yarn Berry project even when the package is
//      installed, and in a monorepo the .pnp.cjs sits at the repo root rather
//      than beside the project being built.
//   2. require.resolve, which handles npm, pnpm and workspace layouts.
//   3. Failing that, walk up looking for node_modules/<pkg> directly, which
//      covers a partially-installed tree where resolution fails but the files
//      are on disk.
const fs = require('fs');
const path = require('path');

const pkg = process.argv[2];
if (!pkg) {
  console.error('usage: pkg-root.cjs <package-name>');
  process.exit(2);
}

function activatePnp() {
  let dir = process.cwd();
  for (;;) {
    const pnp = path.join(dir, '.pnp.cjs');
    if (fs.existsSync(pnp)) {
      try {
        require(pnp).setup();
      } catch {
        // An unusable .pnp.cjs is not fatal: the plain resolve below may still
        // succeed against a node_modules tree.
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

activatePnp();

try {
  console.log(
    path.dirname(
      require.resolve(`${pkg}/package.json`, { paths: [process.cwd()] }),
    ),
  );
  process.exit(0);
} catch {
  // fall through to the directory walk
}

let dir = process.cwd();
for (;;) {
  const candidate = path.join(dir, 'node_modules', ...pkg.split('/'));
  if (fs.existsSync(path.join(candidate, 'package.json'))) {
    console.log(candidate);
    process.exit(0);
  }
  const parent = path.dirname(dir);
  if (parent === dir) {
    console.error(`${pkg} not found from ${process.cwd()}`);
    process.exit(1);
  }
  dir = parent;
}
