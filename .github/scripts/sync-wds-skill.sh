#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPO="wix-private/coding-agents-plugins"
UPSTREAM_PATH="skills/wds-docs"
LOCAL_PATH="skills/wix-design-system"
LOCAL_SKILL_NAME="wix-design-system"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

fetch_file() {
  local remote_path="$1"
  local content
  content=$(gh api "repos/${UPSTREAM_REPO}/contents/${UPSTREAM_PATH}/${remote_path}" --jq '.content')
  if [ -z "$content" ] || [ "$content" = "null" ]; then
    echo "ERROR: Failed to fetch ${remote_path} (file may exceed 1MB GitHub API limit)" >&2
    exit 1
  fi
  echo "$content" | base64 --decode
}

sync_file() {
  local remote_path="$1"
  local local_file="${REPO_ROOT}/${LOCAL_PATH}/${remote_path}"

  mkdir -p "$(dirname "$local_file")"
  fetch_file "$remote_path" > "$local_file"
}

discover_files() {
  local dir_path="$1"
  local entries
  entries=$(gh api "repos/${UPSTREAM_REPO}/contents/${UPSTREAM_PATH}/${dir_path}" --jq '.[] | "\(.type)\t\(.name)"')

  while IFS=$'\t' read -r type name; do
    local rel_path="${dir_path:+${dir_path}/}${name}"
    if [ "$type" = "file" ] && [ "$name" != "README.md" ]; then
      echo "$rel_path"
    elif [ "$type" = "dir" ]; then
      discover_files "$rel_path"
    fi
  done <<< "$entries"
}

echo "Syncing WDS skill from ${UPSTREAM_REPO}/${UPSTREAM_PATH} → ${LOCAL_PATH}"

# Discover all files from upstream (excluding README.md)
files=$(discover_files "")

# Remove local files that no longer exist upstream
if [ -d "${REPO_ROOT}/${LOCAL_PATH}" ]; then
  while IFS= read -r local_file; do
    rel_path="${local_file#${REPO_ROOT}/${LOCAL_PATH}/}"
    if ! echo "$files" | grep -qxF "$rel_path"; then
      echo "Removing ${rel_path} (deleted upstream)"
      rm -f "$local_file"
    fi
  done < <(find "${REPO_ROOT}/${LOCAL_PATH}" -type f)
fi

# Sync all upstream files
while IFS= read -r file; do
  echo "  Syncing ${file}"
  sync_file "$file"
done <<< "$files"

# Preserve local skill name in SKILL.md frontmatter
SKILL_FILE="${REPO_ROOT}/${LOCAL_PATH}/SKILL.md"
sed "s/^name: .*$/name: ${LOCAL_SKILL_NAME}/" "$SKILL_FILE" > "${SKILL_FILE}.tmp"
mv "${SKILL_FILE}.tmp" "$SKILL_FILE"

if ! grep -q "^name: ${LOCAL_SKILL_NAME}$" "$SKILL_FILE"; then
  echo "ERROR: Failed to set skill name in SKILL.md frontmatter" >&2
  exit 1
fi

if git -C "$REPO_ROOT" diff --quiet -- "$LOCAL_PATH"; then
  echo "No changes detected — already in sync."
else
  echo "Changes detected:"
  git -C "$REPO_ROOT" diff --stat -- "$LOCAL_PATH"
fi
