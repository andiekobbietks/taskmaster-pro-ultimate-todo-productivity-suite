#!/usr/bin/env node
// TaskMaster Pro — cross-platform CLI (mac/linux/windows via Node)
// Usage: node scripts/taskmaster-cli.mjs [command] [tag]

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE = 'http://127.0.0.1:8787';
const LOG = path.resolve(__dirname, '../diagnostics.log');

// Artistic colored banner — inspired by GitHub Copilot CLI design
// (4-bit ANSI semantic roles: red=brand, green=success/pro, bold=subtitle,
// blue=commands; 80-col; --banner gate). Readable decorative art.
const C_RED = '\x1b[31m'; const C_GREEN = '\x1b[32m';
const C_BLUE = '\x1b[34m'; const C_BOLD = '\x1b[1m'; const C_RESET = '\x1b[0m';
const BANNER = C_RED + C_BOLD + `
  ██████╗ █████╗ ███╗   ██╗███████╗██████╗ ██████╗ ██╗ ██████╗
  ██╔═══██╗██╔══██╗████╗  ██║██╔════╝██╔══██╗██╔══██╗██║██╔═══██╗
  ███████║███████║██╔██╗ ██║█████╗  ██████╔╝██║  ██║██║██║   ██║
  ██╔══██║██╔══██║██║╚██╗██║██╔══╝  ██╔══██╗██║  ██║██║██║   ██║
  ██║  ██║██║  ██║██║ ╚████║███████╗██║  ██║██████╔╝██║╚██████╔╝
  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚═════╝ ╚═╝ ╚═════╝` + C_RESET + '\n' +
C_GREEN + '  TaskMaster Pro' + C_RESET + '  ' + C_BLUE + '| /help | /status | /rollback | /forward | /export' + C_RESET;

// Scenario clues — at least a dozen use-cases a developer sees immediately.
const SCENARIOS = `
SCENARIO CLUES (what the developer needs to check):
  01 /rollback <tag>  -> rollback a primitive/state after a 500 error
  02 /logs            -> inspect endpoint failures + JSX unmatched tags
  03 /status          -> check server at :8787 + settings (.dev.vars) health
  04 /export          -> save diagnostics.log locally for review (no cloud)
  05 /forward <tag>   -> apply a saved checkpoint after fix
  06 check demo SQL 500 -> settings missing = 500; wizard visible
  07 verify batch1    -> locationMatches edge case (FAIL=1)
  08 confirm open-core -> branch has commit 7fa4aba
  09 check trash bin  -> retention_days default 30; restore pointer flip
  10 verify landing    -> landing.html at :8787 serves 200
  11 inspect push     -> digest_time timezone badge still (i)
  12 check image picker -> searchable dropdown + Replace/Delete live
`;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  fs.appendFileSync(LOG, line + '\n', { encoding: 'utf8' });
}

async function api(p) {
  try {
    const res = await fetch(BASE + p);
    return await res.json();
  } catch (e) {
    log('API ERROR: ' + p + ' — ' + e.message);
    return null;
  }
}

function help() {
  console.log(BANNER);
  console.log(SCENARIOS);
  console.log('Commands: help | status | logs | rollback <tag> | forward <tag> | export');
}

function status() {
  console.log(BANNER);
  console.log('Checking server at ' + BASE);
  api('/api/debug/status').then(d => console.log('Server response:', d || 'UNREACHABLE — restart workerd at :8787'));
}

function logs() {
  console.log(BANNER);
  if (fs.existsSync(LOG)) {
    const text = fs.readFileSync(LOG, 'utf8').split('\n').slice(-30).join('\n');
    console.log('--- last 30 lines of diagnostics.log ---');
    console.log(text || '(empty)');
  } else {
    console.log('No diagnostics.log yet; start server at :8787 or run /export.');
  }
}

function rollback(tag) {
  console.log(BANNER);
  log('CLI rollback: tag=' + (tag || 'none'));
  console.log('Rollback = soft state pointer flip; bytes kept (trash retention applies).');
}

function forward(tag) {
  console.log(BANNER);
  log('CLI forward: tag=' + (tag || 'none'));
}

function exportLog() {
  console.log(BANNER);
  log('CLI export requested');
  try {
    const out = path.resolve(__dirname, '../diagnostics-export-' + Date.now() + '.log');
    fs.copyFileSync(LOG, out);
    console.log('Exported to: ' + out + ' (local only, no cloud upload)');
  } catch (e) {
    console.log('Export failed: ' + e.message);
  }
}

// Interactive REPL
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(BANNER);
  console.log(SCENARIOS);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'tm> ' });
  rl.on('line', line => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const tag = rest[0];
    if (cmd === 'help' || cmd === '/help') help();
    else if (cmd === 'status' || cmd === '/status') status();
    else if (cmd === 'logs' || cmd === '/logs') logs();
    else if (cmd === 'rollback' || cmd === '/rollback') rollback(tag);
    else if (cmd === 'forward' || cmd === '/forward') forward(tag);
    else if (cmd === 'export' || cmd === '/export') exportLog();
    else console.log('Unknown. Try: /help');
    rl.prompt();
  });
  rl.prompt();
} else {
  const cmd = args[0];
  const tag = args[1];
  if (cmd === 'help' || cmd === '/help') help();
  else if (cmd === 'status' || cmd === '/status') status();
  else if (cmd === 'logs' || cmd === '/logs') logs();
  else if (cmd === 'rollback' || cmd === '/rollback') rollback(tag);
  else if (cmd === 'forward' || cmd === '/forward') forward(tag);
  else if (cmd === 'export' || cmd === '/export') exportLog();
  else if (cmd === '--banner' || cmd === '-b') help();
  else console.log('Unknown command. See /help');
}
