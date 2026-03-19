const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

async function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      method: 'GET',
      timeout: 2000
    }, (res) => {
      console.log('✅ Server is already running');
      resolve(true);
    });

    req.on('error', () => {
      console.log('⚠️ Server is not running');
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      console.log('⚠️ Server is not running (timeout)');
      resolve(false);
    });

    req.end();
  });
}

async function startServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting server...');
    const server = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: 'pipe'
    });

    let output = '';
    
    server.stdout.on('data', (data) => {
      output += data.toString();
      console.log(data.toString());
    });

    server.stderr.on('data', (data) => {
      output += data.toString();
      console.error(data.toString());
    });

    // Wait 5 seconds for server to start
    setTimeout(() => {
      console.log('⏳ Waited 5 seconds for server to start');
      resolve();
    }, 5000);

    server.on('error', (err) => {
      console.error('❌ Failed to start server:', err.message);
      reject(err);
    });
  });
}

async function runTests() {
  return new Promise((resolve, reject) => {
    console.log('\n📋 Running tests...\n');
    const test = spawn('node', ['test_advanced_all_structures.js'], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    test.on('close', (code) => {
      console.log(`\n✅ Test process exited with code ${code}`);
      resolve(code);
    });

    test.on('error', (err) => {
      console.error('❌ Failed to run tests:', err.message);
      reject(err);
    });
  });
}

async function main() {
  try {
    const running = await checkServerRunning();
    
    if (!running) {
      await startServer();
    }

    const testCode = await runTests();
    process.exit(testCode);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
