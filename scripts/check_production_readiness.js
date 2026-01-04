#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function readFile(p) {
  try { return fs.readFileSync(path.join(repoRoot, p), 'utf8'); } catch (e) { return null; }
}

function walk(dir, extensions = ['.js', '.json', '.html']) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (it.name === 'node_modules' || it.name === '.git') continue;
      files.push(...walk(full, extensions));
    } else {
      if (extensions.includes(path.extname(it.name))) files.push(full);
    }
  }
  return files;
}

function grep(pattern, files) {
  const matches = [];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    if (pattern.test(content)) matches.push({ file: f, excerpt: content.match(pattern)[0] });
  }
  return matches;
}

function safeExec(cmd) {
  try { return execSync(cmd, { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] }).toString(); }
  catch (e) { return null; }
}

// --- Checks ---
const findings = [];

// 1) package.json checks
const pkgRaw = readFile('package.json');
if (!pkgRaw) {
  findings.push({ level: 'error', message: 'No package.json found.' });
} else {
  const pkg = JSON.parse(pkgRaw);
  if (!pkg.scripts || !pkg.scripts.start) findings.push({ level: 'error', message: 'Missing "start" script in package.json.' });
  if (!pkg.scripts || !pkg.scripts.test) findings.push({ level: 'warn', message: 'No "test" script found. Add tests for production quality.' });
  if (!pkg.dependencies) findings.push({ level: 'error', message: 'No dependencies listed in package.json.' });
  if (!pkg.dependencies.helmet) findings.push({ level: 'warn', message: 'Dependency "helmet" is not listed. Consider adding it for security headers.' });
  if (!pkg.dependencies['express-rate-limit']) findings.push({ level: 'warn', message: 'No rate-limiting dependency detected (e.g., express-rate-limit).' });
  if (!pkg.dependencies.dotenv) findings.push({ level: 'info', message: 'dotenv not found; ensure you have a strategy to provide environment variables in production.' });
}

