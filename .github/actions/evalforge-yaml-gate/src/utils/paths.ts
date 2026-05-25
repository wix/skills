export const SKILLS_ROOT = 'skills/wix-manage/references';

// `^skills/wix-manage/references/<area>/<basename>.md`
export const MD_RE = /^skills\/wix-manage\/references\/[^/]+\/[^/]+\.md$/;

// `^skills/wix-manage/references/<area>/evals/<rest>.(yml|yaml)`
export const EVALS_RE = /^skills\/wix-manage\/references\/[^/]+\/evals\/.+\.(ya?ml)$/;

// Captures `<area>` from any path under SKILLS_ROOT.
export const AREA_RE = /^skills\/wix-manage\/references\/([^/]+)\//;

// Glob pattern (relative to workspace) for loading scenario YAML files.
export const EVALS_GLOB = 'skills/wix-manage/references/*/evals/**/*.{yml,yaml}';

// Glob pattern (relative to workspace) for per-area documentation.yaml files.
export const DOC_YAML_GLOB = 'yaml/wix-manage/*/documentation.yaml';

// Subdirectory used by the trusted-action-source two-checkout workflow pattern.
export const BASE_WORKSPACE_SUBDIR = '.action-src';
