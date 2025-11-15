require('dotenv').config();
const { fork } = require('child_process');
const pidusage = require('pidusage');
const path = require('path');

const CPU_THRESHOLD = process.env.CPU_THRESHOLD ? Number(process.env.CPU_THRESHOLD) : 70;
const POLL_INTERVAL = process.env.MONITOR_INTERVAL_MS ? Number(process.env.MONITOR_INTERVAL_MS) : 800;

let child = null;
let restarting = false;

// track number of active imports (supports concurrent uploads)
let activeImports = 0;

function startChild() {
  console.log('Starting server child...');
  child = fork(path.resolve(__dirname, 'server.js'), { env: process.env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

  // Pipe child's stdout/stderr so you see server logs in monitor terminal
  if (child.stdout) child.stdout.pipe(process.stdout);
  if (child.stderr) child.stderr.pipe(process.stderr);

  // Listen for messages from child
  child.on('message', (msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'IMPORT_STARTED') {
      activeImports += 1;
      console.log(`Monitor: IMPORT_STARTED - activeImports = ${activeImports}`, msg.jobId ? `jobId=${msg.jobId}` : '');
    } else if (msg.type === 'IMPORT_FINISHED') {
      // ensure not negative
      activeImports = Math.max(0, activeImports - 1);
      console.log(`Monitor: IMPORT_FINISHED - activeImports = ${activeImports}`, msg.jobId ? `jobId=${msg.jobId}` : '', msg.error ? ' (error)' : '');
    }
  });

  child.on('exit', (code, signal) => {
    console.log(`Child exited with code ${code} signal ${signal}`);
    child = null;
    // restart after small delay
    setTimeout(() => startChild(), 1000);
  });

  child.on('error', (err) => {
    console.error('Child process error:', err);
  });
}

function monitorLoop() {
  if (!child || !child.pid) {
    return setTimeout(monitorLoop, POLL_INTERVAL);
  }

  // if any import active, skip restarting (do not restart during imports)
  if (activeImports > 0) {
    return setTimeout(monitorLoop, POLL_INTERVAL);
  }

  pidusage(child.pid, (err, stats) => {
    if (err) return setTimeout(monitorLoop, POLL_INTERVAL);

    const cpu = stats.cpu; // percent (can be >100 on multi-core)
    if (!restarting && cpu > CPU_THRESHOLD) {
      console.warn(`⚠ CPU usage high (${cpu.toFixed(1)}%). Restarting server child...`);
      restarting = true;
      try {
        child.kill('SIGTERM');
      } catch (e) {
        console.error('Failed to kill child', e);
      }
      // reset restarting flag and ensure child is restarted
      setTimeout(() => { restarting = false; if (!child) startChild(); }, 3000);
    }

    setTimeout(monitorLoop, POLL_INTERVAL);
  });
}

// start
startChild();
monitorLoop();
