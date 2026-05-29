#!/usr/bin/env node
/**
 * Claude Code Source Explorer — Server
 * Zero dependencies. Uses only Node.js built-ins.
 * 
 * Usage: node server.js [port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '3000', 10);
const SRC_DIR = path.resolve(__dirname, '..', 'claude-code', 'src');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Mime types ──
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ── File tree builder ──
function buildTree(dir, prefix = '') {
  const entries = [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    // Sort: dirs first, then files, both alphabetically
    items.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const item of items) {
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;
      const relPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        entries.push({
          name: item.name,
          path: relPath,
          type: 'dir',
          children: buildTree(path.join(dir, item.name), relPath),
        });
      } else {
        const ext = path.extname(item.name);
        if (['.ts', '.tsx', '.js', '.jsx', '.json', '.md'].includes(ext)) {
          entries.push({
            name: item.name,
            path: relPath,
            type: 'file',
            ext,
            size: fs.statSync(path.join(dir, item.name)).size,
          });
        }
      }
    }
  } catch (e) { /* skip unreadable dirs */ }
  return entries;
}

// ── Stats ──
let cachedStats = null;
function getStats() {
  if (cachedStats) return cachedStats;
  let totalFiles = 0, totalLines = 0, totalSize = 0;
  const extCounts = {};
  const dirCounts = {};

  function walk(dir, topDir) {
    try {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.name.startsWith('.')) continue;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          if (!topDir) dirCounts[item.name] = 0;
          walk(full, topDir || item.name);
        } else {
          const ext = path.extname(item.name);
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            const stat = fs.statSync(full);
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n').length;
            totalFiles++;
            totalLines += lines;
            totalSize += stat.size;
            extCounts[ext] = (extCounts[ext] || 0) + 1;
            if (topDir) dirCounts[topDir] = (dirCounts[topDir] || 0) + 1;
          }
        }
      }
    } catch (e) { /* skip */ }
  }
  walk(SRC_DIR, null);

  cachedStats = { totalFiles, totalLines, totalSize, extCounts, dirCounts };
  return cachedStats;
}

// ── Search ──
function searchFiles(query, limit = 200) {
  const results = [];
  const q = query.toLowerCase();
  function walk(dir) {
    try {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.name.startsWith('.')) continue;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          walk(full);
        } else if (['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(item.name))) {
          const content = fs.readFileSync(full, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              results.push({
                path: path.relative(SRC_DIR, full),
                line: i + 1,
                text: lines[i].trim().substring(0, 200),
              });
              if (results.length >= limit) return;
            }
          }
        }
      }
    } catch (e) { /* skip */ }
  }
  walk(SRC_DIR);
  return results;
}

// ── Dependency scanner ──
let cachedDeps = null;
function getDeps() {
  if (cachedDeps) return cachedDeps;
  const imports = {};
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

  function walk(dir) {
    try {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.name.startsWith('.')) continue;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) { walk(full); continue; }
        if (!['.ts', '.tsx'].includes(path.extname(item.name))) continue;
        const content = fs.readFileSync(full, 'utf8');
        let m;
        const fileImports = new Set();
        while ((m = importRegex.exec(content)) !== null) fileImports.add(m[1]);
        while ((m = requireRegex.exec(content)) !== null) fileImports.add(m[1]);
        for (const imp of fileImports) {
          if (!imp.startsWith('.') && !imp.startsWith('src/')) {
            const pkg = imp.startsWith('@') ? imp.split('/').slice(0, 2).join('/') : imp.split('/')[0];
            imports[pkg] = (imports[pkg] || 0) + 1;
          }
        }
      }
    } catch (e) { /* skip */ }
  }
  walk(SRC_DIR);

  // Sort by frequency
  cachedDeps = Object.entries(imports)
    .sort((a, b) => b[1] - a[1])
    .map(([pkg, count]) => ({ pkg, count }));
  return cachedDeps;
}

// ── File content reader ──
function readFile(relPath) {
  const full = path.join(SRC_DIR, relPath);
  // Security: prevent directory traversal
  if (!full.startsWith(SRC_DIR)) return null;
  try {
    return fs.readFileSync(full, 'utf8');
  } catch (e) {
    return null;
  }
}

