#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const AUDIT_ROOT = path.join(ROOT, "docs", "repo-audit");
const BATCH_SIZE = 40;

const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".env",
  ".sh",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".graphql",
  ".gql",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".xml",
  ".svg",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".zip",
  ".gz",
  ".tgz",
  ".7z",
  ".jar",
  ".wasm",
  ".bin",
]);

const IMPORT_REGEXES = [
  /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
];

const HARDCODE_PATTERNS = [
  {
    id: "possible_secret",
    severity: "Critical",
    description: "Potential credential/token literal detected.",
    regex:
      /\b(sk-(live|test)-[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,}|xox[baprs]-[A-Za-z0-9\-]{12,})\b/,
  },
  {
    id: "hardcoded_url",
    severity: "Low",
    description: "Hardcoded URL literal detected.",
    regex: /\bhttps?:\/\/[^\s'"`]+/,
  },
  {
    id: "hardcoded_uuid",
    severity: "Medium",
    description: "Hardcoded UUID detected.",
    regex:
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  },
  {
    id: "hardcoded_limit",
    severity: "Low",
    description: "Hardcoded operational limit/timeout constant detected.",
    regex:
      /\b(const|let|var)\s+[A-Za-z0-9_]*(LIMIT|TIMEOUT|RETRY|MAX|MIN|TTL|RETENTION|INTERVAL|WINDOW)[A-Za-z0-9_]*\s*=\s*\d+/i,
  },
  {
    id: "tenant_assumption",
    severity: "Medium",
    description: "Possible single-tenant/user-specific literal detected.",
    regex:
      /\b(jackpastor27@gmail\.com|userContextId\s*:\s*["'`][^"'`]+["'`]|tenantId\s*:\s*["'`][^"'`]+["'`]|orgId\s*:\s*["'`][^"'`]+["'`])\b/i,
  },
];

const RISK_PATTERNS = [
  {
    id: "eval_usage",
    severity: "High",
    description: "Dynamic code execution (`eval`) found.",
    regex: /\beval\s*\(/,
  },
  {
    id: "new_function_usage",
    severity: "High",
    description: "Dynamic code execution (`new Function`) found.",
    regex: /\bnew\s+Function\s*\(/,
  },
  {
    id: "exec_sync_usage",
    severity: "High",
    description: "Blocking shell execution (`execSync`) found.",
    regex: /\bexecSync\s*\(/,
  },
  {
    id: "todo_fixme",
    severity: "Low",
    description: "TODO/FIXME/HACK marker found.",
    regex: /\b(TODO|FIXME|HACK)\b/,
  },
];

const SEVERITY_WEIGHT = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

function normalizePosix(filePath) {
  return filePath.replace(/\\/g, "/");
}

function listTrackedFiles() {
  const manifestPath = process.env.REPO_AUDIT_FILELIST;
  if (manifestPath && fs.existsSync(manifestPath)) {
    const rawManifest = fs.readFileSync(manifestPath, "utf8");
    return rawManifest
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((file) => !file.startsWith("docs/repo-audit/"));
  }

  const raw = execSync("git ls-files", { encoding: "utf8" });
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith("docs/repo-audit/"));
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function readBufferSafe(absPath, bytes = 8192) {
  const fd = fs.openSync(absPath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const count = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, count);
  } finally {
    fs.closeSync(fd);
  }
}

function isProbablyBinary(file, sampleBuffer) {
  const ext = path.extname(file).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  if (!sampleBuffer || sampleBuffer.length === 0) return false;
  let controlChars = 0;
  for (const byte of sampleBuffer) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) controlChars += 1;
  }
  const controlRatio = controlChars / sampleBuffer.length;
  if (controlRatio > 0.2) return true;
  if (!CODE_EXTENSIONS.has(ext) && ext !== "" && controlRatio > 0.08) return true;
  return false;
}

function toLines(content) {
  return content.split(/\r?\n/);
}

function collectImports(content) {
  const specs = [];
  for (const regex of IMPORT_REGEXES) {
    regex.lastIndex = 0;
    let match = regex.exec(content);
    while (match) {
      if (match[1]) specs.push(match[1]);
      match = regex.exec(content);
    }
  }
  return [...new Set(specs)];
}

function resolveImportTarget(importer, spec, trackedSet) {
  const candidates = [];
  const importerDir = path.posix.dirname(importer);
  if (spec.startsWith(".")) {
    candidates.push(path.posix.normalize(path.posix.join(importerDir, spec)));
  } else if (spec.startsWith("@/")) {
    candidates.push(path.posix.normalize(`hud/${spec.slice(2)}`));
  } else if (spec.startsWith("~/")) {
    candidates.push(path.posix.normalize(spec.slice(2)));
  } else if (spec.startsWith("src/") || spec.startsWith("hud/") || spec.startsWith("scripts/")) {
    candidates.push(path.posix.normalize(spec));
  } else {
    return null;
  }

  const exts = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".css",
    ".scss",
    ".yml",
    ".yaml",
  ];

  for (const base of candidates) {
    for (const ext of exts) {
      const direct = `${base}${ext}`;
      if (trackedSet.has(direct)) return direct;
    }
    for (const ext of exts.slice(1)) {
      const idx = path.posix.join(base, `index${ext}`);
      if (trackedSet.has(idx)) return idx;
    }
  }
  return null;
}

function detectHardcoding(lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of HARDCODE_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          kind: pattern.id,
          severity: pattern.severity,
          description: pattern.description,
          line: i + 1,
          snippet: line.trim().slice(0, 220),
        });
      }
    }
  }
  return findings;
}

