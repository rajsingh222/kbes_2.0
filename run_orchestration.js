#!/usr/bin/env node
/**
 * Direct E2E Test Orchestrator
 * Simplified approach to start server and run tests with full output capture
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Wait helper
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Health check
const healthCheck = async (maxAttempts = 10) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get('http://localhost:5000/api/health', (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Status ${res.statusCode}`));
          }
          res.resume();
        });
        req.on('error', reject);
        req.setTimeout(5000);
      });
      console.log('✓ Server is healthy');
      return true;
    } catch (e) {
      if (i < maxAttempts - 1) {
        console.log(`Health check attempt ${i + 1}/${maxAttempts} failed, retrying...`);
        await wait(1000);
      }
    }
  }
  return false;
};

const main = async () => {
  console.log('\n' + '='.repeat(100));
  console.log('E2E TEST ORCHESTRATION');
  console.log('='.repeat(100) + '\n');

  let server = null;

  try {
    // Start server
    console.log('[1] Starting backend server (node server.js)...');
    server = spawn('node', ['server.js'], {
      stdio: 'inherit',
      cwd: __dirname
    });

    server.on('error', (err) => {
      console.error('Server error:', err);
    });

    // Wait for initialization
    console.log('[2] Waiting 10 seconds for server initialization...');
    await wait(10000);

    // Health check
    console.log('[3] Running health check at http://localhost:5000/api/health...');
    const healthy = await healthCheck();
    
    if (!healthy) {
      console.error('\n✗ Server health check failed!');
      throw new Error('Server failed health check');
    }

    // Run tests
    console.log('\n[4] Starting E2E test runner...\n');
    console.log('='.repeat(100));
    
    const testResult = await new Promise((resolve) => {
      const test = spawn('node', ['e2e_test_runner.js'], {
        stdio: 'inherit',
        cwd: __dirname
      });

      let timeout = setTimeout(() => {
        console.error('\n⚠ Test timeout (120s) - terminating');
        test.kill('SIGTERM');
        resolve('timeout');
      }, 120000);

      test.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code === 0 ? 'success' : 'failure');
      });

      test.on('error', (err) => {
        clearTimeout(timeout);
        console.error('Test runner error:', err);
        resolve('error');
      });
    });

    console.log('='.repeat(100));
    console.log(`\n[5] Test runner completed with status: ${testResult}\n`);

  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    console.log('[CLEANUP] Terminating server...');
    if (server && !server.killed) {
      server.kill('SIGTERM');
      await wait(2000);
      if (!server.killed) {
        server.kill('SIGKILL');
      }
    }
    
    console.log('\n' + '='.repeat(100));
    console.log('ORCHESTRATION COMPLETE');
    console.log('='.repeat(100) + '\n');
  }
};

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
