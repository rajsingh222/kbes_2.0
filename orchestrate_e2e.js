const { spawn, exec } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Health check function
function healthCheck() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/health',
      method: 'GET',
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      log(`[HEALTH CHECK] Status: ${res.statusCode}`, res.statusCode === 200 ? 'green' : 'red');
      resolve(res.statusCode === 200);
    });

    req.on('error', (error) => {
      log(`[HEALTH CHECK] Failed: ${error.message}`, 'red');
      resolve(false);
    });

    req.on('timeout', () => {
      log('[HEALTH CHECK] Timeout', 'red');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// Sleep helper
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main orchestration
async function runOrchestration() {
  log('='.repeat(80), 'cyan');
  log('E2E TEST ORCHESTRATION STARTED', 'cyan');
  log('='.repeat(80), 'cyan');

  let serverProcess = null;
  let testProcess = null;

  try {
    // Step 1: Start server
    log('\n[1/5] Starting Node.js backend server...', 'blue');
    serverProcess = spawn('node', ['server.js'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let serverOutput = '';
    serverProcess.stdout.on('data', (data) => {
      serverOutput += data.toString();
      log(`[SERVER] ${data.toString().trim()}`, 'yellow');
    });

    serverProcess.stderr.on('data', (data) => {
      serverOutput += data.toString();
      log(`[SERVER ERROR] ${data.toString().trim()}`, 'red');
    });

    log(`[SERVER] Process started with PID: ${serverProcess.pid}`, 'green');

    // Step 2: Wait for initialization
    log('\n[2/5] Waiting 10 seconds for server initialization...', 'blue');
    await sleep(10000);

    // Step 3: Health check
    log('\n[3/5] Running health check...', 'blue');
    let healthCheckAttempts = 0;
    let isHealthy = false;

    while (healthCheckAttempts < 5 && !isHealthy) {
      isHealthy = await healthCheck();
      if (!isHealthy && healthCheckAttempts < 4) {
        log(`[HEALTH CHECK] Retry ${healthCheckAttempts + 1}/4 after 2 seconds...`, 'yellow');
        await sleep(2000);
      }
      healthCheckAttempts++;
    }

    if (!isHealthy) {
      log('\n[ERROR] Server health check failed. Cannot proceed with E2E tests.', 'red');
      process.exit(1);
    }

    log('[SUCCESS] Server is healthy and ready!', 'green');

    // Step 4: Run E2E tests
    log('\n[4/5] Running E2E test runner (e2e_test_runner.js)...', 'blue');
    log('='.repeat(80), 'cyan');

    let testOutput = '';
    let testExitCode = null;

    await new Promise((resolve) => {
      testProcess = spawn('node', ['e2e_test_runner.js'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      testProcess.stdout.on('data', (data) => {
        const output = data.toString();
        testOutput += output;
        process.stdout.write(output); // Write directly to maintain formatting
      });

      testProcess.stderr.on('data', (data) => {
        const output = data.toString();
        testOutput += output;
        process.stderr.write(output); // Write directly to maintain formatting
      });

      testProcess.on('close', (code) => {
        testExitCode = code;
        resolve();
      });

      testProcess.on('error', (error) => {
        log(`\n[TEST RUNNER ERROR] ${error.message}`, 'red');
        testOutput += `\n[TEST RUNNER ERROR] ${error.message}`;
        resolve();
      });

      // Set a timeout of 120 seconds for the test runner
      const testTimeout = setTimeout(() => {
        log('\n[WARNING] Test runner timeout (120s). Terminating test process.', 'yellow');
        if (testProcess && !testProcess.killed) {
          testProcess.kill('SIGTERM');
        }
      }, 120000);

      testProcess.on('close', () => {
        clearTimeout(testTimeout);
      });
    });

    log('='.repeat(80), 'cyan');
    log('\n[5/5] Test execution completed', 'blue');

    // Display final results
    log('\n' + '='.repeat(80), 'cyan');
    log('E2E TEST ORCHESTRATION RESULTS', 'cyan');
    log('='.repeat(80), 'cyan');

    if (testExitCode === 0 || testExitCode === null) {
      log('[SUCCESS] E2E tests completed successfully!', 'green');
    } else {
      log(`[WARNING] Test runner exited with code: ${testExitCode}`, 'yellow');
    }

    log('\n--- CAPTURED TEST OUTPUT ---', 'cyan');
    if (testOutput) {
      console.log(testOutput);
    } else {
      log('No test output captured', 'yellow');
    }
    log('--- END TEST OUTPUT ---\n', 'cyan');

    // Save test output to file
    const outputFile = path.join(process.cwd(), 'e2e_test_output.log');
    fs.writeFileSync(outputFile, testOutput);
    log(`[INFO] Test output saved to: ${outputFile}`, 'blue');

  } catch (error) {
    log(`\n[FATAL ERROR] ${error.message}`, 'red');
    log(error.stack, 'red');
  } finally {
    // Step 6: Terminate server
    log('\n[CLEANUP] Terminating server process...', 'blue');

    if (serverProcess && !serverProcess.killed) {
      log(`[CLEANUP] Killing server process (PID: ${serverProcess.pid})`, 'yellow');
      serverProcess.kill('SIGTERM');

      // Wait a bit and force kill if necessary
      await sleep(2000);
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
        log('[CLEANUP] Force killed server process', 'yellow');
      }
    }

    if (testProcess && !testProcess.killed) {
      log(`[CLEANUP] Killing test process (PID: ${testProcess.pid})`, 'yellow');
      testProcess.kill('SIGTERM');
    }

    log('\n' + '='.repeat(80), 'cyan');
    log('ORCHESTRATION COMPLETE', 'cyan');
    log('='.repeat(80), 'cyan');
    process.exit(0);
  }
}

// Run orchestration
runOrchestration().catch((error) => {
  log(`\n[FATAL ERROR] Unhandled error: ${error.message}`, 'red');
  log(error.stack, 'red');
  process.exit(1);
});