function detectRisks(file, content, lines, hardcodingFindings) {
  const risks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of RISK_PATTERNS) {
      if (pattern.regex.test(line)) {
        risks.push({
          severity: pattern.severity,
          title: pattern.description,
          line: i + 1,
          evidence: line.trim().slice(0, 220),
        });
      }
    }
  }

  for (const finding of hardcodingFindings) {
    risks.push({
      severity: finding.severity,
      title: finding.description,
      line: finding.line,
      evidence: finding.snippet,
    });
  }

  const lowerFile = file.toLowerCase();
  const isApiLike =
    lowerFile.includes("/api/") ||
    lowerFile.endsWith("/route.ts") ||
    lowerFile.endsWith("/route.js");
  if (isApiLike && /\brequest\b/i.test(content)) {
    const hasValidation =
      /\bzod\b|\bsafeParse\b|\bparse\s*\(|\bvalidate\b|\bschema\b/i.test(content);
    if (!hasValidation) {
      risks.push({
        severity: "Medium",
        title: "API-style file has no explicit input validation indicator.",
        line: 1,
        evidence: "No zod/safeParse/validate/schema pattern found in file scan.",
      });
    }
  }

  const isRealtimeOrBroadcast =
    /\bbroadcast\b|\bemit\s*\(|\bwss\.clients\b|\bsocket\b/i.test(content) &&
    (lowerFile.includes("chat") ||
      lowerFile.includes("gateway") ||
      lowerFile.includes("runtime") ||
      lowerFile.includes("thread"));
  if (isRealtimeOrBroadcast && !/\buserContextId\b/.test(content)) {
    risks.push({
      severity: "High",
      title: "Realtime/broadcast path missing explicit `userContextId` evidence.",
      line: 1,
      evidence: "Broadcast/socket patterns found without `userContextId` string.",
    });
  }

  const isBackendFile =
    lowerFile.startsWith("src/") ||
    lowerFile.includes("/api/") ||
    lowerFile.includes("scheduler");
  if (
    isBackendFile &&
    !/\btelemetry\b|\blogger\b|\bconsole\.(log|warn|error)\b|\blog\(/i.test(content)
  ) {
    risks.push({
      severity: "Low",
      title: "No explicit telemetry/logging indicators found.",
      line: 1,
      evidence: "No telemetry/logger/log token matches in static scan.",
    });
  }

  return risks;
}

function clampScore(value) {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function letterGrade(score) {
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 67) return "D+";
  if (score >= 63) return "D";
  if (score >= 60) return "D-";
  return "F";
}

function computeScores(fileMeta, risks) {
  const scores = {
    security: 90,
    latency: 88,
    performanceEfficiency: 88,
    telemetryObservability: 84,
    validationInputSafety: 86,
    reliabilityFaultTolerance: 86,
    maintainability: 85,
    testability: 82,
    scalability: 84,
    enterpriseReadiness: 85,
  };

  const isLarge = fileMeta.lineCount > 600;
  if (isLarge) {
    scores.maintainability -= 8;
    scores.testability -= 6;
    scores.performanceEfficiency -= 3;
  }

  const riskCountBySeverity = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const risk of risks) {
    riskCountBySeverity[risk.severity] += 1;
    if (risk.severity === "Critical") {
      scores.security -= 25;
      scores.enterpriseReadiness -= 18;
      scores.validationInputSafety -= 15;
      scores.reliabilityFaultTolerance -= 12;
    } else if (risk.severity === "High") {
      scores.security -= 16;
      scores.enterpriseReadiness -= 14;
      scores.reliabilityFaultTolerance -= 10;
      scores.validationInputSafety -= 8;
      scores.scalability -= 6;
    } else if (risk.severity === "Medium") {
      scores.validationInputSafety -= 8;
      scores.reliabilityFaultTolerance -= 7;
      scores.maintainability -= 5;
      scores.enterpriseReadiness -= 5;
      scores.latency -= 3;
    } else if (risk.severity === "Low") {
      scores.maintainability -= 2;
      scores.telemetryObservability -= 2;
      scores.performanceEfficiency -= 1;
    }
  }

  if (/\bexecSync\s*\(/.test(fileMeta.content || "")) {
    scores.latency -= 12;
    scores.performanceEfficiency -= 8;
  }
  if (/\breadFileSync\s*\(/.test(fileMeta.content || "")) {
    scores.latency -= 6;
    scores.performanceEfficiency -= 4;
  }
  if (/\bsetInterval\s*\(/.test(fileMeta.content || "")) {
    scores.scalability -= 4;
    scores.reliabilityFaultTolerance -= 3;
  }

  for (const key of Object.keys(scores)) {
    scores[key] = clampScore(scores[key]);
  }

  const values = Object.values(scores);
  const overall = clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
  return { scores, overall, overallLetter: letterGrade(overall), riskCountBySeverity };
}

function summarizePurpose(file, content, isBinary) {
  if (isBinary) return "Binary/static asset used by the application build or runtime.";
  const ext = path.extname(file).toLowerCase();
  const lower = file.toLowerCase();
  if (lower.endsWith("/route.ts") || lower.endsWith("/route.js")) {
    return "API route handler that processes HTTP requests for this endpoint.";
  }
  if (lower.includes("/__tests__/") || /\.test\./.test(lower) || /\.spec\./.test(lower)) {
    return "Automated test file that validates behavior/regressions.";
  }
  if (lower.startsWith("scripts/")) {
    return "Automation script used for smoke testing, tooling, or developer workflows.";
  }
  if (lower.endsWith("readme.md") || ext === ".md") {
    return "Documentation/reference content for developers or operators.";
  }
  if (lower.endsWith("package.json") || lower.includes("tsconfig") || lower.includes("eslint")) {
    return "Configuration file that controls build, linting, or runtime toolchain behavior.";
  }
  if (ext === ".json" || ext === ".yml" || ext === ".yaml" || ext === ".toml") {
    return "Structured configuration or data file consumed by tooling/runtime.";
  }
  if (/\bexport\s+default\b|\bexport\s+(const|function|class)\b/.test(content || "")) {
    return "Source module that exports reusable runtime/UI behavior.";
  }
  if (lower.endsWith(".css") || lower.endsWith(".scss")) {
    return "Styling asset that defines visual presentation and layout behavior.";
  }
  return "Repository file supporting application code, tooling, or operations.";
}

function decideLifecycle(file) {
  const lower = file.toLowerCase();
  if (lower.includes("google-calender")) {
    return {
      decision: "Move",
      moveTo: file.replace(/google-calender/gi, "google-calendar"),
      reason: "Correct spelling in folder name to reduce import confusion and improve discoverability.",
    };
  }
  if (/(^|\/)(tmp|temp|backup|backups|old)(\/|$)/.test(lower) || /\.bak$/.test(lower)) {
    return {
      decision: "Delete",
      moveTo: "",
      reason: "Candidate appears temporary/legacy; validate references and remove if unused.",
    };
  }
  return {
    decision: "Keep",
    moveTo: "",
    reason: "File is part of current tracked repository state.",
  };
}

function relativeReportPath(file) {
  return `${normalizePosix(file)}.audit.md`;
}

function writeReport(fileMeta, inboundDependents, recordsContext) {
  const {
    file,
    isBinary,
    missing,
    size,
    lineCount,
    imports,
    content,
    hardcodingFindings,
    risks,
    grades,
    lifecycle,
  } = fileMeta;
  const reportRel = relativeReportPath(file);
  const reportAbs = path.join(AUDIT_ROOT, ...reportRel.split("/"));
  ensureDir(path.dirname(reportAbs));

  const inbound = inboundDependents || [];
  const riskLines = risks
    .slice(0, 12)
    .map(
      (risk, index) =>
        `${index + 1}. **${risk.severity}** - ${risk.title} (line ${risk.line})\n   Evidence: \`${risk.evidence}\``,
    );
  if (riskLines.length === 0) riskLines.push("1. None detected in static scan.");

  const hardcodingLines = hardcodingFindings
    .slice(0, 10)
    .map(
      (finding, index) =>
        `${index + 1}. **${finding.severity}** ${finding.description} (line ${finding.line})\n   Evidence: \`${finding.snippet}\``,
    );
  if (hardcodingLines.length === 0) {
    hardcodingLines.push(
      `1. No hardcoded secret/UUID/tenant literal matches detected across ${lineCount} scanned lines.`,
    );
  }

  const quickWins = [];
  const longerTerm = [];
  for (const risk of risks) {
    if (risk.severity === "Critical" || risk.severity === "High") {
      quickWins.push(`Address ${risk.severity.toLowerCase()} risk: ${risk.title}`);
    } else if (risk.severity === "Medium") {
      longerTerm.push(`Resolve medium-risk item: ${risk.title}`);
    }
  }
  if (quickWins.length === 0) quickWins.push("No urgent remediation required by current static checks.");
  if (longerTerm.length === 0) longerTerm.push("Reassess after targeted runtime and smoke coverage review.");

  const doNow = risks.filter((r) => r.severity === "Critical" || r.severity === "High").slice(0, 5);
  const doNext = risks.filter((r) => r.severity === "Medium").slice(0, 5);
  const later = risks.filter((r) => r.severity === "Low").slice(0, 5);

  const markdown = `# Audit: \`${file}\`

## 1) File Path + Parent Tree Location
- File path: \`${file}\`
- Parent directory: \`${path.posix.dirname(file)}\`
- Report generated at: \`${new Date().toISOString()}\`

## 2) What This File Does
${missing ? "Tracked file is currently missing from the working tree; audit is based on index presence and metadata only." : summarizePurpose(file, content, isBinary)}

## 3) Dependencies In/Out
- Outbound dependencies (static-detected): ${
    imports.length > 0 ? imports.slice(0, 20).map((dep) => `\`${dep}\``).join(", ") : "None detected."
  }
- Inbound dependents (static-detected): ${
    inbound.length > 0 ? inbound.slice(0, 20).map((dep) => `\`${dep}\``).join(", ") : "None detected."
  }
- Detection scope: Static import/require scan + local import resolution where possible.

## 4) Keep/Delete/Move Decision
- Decision: **${lifecycle.decision}**
- Rationale: ${lifecycle.reason}

## 5) Move Proposal
- Proposed new path: ${lifecycle.moveTo ? `\`${lifecycle.moveTo}\`` : "N/A"}
- Reason: ${lifecycle.moveTo ? lifecycle.reason : "No move required."}

## 6) Hardcoding Check
${hardcodingLines.join("\n")}

## 7) Risk Findings with Severity
${riskLines.join("\n")}

## 8) Grading Table (0-100 + Letter)
| Category | Score | Letter |
|---|---:|:---:|
| Security | ${grades.scores.security} | ${letterGrade(grades.scores.security)} |
| Latency | ${grades.scores.latency} | ${letterGrade(grades.scores.latency)} |
| Performance efficiency | ${grades.scores.performanceEfficiency} | ${letterGrade(grades.scores.performanceEfficiency)} |
| Telemetry/observability | ${grades.scores.telemetryObservability} | ${letterGrade(grades.scores.telemetryObservability)} |
| Validation/input safety | ${grades.scores.validationInputSafety} | ${letterGrade(grades.scores.validationInputSafety)} |
| Reliability/fault tolerance | ${grades.scores.reliabilityFaultTolerance} | ${letterGrade(grades.scores.reliabilityFaultTolerance)} |
| Maintainability | ${grades.scores.maintainability} | ${letterGrade(grades.scores.maintainability)} |
| Testability | ${grades.scores.testability} | ${letterGrade(grades.scores.testability)} |
| Scalability | ${grades.scores.scalability} | ${letterGrade(grades.scores.scalability)} |
| Enterprise readiness | ${grades.scores.enterpriseReadiness} | ${letterGrade(grades.scores.enterpriseReadiness)} |

## 9) Baseline Grade (Overall)
- Overall score: **${grades.overall}/100**
- Overall letter: **${grades.overallLetter}**
- Scan metadata: ${missing ? "Missing from working tree during scan" : isBinary ? "Binary file" : `${lineCount} lines, ${size} bytes`}.

## 10) Actionable Improvements
- Quick wins:
${quickWins.slice(0, 5).map((item) => `  - ${item}`).join("\n")}
- Longer-term:
${longerTerm.slice(0, 5).map((item) => `  - ${item}`).join("\n")}

## 11) Do now / Do next / Later Checklist
- Do now:
${(doNow.length ? doNow : [{ title: "No critical/high findings in static scan." }])
  .map((item) => `  - [ ] ${item.title}`)
  .join("\n")}
- Do next:
${(doNext.length
  ? doNext
  : [{ title: "Validate behavior with targeted smoke tests under real userContextId." }])
  .map((item) => `  - [ ] ${item.title}`)
  .join("\n")}
- Later:
${(later.length ? later : [{ title: "Re-run audit after next release and compare grade drift." }])
  .map((item) => `  - [ ] ${item.title}`)
  .join("\n")}

---

## Evidence Snapshot
- File size: ${size} bytes
- Line count: ${lineCount}
- Import count: ${imports.length}
- Inbound dependent count: ${inbound.length}
- Risk count: ${risks.length}
- Hardcoding match count: ${hardcodingFindings.length}
- Global progress when generated: ${recordsContext.processed}/${recordsContext.total}
`;

  fs.writeFileSync(reportAbs, markdown, "utf8");
}

function toCsvValue(value) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) return `"${stringValue.replace(/"/g, '""')}"`;
  return stringValue;
}

