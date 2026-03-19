const { spawn, exec } = require('child_process');
const http = require('http');
const path = require('path');

const backendDir = 'c:\\Raj\\sppl react\\client\\oshas-standalone\\backend';
process.chdir(backendDir);

console.log(`Working directory: ${process.cwd()}`);

let serverProcess = null;

// Function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to do health check
const healthCheck = () => {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/health',
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`\nHealth Check: Status ${res.statusCode}`);
        console.log('Response:', data);
        resolve(res.statusCode === 200);
      });
    });
    
    req.on('error', (err) => {
      console.log(`\nHealth Check ERROR: ${err.message}`);
      resolve(false);
    });
    
    req.end();
  });
};

// Main execution
(async () => {
  try {
    // Start server
    console.log('\n===== Starting Backend Server =====');
    serverProcess = spawn('node', ['server.js']);
    
    serverProcess.stdout.on('data', (data) => {
      console.log(`[SERVER] ${data}`);
    });
    
    serverProcess.stderr.on('data', (data) => {
      console.log(`[SERVER ERROR] ${data}`);
    });
    
    // Wait for server to initialize
    console.log('\nWaiting 10 seconds for server to initialize...');
    await wait(10000);
    
    // Run health check
    console.log('\n===== Running Health Check =====');
    const isHealthy = await healthCheck();
    
    if (!isHealthy) {
      console.log('\n⚠️  Server health check failed. Tests may not run properly.');
    } else {
      console.log('\n✓ Server is healthy. Proceeding with E2E tests.');
    }
    
    // Wait a moment
    await wait(2000);
    
    // Run E2E tests
    console.log('\n===== Starting E2E Test Runner =====\n');
    
    const testProcess = spawn('node', ['e2e_test_runner.js']);
    
    testProcess.stdout.on('data', (data) => {
      process.stdout.write(data);
    });
    
    testProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
    });
    
    // Wait for test process to complete (max 180 seconds)
    await new Promise((resolve) => {
      testProcess.on('close', (code) => {
        console.log(`\n\n===== E2E Test Runner Completed (exit code: ${code}) =====`);
        resolve();
      });
      
      setTimeout(() => {
        console.log('\n\n⚠️  Test timeout after 180 seconds, terminating...');
        testProcess.kill();
        resolve();
      }, 180000);
    });
    
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    // Kill server
    console.log('\n===== Stopping Server =====');
    if (serverProcess) {
      serverProcess.kill();
      console.log('Server process terminated');
    }
    
    // Kill any lingering node processes
    console.log('Cleaning up any remaining node processes...');
    exec('taskkill /IM node.exe /F', (error) => {
      if (!error) {
        console.log('Node processes cleaned up');
      }
      process.exit(0);
    });
  }
})();
