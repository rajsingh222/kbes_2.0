const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 5000,
  method: 'GET',
  timeout: 2000
}, (res) => {
  console.log('Server is running');
  process.exit(0);
});

req.on('error', () => {
  console.log('Server is not running');
  process.exit(0);
});

req.on('timeout', () => {
  req.destroy();
  console.log('Server is not running');
  process.exit(0);
});

req.end();