function writeIndex(records, total) {
  const indexPath = path.join(AUDIT_ROOT, "INDEX.md");
  ensureDir(path.dirname(indexPath));
  const lines = [
    "# Repository Audit Index",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Coverage progress: ${records.length}/${total} tracked files`,
    "",
    "| # | File | Report | Decision | Overall | High+Critical |",
    "|---:|---|---|---|---:|---:|",
  ];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const reportLink = `./${record.reportRelative}`;
    const highPlus = record.riskCounts.High + record.riskCounts.Critical;
    lines.push(
      `| ${i + 1} | \`${record.file}\` | [audit](${reportLink}) | ${record.decision} | ${record.overall}/100 (${record.overallLetter}) | ${highPlus} |`,
    );
  }
  fs.writeFileSync(indexPath, `${lines.join("\n")}\n`, "utf8");
}

function writeGrades(records) {
  const csvPath = path.join(AUDIT_ROOT, "grades.csv");
  ensureDir(path.dirname(csvPath));
  const header = [
    "file",
    "decision",
    "move_to",
    "security",
    "latency",
    "performance_efficiency",
    "telemetry_observability",
    "validation_input_safety",
    "reliability_fault_tolerance",
    "maintainability",
    "testability",
    "scalability",
    "enterprise_readiness",
    "overall_score",
    "overall_letter",
    "critical_risks",
    "high_risks",
    "medium_risks",
    "low_risks",
    "report_path",
  ];
  const rows = [header.join(",")];
  for (const record of records) {
    const row = [
      record.file,
      record.decision,
      record.moveTo || "",
      record.scores.security,
      record.scores.latency,
      record.scores.performanceEfficiency,
      record.scores.telemetryObservability,
      record.scores.validationInputSafety,
      record.scores.reliabilityFaultTolerance,
      record.scores.maintainability,
      record.scores.testability,
      record.scores.scalability,
      record.scores.enterpriseReadiness,
      record.overall,
      record.overallLetter,
      record.riskCounts.Critical,
      record.riskCounts.High,
      record.riskCounts.Medium,
      record.riskCounts.Low,
      `docs/repo-audit/${record.reportRelative}`,
    ].map(toCsvValue);
    rows.push(row.join(","));
  }
  fs.writeFileSync(csvPath, `${rows.join("\n")}\n`, "utf8");
}

