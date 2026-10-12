// Whether a seed module is the script node was started with (`node seed-<vertical>.mjs plan.json`)
// rather than imported. Compares real paths, so Windows backslashes, relative invocations and
// symlinked folders all match (node reports the module's real path in import.meta.url).
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
