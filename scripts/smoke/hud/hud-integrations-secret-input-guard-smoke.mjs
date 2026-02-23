import fs from "node:fs";
import path from "node:path";

const integrationsRoot = path.join(process.cwd(), "hud", "app", "integrations");
const allowedPasswordInputFiles = new Set([
  path.join(integrationsRoot, "components", "SecretInput.tsx"),
]);

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const passwordTypePattern = /type\s*=\s*(?:\{[^}]*["'`]password["'`][^}]*\}|["'`]password["'`])/g;

function collectSourceFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(entryPath, out);
      continue;
    }
    const ext = path.extname(entry.name);
    if (sourceExtensions.has(ext)) out.push(entryPath);
  }
  return out;
}

function lineNumberForIndex(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function lineAt(content, oneBasedLine) {
  const lines = content.split(/\r?\n/);
  return lines[Math.max(0, oneBasedLine - 1)] || "";
}

function main() {
  const files = collectSourceFiles(integrationsRoot);
  const violations = [];

  for (const filePath of files) {
    if (allowedPasswordInputFiles.has(filePath)) continue;

    const content = fs.readFileSync(filePath, "utf8");
    let match = passwordTypePattern.exec(content);
    while (match) {
      const line = lineNumberForIndex(content, match.index);
      violations.push({
        filePath,
        line,
        text: lineAt(content, line).trim(),
      });
      match = passwordTypePattern.exec(content);
    }
    passwordTypePattern.lastIndex = 0;
  }

  if (violations.length > 0) {
    console.error("FAIL hud integrations secret-input guard");
    console.error("Direct password inputs are not allowed in integrations.");
    console.error("Use hud/app/integrations/components/SecretInput.tsx for credential fields.");
    for (const violation of violations) {
      const rel = path.relative(process.cwd(), violation.filePath).replace(/\\/g, "/");
      console.error(`- ${rel}:${violation.line} :: ${violation.text}`);
    }
    process.exit(1);
  }

  console.log("PASS hud integrations secret-input guard");
}

main();