// 2) Search for hardcoded secrets and session MemoryStore usage
const filesToScan = walk(repoRoot, ['.js', '.json']);
const secretMatches = grep(/secret\s*:\s*['\"`][^'\"`]+['\"`]/gi, filesToScan).slice(0, 10);
if (secretMatches.length) {
  secretMatches.forEach(m => findings.push({ level: 'warn', message: `Hardcoded secret found in ${path.relative(repoRoot, m.file)}: ${m.excerpt.trim().slice(0,80)}...` }));
  findings.push({ level: 'info', message: 'Move session secrets and other secrets to environment variables (e.g. process.env.SESSION_SECRET).' });
}

// Check for session store configuration presence
const serverContent = readFile('server.js') || '';
if (/app\.use\(session\(/.test(serverContent)) {
  const sessionBlock = serverContent.slice(serverContent.indexOf('app.use(session('), serverContent.indexOf(')', serverContent.indexOf('app.use(session(')) + 1);
  if (!/store\s*:/i.test(sessionBlock)) {
    findings.push({ level: 'warn', message: 'express-session is used without specifying a persistent store (MemoryStore is not suitable for production).' });
  }
  if (!/cookie\s*:\s*\{[\s\S]*secure\s*:\s*true/.test(sessionBlock)) {
    findings.push({ level: 'warn', message: 'Session cookie does not set "secure: true". Set cookie.secure in production behind HTTPS.' });
  }
}

// 3) database initialization dangerous DROP TABLE
const dbContent = readFile('database.js') || '';
if (/DROP TABLE IF EXISTS/i.test(dbContent)) {
  findings.push({ level: 'warn', message: 'database.js contains DROP TABLE statements. Use migrations instead of dropping tables in production.' });
}

// 4) Console logging of sensitive tokens (password reset links etc.)
const resetLogs = grep(/reset link|password reset|PASSWORD RESET|Reset Link/i, filesToScan);
if (resetLogs.length) {
  resetLogs.forEach(r => findings.push({ level: 'warn', message: `Potential sensitive info logged in ${path.relative(repoRoot, r.file)}: ${r.excerpt.trim().slice(0,80)}...` }));
  findings.push({ level: 'info', message: 'Consider sending reset links via email service (SMTP, SendGrid, etc.) rather than logging them.' });
}

// 5) Check presence of environment variable usage
if (!/process\.env\.|process\.env\.NODE_ENV/.test(serverContent) && !/dotenv/.test(pkgRaw || '')) {
  findings.push({ level: 'warn', message: 'No environment variable usage detected. Ensure configuration is provided via env vars in production.' });
}

// 6) Check for raw SQL string concatenation or template literal interpolation into db.* calls
const sqlTemplateMatches = grep(/db\.(run|get|all)\s*\(\s*`[^`]*\${/g, filesToScan);
const sqlConcatMatches = grep(/db\.(run|get|all)\s*\(\s*['"][^'"]*\+[^\)]*\)/g, filesToScan);
if (sqlTemplateMatches.length || sqlConcatMatches.length) {
  [...sqlTemplateMatches, ...sqlConcatMatches].forEach(m => findings.push({ level: 'warn', message: `Potential unsafe SQL usage in ${path.relative(repoRoot, m.file)}. Use parameterized queries instead of string interpolation/concatenation.` }));
}

// 7) Check for git clean working tree
const gitStatus = safeExec('git status --porcelain');
if (gitStatus && gitStatus.trim().length > 0) findings.push({ level: 'info', message: 'You have uncommitted changes; consider committing before releasing.' });

// 8) Check for CI workflow
if (!fs.existsSync(path.join(repoRoot, '.github', 'workflows'))) {
  findings.push({ level: 'warn', message: 'No GitHub Actions workflows found. Add CI to run tests/lint on PRs.' });
}

// 9) Run npm audit optionally if user passed --audit flag
const args = process.argv.slice(2);
let auditResult = null;
if (args.includes('--audit')) {
  findings.push({ level: 'info', message: 'Running "npm audit --json" (this may take a moment)...' });
  const auditJson = safeExec('npm audit --json');
  if (auditJson) {
    try {
      const audit = JSON.parse(auditJson);
      if (audit.metadata && audit.metadata.vulnerabilities && Object.values(audit.metadata.vulnerabilities).some(n => n > 0)) {
        findings.push({ level: 'warn', message: 'npm audit found vulnerabilities. Run "npm audit" and fix or add a remediation plan.' });
        auditResult = audit;
      } else {
        findings.push({ level: 'info', message: 'No vulnerabilities found by npm audit.' });
      }
    } catch (e) {
      findings.push({ level: 'warn', message: 'Failed to parse npm audit output.' });
    }
  } else {
    findings.push({ level: 'warn', message: 'npm audit failed or is not available.' });
  }
}

// Final print
console.log('\n=== Production Readiness Report ===\n');
if (findings.length === 0) console.log('No issues found.');
else {
  const byLevel = { error: [], warn: [], info: [] };
  findings.forEach(f => {
    byLevel[f.level] = byLevel[f.level] || [];
    byLevel[f.level].push(f.message);
  });

  if (byLevel.error.length) {
    console.log('Errors:');
    byLevel.error.forEach(m => console.log('  -', m));
    console.log('');
  }
  if (byLevel.warn.length) {
    console.log('Warnings:');
    byLevel.warn.forEach(m => console.log('  -', m));
    console.log('');
  }
  if (byLevel.info.length) {
    console.log('Info:');
    byLevel.info.forEach(m => console.log('  -', m));
    console.log('');
  }
}

if (auditResult) {
  fs.writeFileSync(path.join(repoRoot, 'npm-audit-result.json'), JSON.stringify(auditResult, null, 2));
  console.log('Saved npm audit result to npm-audit-result.json');
}

// Exit code: 0 if only info, 1 if any warn or error
const hasWarnOrErr = findings.some(f => f.level === 'warn' || f.level === 'error');
process.exit(hasWarnOrErr ? 1 : 0);
