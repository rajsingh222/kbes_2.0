#!/usr/bin/env node
/**
 * Simple test runner that checks server and runs test with full output capture
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

console.log('========================================');
console.log('STARTING TEST EXECUTION');
console.log('========================================\n');

// Step 1: Check if server is running
console.log('[STEP 1] Checking if server is running on localhost:5000...');

function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/',
      method: 'GET',
      timeout: 2000
    }, (res) => {
      resolve(true);
    });
    
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    
    req.end();
  });
}

async function main() {
  try {
    const running = await isServerRunning();
    
    if (running) {
      console.log('✓ Server is running\n');
    } else {
      console.log('✗ Server is NOT running\n');
      console.log('[STEP 2] Starting server with: node server.js\n');
      
      const server = spawn('node', ['server.js'], {
        cwd: path.dirname(__filename),
        stdio: 'inherit'
      });
      
      console.log('[INFO] Server process started, waiting 5 seconds...\n');
      await new Promise(r => setTimeout(r, 5000));
    }
    
    console.log('========================================');
    console.log('[STEP 3] Running test_advanced_all_structures.js');
    console.log('========================================\n');
    
    const test = spawn('node', ['test_advanced_all_structures.js'], {
      cwd: path.dirname(__filename),
      stdio: 'inherit'
    });
    
    test.on('close', (code) => {
      console.log('\n========================================');
      console.log(`TEST COMPLETED WITH EXIT CODE: ${code}`);
      console.log('========================================');
      process.exit(code);
    });
    
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

main();