function pickTopRisk(records, limit = 20) {
  const score = (record) =>
    record.riskCounts.Critical * SEVERITY_WEIGHT.Critical +
    record.riskCounts.High * SEVERITY_WEIGHT.High +
    record.riskCounts.Medium * SEVERITY_WEIGHT.Medium +
    record.riskCounts.Low * SEVERITY_WEIGHT.Low;
  return [...records]
    .sort((a, b) => {
      const scoreDiff = score(b) - score(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.overall - b.overall;
    })
    .slice(0, limit);
}

function findDuplicateAndDeadCodeCandidates(records) {
  const basenameMap = new Map();
  for (const record of records) {
    const base = path.posix.basename(record.file);
    if (!basenameMap.has(base)) basenameMap.set(base, []);
    basenameMap.get(base).push(record.file);
  }
  const duplicateCandidates = [];
  for (const [base, files] of basenameMap.entries()) {
    if (files.length >= 3) {
      duplicateCandidates.push({ base, files: files.slice(0, 10) });
    }
  }
  duplicateCandidates.sort((a, b) => b.files.length - a.files.length);

  const deadCodeCandidates = records
    .filter((record) => {
      const lower = record.file.toLowerCase();
      const exempt =
        lower.endsWith("readme.md") ||
        lower.includes("/__tests__/") ||
        /\.test\./.test(lower) ||
        lower.startsWith("scripts/") ||
        lower.endsWith(".md") ||
        lower.endsWith("package.json") ||
        lower.includes("tsconfig") ||
        lower.includes("eslint") ||
        lower.includes("next.config") ||
        lower.includes("vite.config");
      if (exempt) return false;
      return record.inboundCount === 0 && record.importCount > 0;
    })
    .slice(0, 40);

  return { duplicateCandidates, deadCodeCandidates };
}

function gradeDistribution(records) {
  const dist = new Map();
  for (const record of records) {
    dist.set(record.overallLetter, (dist.get(record.overallLetter) || 0) + 1);
  }
  return [...dist.entries()].sort((a, b) => b[1] - a[1]);
}

function writeSummary(records, totalTracked) {
  const summaryPath = path.join(AUDIT_ROOT, "SUMMARY.md");
  const topRisk = pickTopRisk(records, 20);
  const { duplicateCandidates, deadCodeCandidates } = findDuplicateAndDeadCodeCandidates(records);
  const moves = records.filter((record) => record.decision === "Move");
  const dist = gradeDistribution(records);

  const criticalCount = records.reduce((sum, record) => sum + record.riskCounts.Critical, 0);
  const highCount = records.reduce((sum, record) => sum + record.riskCounts.High, 0);
  const mediumCount = records.reduce((sum, record) => sum + record.riskCounts.Medium, 0);
  const lowCount = records.reduce((sum, record) => sum + record.riskCounts.Low, 0);

  const blockers = [];
  if (criticalCount > 0) blockers.push(`${criticalCount} critical risk findings`);
  if (highCount > 0) blockers.push(`${highCount} high risk findings`);
  const verdict = blockers.length > 0 ? "NO-GO" : "GO";

  const lines = [
    "# Repository Audit Summary",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Files audited: ${records.length}/${totalTracked}`,
    `- Coverage check: ${records.length === totalTracked ? "PASS" : "FAIL"}`,
    `- Production readiness verdict: **${verdict}**`,
    `- Blockers: ${blockers.length ? blockers.join("; ") : "No critical/high blockers from static scan."}`,
    "",
    "## Global Findings",
    `- Critical findings: ${criticalCount}`,
    `- High findings: ${highCount}`,
    `- Medium findings: ${mediumCount}`,
    `- Low findings: ${lowCount}`,
    "",
    "## Top 20 Highest-Risk Files",
    "| # | File | Overall | Critical | High | Medium | Low | Report |",
    "|---:|---|---:|---:|---:|---:|---:|---|",
  ];

  topRisk.forEach((record, idx) => {
    lines.push(
      `| ${idx + 1} | \`${record.file}\` | ${record.overall}/100 (${record.overallLetter}) | ${record.riskCounts.Critical} | ${record.riskCounts.High} | ${record.riskCounts.Medium} | ${record.riskCounts.Low} | [audit](./${record.reportRelative}) |`,
    );
  });

  lines.push("");
  lines.push("## Duplicate/Dead-Code Candidates");
  lines.push("### Duplicate-name candidates");
  if (duplicateCandidates.length === 0) {
    lines.push("- None detected by filename clustering.");
  } else {
    for (const item of duplicateCandidates.slice(0, 20)) {
      lines.push(`- \`${item.base}\`: ${item.files.map((file) => `\`${file}\``).join(", ")}`);
    }
  }

  lines.push("");
  lines.push("### Dead-code candidates (zero inbound import references)");
  if (deadCodeCandidates.length === 0) {
    lines.push("- None detected by static inbound analysis.");
  } else {
    for (const record of deadCodeCandidates.slice(0, 40)) {
      lines.push(`- \`${record.file}\` (overall ${record.overall}/100, imports out: ${record.importCount})`);
    }
  }

  lines.push("");
  lines.push("## Proposed Folder Moves / Refactor Map");
  if (moves.length === 0) {
    lines.push("- No move candidates detected in this scan.");
  } else {
    for (const move of moves.slice(0, 60)) {
      lines.push(`- \`${move.file}\` -> \`${move.moveTo}\` (${move.lifecycleReason})`);
    }
  }

  lines.push("");
  lines.push("## Repo-Wide Grade Distribution");
  if (dist.length === 0) {
    lines.push("- No grades computed.");
  } else {
    for (const [letter, count] of dist) {
      lines.push(`- ${letter}: ${count} files`);
    }
  }

  lines.push("");
  lines.push("## Migration / Improvement Plan");
  lines.push(
    "1. Resolve all critical/high findings first, with priority on security/isolation and realtime routing paths.",
  );
  lines.push(
    "2. Standardize naming and folder conventions (notably `google-calender` -> `google-calendar`) using codemods + import rewrites.",
  );
  lines.push(
    "3. Add/expand user-scoped smoke tests under real `userContextId` for calendar, chat dedup, and scheduler fairness paths.",
  );
  lines.push(
    "4. Convert medium-risk hardcoded constants to environment/config-driven controls where runtime policy requires flexibility.",
  );
  lines.push("5. Re-run this audit in CI and fail build on coverage mismatch or new critical findings.");
  lines.push("");
  lines.push("## Artifacts");
  lines.push("- [INDEX.md](./INDEX.md)");
  lines.push("- [grades.csv](./grades.csv)");
  lines.push("");

  fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
}

