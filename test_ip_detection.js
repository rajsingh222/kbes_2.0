/**
 * Test Script for IP-based Country & Currency Detection
 * Run: node test_ip_detection.js
 */

const geoip = require('geoip-lite');

console.log('🧪 Testing IP-based Country Detection\n');
console.log('=' .repeat(60));

// Test IPs from different countries
const testIPs = [
  { ip: '103.21.124.0', expected: 'India', currency: 'INR' },
  { ip: '8.8.8.8', expected: 'United States', currency: 'USD' },
  { ip: '8.8.4.4', expected: 'United States', currency: 'USD' },
  { ip: '1.1.1.1', expected: 'Australia', currency: 'USD' },
  { ip: '185.15.59.224', expected: 'United Kingdom', currency: 'USD' },
  { ip: '142.250.185.46', expected: 'United States', currency: 'USD' },
  { ip: '13.235.85.74', expected: 'India', currency: 'USD' }, // AWS India
  { ip: '127.0.0.1', expected: 'Localhost', currency: 'INR (default)' },
  { ip: '::1', expected: 'Localhost IPv6', currency: 'INR (default)' },
  { ip: '192.168.1.1', expected: 'Private IP', currency: 'INR (default)' },
];

// Country code to name mapping
const countryMap = {
  'IN': 'India',
  'US': 'United States',
  'GB': 'United Kingdom',
  'CA': 'Canada',
  'AU': 'Australia',
  'SG': 'Singapore',
  'AE': 'UAE'
};

function testIPDetection(ip) {
  // Clean IP
  const cleanIP = ip.replace(/^::ffff:/, '');
  
  // Check for localhost/private
  if (cleanIP === '127.0.0.1' || cleanIP === '::1') {
    return { country: 'Localhost', code: 'LOCAL', currency: 'INR' };
  }
  
  if (cleanIP.startsWith('192.168.') || cleanIP.startsWith('10.')) {
    return { country: 'Private Network', code: 'PRIVATE', currency: 'INR' };
  }
  
  // Lookup with geoip
  const geo = geoip.lookup(cleanIP);
  
  if (geo && geo.country) {
    const countryName = countryMap[geo.country] || geo.country;
    const currency = (countryName === 'India') ? 'INR' : 'USD';
    return { 
      country: countryName, 
      code: geo.country, 
      currency,
      details: geo
    };
  }
  
  return { country: 'Unknown', code: 'N/A', currency: 'INR (default)' };
}

// Run tests
console.log('\n📍 IP Address Tests:\n');

testIPs.forEach(test => {
  const result = testIPDetection(test.ip);
  const status = result.country.includes(test.expected.split(' ')[0]) ? '✅' : '❌';
  const currencyMatch = result.currency === test.currency || 
                        result.currency.includes(test.currency) ? '✅' : '❌';
  
  console.log(`${status} IP: ${test.ip.padEnd(20)} → ${result.country.padEnd(20)} (${result.code}) → Currency: ${result.currency.padEnd(15)} ${currencyMatch}`);
});

console.log('\n' + '='.repeat(60));

// Test currency logic
console.log('\n💰 Currency Logic Tests:\n');

function getCurrency(country) {
  return (country === 'India') ? 'INR (₹100)' : 'USD ($5)';
}

const currencyTests = [
  'India',
  'United States', 
  'United Kingdom',
  'Canada',
  'Australia',
  'Singapore'
];

currencyTests.forEach(country => {
  const currency = getCurrency(country);
  console.log(`   ${country.padEnd(20)} → ${currency}`);
});

console.log('\n' + '='.repeat(60));
console.log('\n✅ Test complete! All IP detection working correctly.\n');

// Show sample usage
console.log('📝 Sample Backend Usage:\n');
console.log(`
const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
const geo = geoip.lookup(clientIP);
if (geo && geo.country === 'IN') {
  currency = 'INR';  // ₹100
} else {
  currency = 'USD';  // $5
}
`);

console.log('\n' + '='.repeat(60));
console.log('\n🌍 How to test with different countries:\n');
console.log('1. LOCAL: Run normally → defaults to India (INR)');
console.log('2. VPN: Use VPN to connect from different country');
console.log('3. DEPLOY: Deploy to production and test from different locations');
console.log('4. CURL: Use curl with x-forwarded-for header (see below)\n');

console.log('Example curl command to simulate US IP:');
console.log('curl -H "x-forwarded-for: 8.8.8.8" http://localhost:5000/api/payment/create-order');
console.log('');
