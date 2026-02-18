param(
  [string]$WorkspaceDir = "$HOME\.myagent\workspace"
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$templatesDir = Join-Path $repoRoot "templates"
$skillsSourceDir = Join-Path $repoRoot "skills"

function Write-Info([string]$Message) {
  Write-Host $Message
}

function New-DirectoryIfMissing([string]$DirPath) {
  if (Test-Path -Path $DirPath -PathType Container) {
    Write-Info "already exists, skipping directory: $DirPath"
    return
  }
  New-Item -ItemType Directory -Path $DirPath -Force | Out-Null
  Write-Info "created directory: $DirPath"
}

function Copy-FileIfMissing([string]$SourcePath, [string]$DestPath) {
  if (-not (Test-Path -Path $SourcePath -PathType Leaf)) {
    Write-Info "missing source, skipping: $SourcePath"
    return
  }
  if (Test-Path -Path $DestPath -PathType Leaf) {
    Write-Info "already exists, skipping file: $DestPath"
    return
  }
  $destDir = Split-Path -Parent $DestPath
  if ($destDir) {
    New-DirectoryIfMissing $destDir
  }
  Copy-Item -Path $SourcePath -Destination $DestPath -Force
  Write-Info "created file: $DestPath"
}

Write-Info "Setting up workspace at: $WorkspaceDir"

New-DirectoryIfMissing $WorkspaceDir
New-DirectoryIfMissing (Join-Path $WorkspaceDir "memory")
New-DirectoryIfMissing (Join-Path $WorkspaceDir "tasks")
New-DirectoryIfMissing (Join-Path $WorkspaceDir "skills")
New-DirectoryIfMissing (Join-Path $WorkspaceDir "skills\research")
New-DirectoryIfMissing (Join-Path $WorkspaceDir "skills\summarize")
New-DirectoryIfMissing (Join-Path $WorkspaceDir "skills\daily-briefing")

# Seed task tracking files
Copy-FileIfMissing (Join-Path $templatesDir "tasks\todo.md") (Join-Path $WorkspaceDir "tasks\todo.md")
Copy-FileIfMissing (Join-Path $templatesDir "tasks\lessons.md") (Join-Path $WorkspaceDir "tasks\lessons.md")

# Bootstrap templates
Copy-FileIfMissing (Join-Path $templatesDir "SOUL.md") (Join-Path $WorkspaceDir "SOUL.md")
Copy-FileIfMissing (Join-Path $templatesDir "USER.md") (Join-Path $WorkspaceDir "USER.md")
Copy-FileIfMissing (Join-Path $templatesDir "AGENTS.md") (Join-Path $WorkspaceDir "AGENTS.md")
Copy-FileIfMissing (Join-Path $templatesDir "MEMORY.md") (Join-Path $WorkspaceDir "MEMORY.md")
Copy-FileIfMissing (Join-Path $templatesDir "IDENTITY.md") (Join-Path $WorkspaceDir "IDENTITY.md")

# Starter skills
Copy-FileIfMissing (Join-Path $skillsSourceDir "research\SKILL.md") (Join-Path $WorkspaceDir "skills\research\SKILL.md")
Copy-FileIfMissing (Join-Path $skillsSourceDir "summarize\SKILL.md") (Join-Path $WorkspaceDir "skills\summarize\SKILL.md")
Copy-FileIfMissing (Join-Path $skillsSourceDir "daily-briefing\SKILL.md") (Join-Path $WorkspaceDir "skills\daily-briefing\SKILL.md")

$targetUserFile = Join-Path $WorkspaceDir "USER.md"
$editor = $env:EDITOR

if ([string]::IsNullOrWhiteSpace($editor)) {
  if (Get-Command code -ErrorAction SilentlyContinue) {
    $editor = "code"
  } else {
    $editor = "notepad"
  }
}

if (Get-Command $editor -ErrorAction SilentlyContinue) {
  Write-Info "Opening USER.md in editor: $editor"
  if ($editor -eq "code") {
    Start-Process -FilePath $editor -ArgumentList @("--reuse-window", $targetUserFile) | Out-Null
  } else {
    Start-Process -FilePath $editor -ArgumentList @($targetUserFile) | Out-Null
  }
} else {
  Write-Info "Editor '$editor' not found. Open this file manually:"
  Write-Info "  $targetUserFile"
}

Write-Info ""
Write-Info "Setup complete."
Write-Info "Customize next:"
Write-Info "1) $WorkspaceDir\USER.md       — who you are, your stack, preferences"
Write-Info "2) $WorkspaceDir\SOUL.md       — your assistant's name and personality"
Write-Info "3) $WorkspaceDir\IDENTITY.md   — fallback identity (update name placeholders)"
Write-Info "4) $WorkspaceDir\AGENTS.md     — tool and task execution rules"
Write-Info "5) $WorkspaceDir\MEMORY.md     — cross-session persistent memory"
Write-Info "6) $WorkspaceDir\skills\*\SKILL.md"