// ── Architecture data ──
function getArchitecture() {
  return {
    overview: `Claude Code is Anthropic's CLI tool built with React + Ink (terminal UI).
It uses Bun runtime, TypeScript, and ~75 external packages.
The codebase has ~1,900 files and 512,000+ lines of code.`,
    layers: [
      {
        name: 'Entry',
        files: ['main.tsx', 'replLauncher.tsx', 'interactiveHelpers.tsx', 'setup.ts', 'ink.ts'],
        desc: 'CLI parsing (Commander.js), init sequence, Ink renderer setup',
      },
      {
        name: 'Screens',
        files: ['screens/REPL.tsx', 'screens/Doctor.tsx', 'screens/ResumeConversation.tsx'],
        desc: 'Full-screen UI views',
      },
      {
        name: 'Components',
        files: ['components/App.tsx', 'components/Messages.tsx', 'components/TextInput.tsx', 'components/StatusLine.tsx'],
        desc: '~144 Ink/React UI components',
      },
      {
        name: 'Commands',
        files: ['commands.ts', 'commands/'],
        desc: '~50 slash commands (/commit, /review, /compact, etc.)',
      },
      {
        name: 'Tools',
        files: ['tools.ts', 'Tool.ts', 'tools/'],
        desc: '~40 agent tools (Bash, FileRead, Grep, Agent, etc.)',
      },
      {
        name: 'Query Engine',
        files: ['QueryEngine.ts', 'query.ts', 'query/'],
        desc: 'LLM API calls, streaming, tool-call loops, token counting',
      },
      {
        name: 'Services',
        files: ['services/'],
        desc: 'API client, MCP, OAuth, LSP, analytics, plugins',
      },
      {
        name: 'State',
        files: ['state/', 'context/', 'bootstrap/'],
        desc: 'AppState store, context collection, bootstrap state',
      },
      {
        name: 'Utils',
        files: ['utils/'],
        desc: '~200+ utility modules (git, model, permissions, etc.)',
      },
      {
        name: 'Bridge',
        files: ['bridge/'],
        desc: 'IDE integration (VS Code, JetBrains)',
      },
      {
        name: 'Ink Fork',
        files: ['ink/'],
        desc: 'Custom fork of Ink terminal renderer (~48 files)',
      },
    ],
    techStack: [
      { category: 'Runtime', tech: 'Bun' },
      { category: 'Language', tech: 'TypeScript (strict)' },
      { category: 'Terminal UI', tech: 'React + Ink' },
      { category: 'CLI Parsing', tech: 'Commander.js' },
      { category: 'Schema', tech: 'Zod v4' },
      { category: 'API', tech: 'Anthropic SDK' },
      { category: 'Protocols', tech: 'MCP, LSP' },
      { category: 'Telemetry', tech: 'OpenTelemetry + gRPC' },
      { category: 'Feature Flags', tech: 'GrowthBook' },
      { category: 'Auth', tech: 'OAuth 2.0, JWT' },
    ],
  };
}

// ── HTTP handler ──
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // API routes
  if (pathname === '/api/tree') {
    const tree = buildTree(SRC_DIR);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tree));
    return;
  }

  if (pathname === '/api/file') {
    const filePath = parsedUrl.searchParams.get('path');
    if (!filePath) { res.writeHead(400); res.end('Missing path'); return; }
    const content = readFile(filePath);
    if (content === null) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content, lines: content.split('\n').length }));
    return;
  }

  if (pathname === '/api/search') {
    const q = parsedUrl.searchParams.get('q');
    if (!q) { res.writeHead(400); res.end('Missing query'); return; }
    const results = searchFiles(q);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results));
    return;
  }

  if (pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getStats()));
    return;
  }

  if (pathname === '/api/deps') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getDeps()));
    return;
  }

  if (pathname === '/api/architecture') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getArchitecture()));
    return;
  }

  // Static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }

  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  \x1b[36m╔══════════════════════════════════════════╗\x1b[0m`);
  console.log(`  \x1b[36m║\x1b[0m  \x1b[1mClaude Code Source Explorer\x1b[0m              \x1b[36m║\x1b[0m`);
  console.log(`  \x1b[36m╠══════════════════════════════════════════╣\x1b[0m`);
  console.log(`  \x1b[36m║\x1b[0m  🚀  \x1b[4mhttp://localhost:${PORT}\x1b[0m              \x1b[36m║\x1b[0m`);
  console.log(`  \x1b[36m║\x1b[0m  📁  Source: ${SRC_DIR.substring(0, 28).padEnd(28)} \x1b[36m║\x1b[0m`);
  console.log(`  \x1b[36m╚══════════════════════════════════════════╝\x1b[0m\n`);
});
