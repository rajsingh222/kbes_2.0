#!/usr/bin/env node

const http = require('http');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Function to check if server is running
function checkServerRunning() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/',
      method: 'GET',
      timeout: 2000,
    };

    const req = http.request(options, (res) => {
      resolve(true);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// Function to start the server
function startServer() {
  return new Promise((resolve, reject) => {
    log('\n📢 Starting server...', 'blue');
    
    const server = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let serverStarted = false;
    let startTimeout;

    const dataHandler = (data) => {
      const output = data.toString();
      console.log(output);
      
      if (output.includes('running on port') && !serverStarted) {
        serverStarted = true;
        clearTimeout(startTimeout);
        log('✅ Server started successfully!', 'green');
        resolve(server);
      }
    };

    server.stdout.on('data', dataHandler);
    server.stderr.on('data', dataHandler);

    startTimeout = setTimeout(() => {
      if (!serverStarted) {
        log('⚠️  Server may not have started, but continuing anyway...', 'yellow');
        resolve(server);
      }
    }, 5000);

    server.on('error', (err) => {
      clearTimeout(startTimeout);
      reject(err);
    });
  });
}

// Function to run the test
function runTest() {
  return new Promise((resolve, reject) => {
    log('\n📋 Running test_advanced_all_structures.js...', 'blue');
    log('=' * 80, 'yellow');

    const test = spawn('node', ['test_advanced_all_structures.js'], {
      cwd: __dirname,
      stdio: 'inherit',
    });

    test.on('close', (code) => {
      log('=' * 80, 'yellow');
      if (code === 0) {
        log('✅ Test completed successfully!', 'green');
      } else {
        log(`⚠️  Test exited with code ${code}`, 'yellow');
      }
      resolve(code);
    });

    test.on('error', (err) => {
      reject(err);
    });
  });
}

// Main execution
async function main() {
  try {
    log('\n🔍 Checking if server is already running...', 'blue');
    const isRunning = await checkServerRunning();

    let serverProcess;
    if (isRunning) {
      log('✅ Server is already running on port 5000!', 'green');
    } else {
      log('❌ Server is not running', 'red');
      serverProcess = await startServer();
      log('⏳ Waiting 5 seconds for server to fully initialize...', 'blue');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    const testCode = await runTest();

    if (serverProcess) {
      log('\n🛑 Stopping server...', 'blue');
      serverProcess.kill();
      log('✅ Server stopped', 'green');
    }

    process.exit(testCode);
  } catch (error) {
    log(`❌ Error: ${error.message}`, 'red');
    process.exit(1);
  }
}

main();
