<#
  Read-only environment audit for Wix Headless (Windows / PowerShell).

  Emits ONE compact JSON line to stdout describing what's installed and whether
  it meets the bar. Does NOT install anything and does NOT hit the network — it
  only probes local tools, so it's safe to run on every pre-flight.

  Node gate: >= 20.11.0 (the floor the @wix/cli scaffold + astro toolchain need).

  Companion: scripts/audit-env.sh (macOS / Linux) emits the IDENTICAL JSON shape.
  references/shared/ENVIRONMENT.md parses one shape for both.

  Usage (from an agent; -ExecutionPolicy Bypass avoids a blocked-script error):
    powershell -NoProfile -ExecutionPolicy Bypass -File <SKILL_ROOT>\scripts\audit-env.ps1
    # PowerShell 7+:
    pwsh       -NoProfile -ExecutionPolicy Bypass -File <SKILL_ROOT>\scripts\audit-env.ps1

  Output shape (single line; "xcodeCLT" is always null on Windows):
    {"os":"windows","node":{"present":true,"version":"22.3.0","ok":true},
     "npm":{"present":true,"version":"10.8.1"},
     "git":{"present":true,"version":"2.45.1"},
     "gitIdentity":{"nameSet":true,"emailSet":true},
     "xcodeCLT":null,"minNode":"20.11.0"}
#>
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

$minNode = '20.11.0'

function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# Numeric MAJOR.MINOR.PATCH compare: is $have >= $min ?
function Test-SemverGE($have, $min) {
  $h = ($have -split '[.-]'); $m = ($min -split '\.')
  for ($i = 0; $i -lt 3; $i++) {
    $hi = 0; $mi = 0
    [void][int]::TryParse(($h[$i]), [ref]$hi)
    [void][int]::TryParse(($m[$i]), [ref]$mi)
    if ($hi -gt $mi) { return $true }
    if ($hi -lt $mi) { return $false }
  }
  return $true
}

# --- node (+ semver gate) ---
$nodePresent = Test-Cmd node
$nodeVersion = ''
$nodeOk      = $false
if ($nodePresent) {
  $raw = (& node -v) 2>$null
  if ($raw) {
    $nodeVersion = ($raw -replace '^v', '')
    $nodeOk      = Test-SemverGE $nodeVersion $minNode
  }
}

# --- npm ---
$npmPresent = Test-Cmd npm
$npmVersion = ''
if ($npmPresent) { $npmVersion = (& npm -v) 2>$null }

# --- git ---
$gitPresent = Test-Cmd git
$gitVersion = ''
if ($gitPresent) {
  $gv = (& git --version) 2>$null      # "git version 2.45.1.windows.1"
  if ($gv -match '(\d+\.\d+\.\d+)') { $gitVersion = $Matches[1] }
}

# --- git identity ---
$nameSet  = $false
$emailSet = $false
if ($gitPresent) {
  $nameSet  = -not [string]::IsNullOrWhiteSpace(((& git config --global user.name)  2>$null))
  $emailSet = -not [string]::IsNullOrWhiteSpace(((& git config --global user.email) 2>$null))
}

$inv = [ordered]@{
  os          = 'windows'
  node        = [ordered]@{ present = [bool]$nodePresent; version = "$nodeVersion"; ok = [bool]$nodeOk }
  npm         = [ordered]@{ present = [bool]$npmPresent;  version = "$npmVersion" }
  git         = [ordered]@{ present = [bool]$gitPresent;  version = "$gitVersion" }
  gitIdentity = [ordered]@{ nameSet = [bool]$nameSet;     emailSet = [bool]$emailSet }
  xcodeCLT    = $null   # macOS-only concept; always null on Windows
  minNode     = $minNode
}

# -Compress => single line, matching the .sh output.
$inv | ConvertTo-Json -Compress -Depth 4
