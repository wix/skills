export const SKILLS_ROOT = 'skills/wix-manage/references';

// `^skills/wix-manage/references/<area>/<nested/path>.md`
export const MD_RE = /^skills\/wix-manage\/references\/[^/]+\/.+\.md$/;

// `^yaml/wix-manage-evals/<area>/<rest>.(yml|yaml)`
export const EVALS_RE = /^yaml\/wix-manage-evals\/[^/]+\/.+\.(ya?ml)$/;

// Captures `<area>` from a doc path under SKILLS_ROOT.
export const AREA_RE = /^skills\/wix-manage\/references\/([^/]+)\//;

// Captures `<area>` from an eval scenario path.
export const EVALS_AREA_RE = /^yaml\/wix-manage-evals\/([^/]+)\//;

// Glob pattern (relative to workspace) for loading scenario YAML files.
export const EVALS_GLOB = 'yaml/wix-manage-evals/*/**/*.{yml,yaml}';

// Glob pattern (relative to workspace) for per-area documentation.yaml files.
export const DOC_YAML_GLOB = 'yaml/wix-manage/*/documentation.yaml';

// Subdirectory used by the trusted-action-source two-checkout workflow pattern.
export const BASE_WORKSPACE_SUBDIR = '.action-src';
