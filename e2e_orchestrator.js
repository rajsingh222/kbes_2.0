#!/usr/bin/env node
/**
 * E2E Test Orchestrator - Complete with Server Lifecycle Management
 * Executes: Start Server → Health Check → Run E2E Tests → Terminate Server
 * Captures ALL test output
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let SERVER_PROCESS = null;

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function log(msg, prefix = '→') {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${prefix} ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: START SERVER
// ─────────────────────────────────────────────────────────────────────────────

async function startServer() {
  return new Promise((resolve, reject) => {
    log('Starting backend server (node server.js)', '▶️');
    
    SERVER_PROCESS = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let startupOutput = '';

    SERVER_PROCESS.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        log(`[SERVER OUT] ${msg}`, '📤');
        startupOutput += msg + '\n';
      }
    });

    SERVER_PROCESS.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        log(`[SERVER ERR] ${msg}`, '⚠️');
        startupOutput += msg + '\n';
      }
    });

    SERVER_PROCESS.on('error', (err) => {
      log(`Failed to start server: ${err.message}`, '❌');
      reject(err);
    });

    SERVER_PROCESS.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        log(`Server exited with code ${code}`, '⚠️');
      }
    });

    // Resolve after spawn succeeds
    log(`Server process spawned (PID: ${SERVER_PROCESS.pid})`, '✅');
    resolve();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: WAIT FOR INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

async function waitForInitialization() {
  log('Waiting 10 seconds for server initialization...', '⏳');
  await sleep(10000);
  log('Initialization wait complete', '✅');
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────

function healthCheck() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/health',
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function performHealthCheck() {
  log('Performing health checks on http://localhost:5000/api/health', '🏥');
  
  for (let attempt = 1; attempt <= 10; attempt++) {
    const healthy = await healthCheck();
    if (healthy) {
      log('Server health check PASSED', '✅');
      return true;
    }
    
    if (attempt < 10) {
      log(`Health check attempt ${attempt}/10 failed, retrying in 2s...`, '⏳');
      await sleep(2000);
    }
  }
  
  log('Server health check FAILED after 10 attempts', '❌');
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: RUN E2E TESTS
// ─────────────────────────────────────────────────────────────────────────────

async function runE2ETests() {
  return new Promise((resolve) => {
    log('Starting E2E test runner (e2e_test_runner.js)', '🧪');
    log('='.repeat(100), '');
    
    const testProcess = spawn('node', ['e2e_test_runner.js'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let testOutput = '';
    let testExitCode = null;
    let testTimedOut = false;

    // Capture stdout
    testProcess.stdout.on('data', (data) => {
      const output = data.toString();
      testOutput += output;
      process.stdout.write(output); // Write directly to preserve formatting
    });

    // Capture stderr
    testProcess.stderr.on('data', (data) => {
      const output = data.toString();
      testOutput += output;
      process.stderr.write(output);
    });

    // Handle process close
    testProcess.on('close', (code) => {
      testExitCode = code;
      log('='.repeat(100), '');
      
      if (testTimedOut) {
        log('Test runner terminated due to timeout', '⚠️');
      } else if (code === 0) {
        log(`Test runner completed successfully (exit code: ${code})`, '✅');
      } else if (code === null) {
        log('Test runner was terminated', '⚠️');
      } else {
        log(`Test runner exited with code: ${code}`, '⚠️');
      }
      
      resolve({ code: testExitCode, output: testOutput, timedOut: testTimedOut });
    });

    // Handle errors
    testProcess.on('error', (err) => {
      log(`Test runner error: ${err.message}`, '❌');
      testOutput += `\n[ERROR] ${err.message}`;
      resolve({ code: 1, output: testOutput, timedOut: false });
    });

    // Set 120-second timeout
    const timeout = setTimeout(() => {
      testTimedOut = true;
      log('Test runner timeout (120s) - terminating process', '⏰');
      testProcess.kill('SIGTERM');
      
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!testProcess.killed) {
          testProcess.kill('SIGKILL');
        }
      }, 5000);
    }, 120000);

    // Clear timeout if test completes before 120s
    testProcess.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: SAVE TEST OUTPUT
// ─────────────────────────────────────────────────────────────────────────────

function saveTestOutput(output) {
  try {
    const outputFile = path.join(__dirname, 'e2e_test_output.log');
    fs.writeFileSync(outputFile, output, 'utf8');
    log(`Test output saved to: ${outputFile}`, '💾');
    return true;
  } catch (err) {
    log(`Failed to save test output: ${err.message}`, '❌');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6: TERMINATE SERVER
// ─────────────────────────────────────────────────────────────────────────────

async function terminateServer() {
  if (!SERVER_PROCESS || SERVER_PROCESS.killed) {
    log('Server process already terminated', '✅');
    return;
  }

  log(`Terminating server process (PID: ${SERVER_PROCESS.pid})`, '🛑');
  
  return new Promise((resolve) => {
    // Set a timeout to force kill if needed
    const forceKillTimeout = setTimeout(() => {
      if (!SERVER_PROCESS.killed) {
        log('Force killing server process (SIGKILL)', '⚠️');
        SERVER_PROCESS.kill('SIGKILL');
      }
      resolve();
    }, 5000);

    SERVER_PROCESS.on('exit', () => {
      clearTimeout(forceKillTimeout);
      log('Server process terminated', '✅');
      resolve();
    });

    // Send SIGTERM
    SERVER_PROCESS.kill('SIGTERM');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATION
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '='.repeat(100));
  console.log('E2E TEST ORCHESTRATION');
  console.log('='.repeat(100) + '\n');

  let testResults = null;

  try {
    // Step 1: Start server
    console.log('STEP 1: Starting Backend Server');
    console.log('-'.repeat(100));
    await startServer();

    // Step 2: Wait for initialization
    console.log('\nSTEP 2: Waiting for Initialization');
    console.log('-'.repeat(100));
    await waitForInitialization();

    // Step 3: Health check
    console.log('\nSTEP 3: Performing Health Check');
    console.log('-'.repeat(100));
    const healthy = await performHealthCheck();
    
    if (!healthy) {
      throw new Error('Server failed health check - cannot proceed with tests');
    }

    // Step 4: Run tests
    console.log('\nSTEP 4: Running E2E Tests');
    console.log('-'.repeat(100));
    testResults = await runE2ETests();

    // Step 5: Save output
    console.log('\nSTEP 5: Saving Test Output');
    console.log('-'.repeat(100));
    if (testResults && testResults.output) {
      saveTestOutput(testResults.output);
    }

  } catch (error) {
    log(`FATAL ERROR: ${error.message}`, '❌');
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Step 6: Cleanup
    console.log('\nSTEP 6: Cleanup - Terminating Server');
    console.log('-'.repeat(100));
    await terminateServer();

    // Summary
    console.log('\n' + '='.repeat(100));
    console.log('ORCHESTRATION COMPLETE');
    console.log('='.repeat(100));
    
    if (testResults) {
      const status = testResults.timedOut ? 'TIMEOUT' : 
                    (testResults.code === 0 ? 'PASSED' : 'FAILED');
      console.log(`\nTest Status: ${status}`);
      if (testResults.code !== null) {
        console.log(`Exit Code: ${testResults.code}`);
      }
    }
    
    console.log('\n');
    process.exit(testResults?.code || 0);
  }
}

// Handle process termination signals
process.on('SIGINT', async () => {
  log('Received SIGINT - shutting down', '⚠️');
  await terminateServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('Received SIGTERM - shutting down', '⚠️');
  await terminateServer();
  process.exit(0);
});

// Run main
main().catch((err) => {
  log(`Unhandled error: ${err.message}`, '❌');
  console.error(err.stack);
  process.exit(1);
});
