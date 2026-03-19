#!/usr/bin/env node
/**
 * CRITICAL DIRECT TEST EXECUTION
 * This script runs with NO async execution issues - direct synchronous/promise-based approach
 * Suitable for manual execution or CI/CD pipelines
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

console.log('\n' + '═'.repeat(100));
console.log('OSHAS BACKEND - E2E TEST EXECUTION');
console.log('═'.repeat(100) + '\n');

const LOG_FILE = path.join(__dirname, 'e2e_test_output.log');
let logBuffer = '';

function writeLog(msg) {
  console.log(msg);
  logBuffer += msg + '\n';
}

function saveLog() {
  try {
    fs.writeFileSync(LOG_FILE, logBuffer, 'utf8');
    writeLog(`\n📄 Log saved to: ${LOG_FILE}`);
  } catch (err) {
    console.error('Failed to save log:', err.message);
  }
}

// Wait function
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Health check
const healthCheck = async (maxRetries = 10) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 5000,
          path: '/api/health',
          method: 'GET',
          timeout: 5000
        }, (res) => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            if (res.statusCode === 200) {
              writeLog(`✅ Server health check PASSED (Status: ${res.statusCode})`);
              resolve();
            } else {
              reject(new Error(`Status ${res.statusCode}`));
            }
          });
        });
        req.on('error', reject);
        req.end();
      });
      return true;
    } catch (err) {
      writeLog(`⚠️  Health check attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries) {
        await wait(2000);
      }
    }
  }
  return false;
};

// Main execution
(async () => {
  let serverProcess = null;
  
  try {
    // STEP 1: Start server
    writeLog('STEP 1: Starting Backend Server');
    writeLog('─'.repeat(100));
    
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    writeLog(`✅ Server process started (PID: ${serverProcess.pid})`);

    let serverStarted = false;
    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        writeLog(`  [SERVER] ${msg}`);
        if (msg.includes('running on port') || msg.includes('listening')) {
          serverStarted = true;
        }
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        writeLog(`  [SERVER ERROR] ${msg}`);
      }
    });

    // STEP 2: Wait for initialization
    writeLog('\nSTEP 2: Waiting for Server Initialization');
    writeLog('─'.repeat(100));
    writeLog('⏳ Waiting 10 seconds for server to initialize...');
    await wait(10000);
    writeLog('✅ Initialization complete');

    // STEP 3: Health check
    writeLog('\nSTEP 3: Health Check');
    writeLog('─'.repeat(100));
    const isHealthy = await healthCheck();

    if (!isHealthy) {
      writeLog('\n❌ Server failed health check - tests may fail');
    }

    // STEP 4: Run E2E tests
    writeLog('\nSTEP 4: Running E2E Tests');
    writeLog('─'.repeat(100));
    writeLog('🧪 Starting e2e_test_runner.js\n');

    await new Promise((resolve) => {
      const testProcess = spawn('node', ['e2e_test_runner.js'], {
        cwd: __dirname,
        stdio: ['ignore', 'inherit', 'inherit']  // Inherit stdio for direct output
      });

      // Timeout protection
      const timeout = setTimeout(() => {
        writeLog('\n⚠️  Test timeout (120 seconds) - terminating test process');
        testProcess.kill('SIGKILL');
        resolve();
      }, 120000);

      testProcess.on('close', (code) => {
        clearTimeout(timeout);
        writeLog(`\n✅ E2E test runner completed (exit code: ${code})`);
        resolve();
      });

      testProcess.on('error', (err) => {
        clearTimeout(timeout);
        writeLog(`\n❌ Test process error: ${err.message}`);
        resolve();
      });
    });

    // STEP 5: Save log
    writeLog('\nSTEP 5: Saving Log');
    writeLog('─'.repeat(100));
    saveLog();

  } catch (err) {
    writeLog(`\n❌ Orchestration error: ${err.message}`);
    saveLog();
  } finally {
    // STEP 6: Terminate server
    writeLog('\nSTEP 6: Cleanup - Terminating Server');
    writeLog('─'.repeat(100));
    
    if (serverProcess) {
      writeLog(`🛑 Terminating server process (PID: ${serverProcess.pid})`);
      serverProcess.kill('SIGTERM');
      
      // Force kill after 5 seconds if needed
      const killTimeout = setTimeout(() => {
        try {
          process.kill(serverProcess.pid, 'SIGKILL');
        } catch (e) {}
      }, 5000);

      // Wait for process to exit
      await new Promise(r => {
        serverProcess.on('exit', () => {
          clearTimeout(killTimeout);
          r();
        });
      });

      writeLog('✅ Server process terminated');
    }

    // Also clean up any lingering node processes
    try {
      execSync('taskkill /IM node.exe /F 2>nul', { stdio: 'ignore' });
    } catch (e) {}

    writeLog('\n' + '═'.repeat(100));
    writeLog('ORCHESTRATION COMPLETE');
    writeLog('═'.repeat(100) + '\n');

    process.exit(0);
  }
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
