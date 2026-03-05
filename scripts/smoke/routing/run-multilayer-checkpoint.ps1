param(
  [switch]$StopOnFail
)

$ErrorActionPreference = "Continue"

$suites = @(
  "src-multilayer-agentic-completeness-smoke.mjs",
  "src-short-term-context-policies-smoke.mjs",
  "src-operator-worker-executors-smoke.mjs",
  "src-operator-intent-signals-smoke.mjs",
  "src-operator-lane-wiring-smoke.mjs",
  "src-operator-lane-registry-consistency-smoke.mjs",
  "src-operator-route-decisions-smoke.mjs",
  "src-operator-context-hints-smoke.mjs",
  "src-operator-dispatch-smoke.mjs",
  "src-org-chart-routing-registry-smoke.mjs",
  "src-org-chart-delegation-smoke.mjs",
  "src-operator-routing-handlers-smoke.mjs",
  "src-operator-preflight-smoke.mjs",
  "src-operator-finalization-smoke.mjs",
  "src-plugin-isolation-smoke.mjs",
  "src-routing-arbitration-smoke.mjs",
  "src-tool-loop-concurrency-smoke.mjs",
  "src-tool-loop-guardrails-smoke.mjs",
  "src-tool-loop-smoke.mjs",
  "src-tool-runtime-bootstrap-smoke.mjs",
  "src-transport-stability-smoke.mjs"
)

$pass = 0
$fail = 0
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")

Push-Location $repoRoot
try {
  foreach ($suite in $suites) {
    $suitePath = Join-Path $PSScriptRoot $suite
    $output = & node $suitePath 2>&1
    $summary = ($output | Select-String -Pattern "^Summary:" | Select-Object -Last 1).Line
    if ([string]::IsNullOrWhiteSpace($summary)) {
      $summary = "Summary: (not found)"
    }

    if ($LASTEXITCODE -eq 0) {
      $pass++
      Write-Host "[PASS] $suite :: $summary"
    } else {
      $fail++
      Write-Host "[FAIL] $suite :: $summary"
      if ($StopOnFail) {
        break
      }
    }
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Checkpoint Summary: pass=$pass fail=$fail total=$($suites.Count)"
if ($fail -gt 0) {
  exit 1
}
