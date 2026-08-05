#!/usr/bin/env bash

progress_log_path="${PROGRESS_LOG:-}"
progress_run_id="${RUN_ID:-}"
progress_parent_run_id="${PARENT_RUN_ID:-}"
progress_script="${PROGRESS_SCRIPT:-${0#"$PWD"/}}"
progress_seq=0
progress_seq_state=""
progress_started=0
progress_terminal=0
progress_heartbeat_pid=""
progress_heartbeat_message="Still running"

progress_slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

progress_init() {
  if [[ -z "$progress_run_id" ]]; then
    local slug
    slug="$(progress_slugify "$progress_script")"
    [[ -n "$slug" ]] || slug="script"
    progress_run_id="${slug}-$(date +%s)-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  if [[ -z "$progress_seq_state" ]]; then
    progress_seq_state="${TMPDIR:-/tmp}/rp-progress-${progress_run_id}.seq"
  fi
}

progress_json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

progress_status_for_event() {
  case "$1" in
    complete) printf 'completed' ;;
    error) printf 'failed' ;;
    start|progress|heartbeat|warning) printf 'running' ;;
    *) printf 'running' ;;
  esac
}

progress_next_seq() {
  progress_init
  local lock="${progress_seq_state}.lock"
  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.05
  done
  local current=0
  if [[ -f "$progress_seq_state" ]]; then
    current="$(cat "$progress_seq_state")"
  fi
  progress_seq=$((current + 1))
  printf '%s\n' "$progress_seq" > "$progress_seq_state"
  rmdir "$lock"
}

progress_write() {
  local event="$1"
  local message="$2"
  local fields="${3:-}"
  [[ -n "$progress_log_path" ]] || return 0
  progress_init
  mkdir -p "$(dirname "$progress_log_path")"
  progress_next_seq
  local status ts line
  status="$(progress_status_for_event "$event")"
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  line="{\"ts\":\"$ts\",\"runId\":\"$(progress_json_escape "$progress_run_id")\""
  if [[ -n "$progress_parent_run_id" ]]; then
    line="$line,\"parentRunId\":\"$(progress_json_escape "$progress_parent_run_id")\""
  fi
  line="$line,\"script\":\"$(progress_json_escape "$progress_script")\",\"event\":\"$event\",\"status\":\"$status\",\"seq\":$progress_seq"
  if [[ -n "$fields" ]]; then
    line="$line,$fields"
  fi
  line="$line,\"message\":\"$(progress_json_escape "$message")\"}"
  printf '%s\n' "$line" >> "$progress_log_path"
  [[ "$event" == "start" ]] && progress_started=1
  if [[ "$event" == "complete" || "$event" == "error" ]]; then
    progress_terminal=1
    progress_heartbeat_stop
  fi
}

progress_start() { progress_write start "$1" "${2:-}"; }
progress_progress() { progress_write progress "$1" "${2:-}"; }
progress_heartbeat_line() { progress_write heartbeat "${1:-$progress_heartbeat_message}" "${2:-}"; }
progress_warn() { progress_write warning "$1" "${2:-}"; }
progress_error() { progress_write error "$1" "${2:-}"; }
progress_complete() { progress_write complete "$1" "${2:-}"; }

progress_heartbeat_start() {
  local interval="${1:-30}"
  progress_heartbeat_message="${2:-Still running}"
  [[ -n "$progress_log_path" ]] || return 0
  if [[ -n "$progress_heartbeat_pid" ]]; then
    progress_error "heartbeat already active"
    return 1
  fi
  (
    while sleep "$interval"; do
      progress_heartbeat_line "$progress_heartbeat_message"
    done
  ) &
  progress_heartbeat_pid="$!"
}

progress_heartbeat_stop() {
  if [[ -n "${progress_heartbeat_pid:-}" ]]; then
    kill "$progress_heartbeat_pid" 2>/dev/null || true
    wait "$progress_heartbeat_pid" 2>/dev/null || true
    progress_heartbeat_pid=""
  fi
}

progress_child_env() {
  progress_init
  if [[ -n "$progress_log_path" ]]; then
    printf 'PROGRESS_LOG=%q PARENT_RUN_ID=%q ' "$progress_log_path" "$progress_run_id"
  fi
}

progress_on_exit() {
  local code=$?
  progress_heartbeat_stop
  if [[ "$progress_started" == "1" && "$progress_terminal" == "0" && "$code" != "0" ]]; then
    progress_error "Process exited before writing a terminal progress record" "\"exitCode\":$code"
  fi
}

trap progress_on_exit EXIT
trap 'progress_heartbeat_stop; exit 130' INT
trap 'progress_heartbeat_stop; exit 143' TERM
