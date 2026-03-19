#!/usr/bin/env node

/**
 * Test Runner: Checks server and runs test_advanced_all_structures.js
 */

const http = require('http');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const BACKEND_DIR = __dirname;
const SERVER_PORT = 5000;
const SERVER_HOST = 'localhost';

let serverProcess = null;

// Function to check if server is running
async function isServerRunning(timeout = 2000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    function tryConnect() {
      const req = http.request({
        hostname: SERVER_HOST,
        port: SERVER_PORT,
        method: 'HEAD',
        timeout: 1000
      }, (res) => {
        req.destroy();
        resolve(true);
      });

      req.on('error', () => {
        if (Date.now() - startTime < timeout) {
          setTimeout(tryConnect, 100);
        } else {
          resolve(false);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - startTime < timeout) {
          setTimeout(tryConnect, 100);
        } else {
          resolve(false);
        }
      });

      req.end();
    }
    
    tryConnect();
  });
}

// Function to start server
async function startServer() {
  return new Promise((resolve, reject) => {
    console.log('\n🚀 Starting server on port', SERVER_PORT, '...\n');
    
    serverProcess = spawn('node', ['server.js'], {
      cwd: BACKEND_DIR,
      stdio: 'pipe',
      detached: false
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let resolved = false;

    const resolveOnce = () => {
      if (!resolved) {
        resolved = true;
        // Give it a bit more time to be ready
        setTimeout(resolve, 2000);
      }
    };

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      stdoutBuffer += msg;
      process.stdout.write('[SERVER] ' + msg);
      if (msg.includes('listening') || msg.includes('connected')) {
        resolveOnce();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      stderrBuffer += msg;
      process.stderr.write('[SERVER] ' + msg);
    });

    serverProcess.on('error', (err) => {
      console.error('❌ Failed to start server:', err.message);
      reject(err);
    });

    serverProcess.on('close', (code) => {
      console.log(`\n⚠️ Server process exited with code ${code}`);
    });

    // Fallback: resolve after 5 seconds anyway
    setTimeout(resolveOnce, 5000);
  });
}

// Function to run tests
async function runTests() {
  return new Promise((resolve) => {
    console.log('\n📋 Running test_advanced_all_structures.js\n');
    console.log('═'.repeat(70));
    
    const test = spawn('node', ['test_advanced_all_structures.js'], {
      cwd: BACKEND_DIR,
      stdio: 'inherit',
      env: process.env
    });

    test.on('close', (code) => {
      console.log('═'.repeat(70));
      console.log(`\n✅ Test completed with exit code ${code}\n`);
      resolve(code);
    });

    test.on('error', (err) => {
      console.error('❌ Failed to run tests:', err.message);
      resolve(1);
    });
  });
}

// Main execution
async function main() {
  try {
    console.log('\n' + '═'.repeat(70));
    console.log('OSHAS ADVANCED STRUCTURES TEST SUITE');
    console.log('═'.repeat(70));

    // Step 1: Check if server is running
    console.log('\n1️⃣  Checking if server is already running on port', SERVER_PORT, '...');
    const running = await isServerRunning(2000);
    
    if (running) {
      console.log('✅ Server is already running!');
    } else {
      console.log('⚠️  Server is not running.');
      await startServer();
      console.log('✅ Server started successfully!');
    }

    // Step 2: Run tests
    console.log('\n2️⃣  Preparing to run tests...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const exitCode = await runTests();

    // Cleanup
    if (serverProcess && !running) {
      console.log('🧹 Cleaning up server process...');
      try {
        process.kill(-serverProcess.pid);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    process.exit(exitCode);
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    if (serverProcess) {
      try {
        process.kill(-serverProcess.pid);
      } catch (e) {}
    }
    process.exit(1);
  }
}

main();