function buildFileMetadata(files) {
  const metadata = [];
  for (const file of files) {
    const absPath = path.join(ROOT, ...file.split("/"));
    if (!fs.existsSync(absPath)) {
      metadata.push({
        file: normalizePosix(file),
        absPath,
        missing: true,
        isBinary: false,
        content: "",
        lineCount: 0,
        imports: [],
        size: 0,
      });
      continue;
    }

    const stat = fs.statSync(absPath);
    const sample = readBufferSafe(absPath, 8192);
    const isBinary = isProbablyBinary(file, sample);
    let content = "";
    let lineCount = 0;
    let imports = [];

    if (!isBinary) {
      content = fs.readFileSync(absPath, "utf8");
      lineCount = toLines(content).length;
      imports = collectImports(content);
    }

    metadata.push({
      file: normalizePosix(file),
      absPath,
      missing: false,
      isBinary,
      content,
      lineCount,
      imports,
      size: stat.size,
    });
  }
  return metadata;
}

function main() {
  ensureDir(AUDIT_ROOT);
  const trackedFiles = listTrackedFiles();
  const totalTracked = trackedFiles.length;
  const metadata = buildFileMetadata(trackedFiles);
  const trackedSet = new Set(trackedFiles.map(normalizePosix));

  const inboundMap = new Map();
  for (const file of trackedSet) inboundMap.set(file, []);

  for (const meta of metadata) {
    for (const spec of meta.imports) {
      const resolved = resolveImportTarget(meta.file, spec, trackedSet);
      if (resolved && inboundMap.has(resolved)) {
        inboundMap.get(resolved).push(meta.file);
      }
    }
  }

  const records = [];
  for (let start = 0; start < metadata.length; start += BATCH_SIZE) {
    const batch = metadata.slice(start, start + BATCH_SIZE);
    for (const meta of batch) {
      const lines = meta.isBinary ? [] : toLines(meta.content);
      const hardcodingFindings = meta.isBinary ? [] : detectHardcoding(lines);
      const risks = meta.missing
        ? [
            {
              severity: "High",
              title: "Tracked file missing from working tree.",
              line: 1,
              evidence: "File listed by git ls-files but not found on disk during audit run.",
            },
          ]
        : meta.isBinary
          ? []
          : detectRisks(meta.file, meta.content, lines, hardcodingFindings);
      const grades = computeScores(meta, risks);
      const lifecycle = decideLifecycle(meta.file);
      const inboundDependents = inboundMap.get(meta.file) || [];

      writeReport(
        {
          ...meta,
          hardcodingFindings,
          risks,
          grades,
          lifecycle,
        },
        inboundDependents,
        {
          processed: records.length + 1,
          total: totalTracked,
        },
      );

      records.push({
        file: meta.file,
        reportRelative: relativeReportPath(meta.file),
        decision: lifecycle.decision,
        moveTo: lifecycle.moveTo,
        lifecycleReason: lifecycle.reason,
        scores: grades.scores,
        overall: grades.overall,
        overallLetter: grades.overallLetter,
        riskCounts: grades.riskCountBySeverity,
        inboundCount: inboundDependents.length,
        importCount: meta.imports.length,
      });
    }

    writeIndex(records, totalTracked);
    writeGrades(records);
    process.stdout.write(
      `[repo-audit] batch complete: ${Math.min(start + BATCH_SIZE, totalTracked)}/${totalTracked}\n`,
    );
  }

  writeSummary(records, totalTracked);
  const generatedCount = records.length;
  if (generatedCount !== totalTracked) {
    process.stderr.write(
      `[repo-audit] coverage mismatch: generated ${generatedCount}, tracked ${totalTracked}\n`,
    );
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`[repo-audit] complete: ${generatedCount}/${totalTracked} files audited.\n`);
}

main();
