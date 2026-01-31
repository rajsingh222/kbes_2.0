/**
 * Test Payment System Integration
 * Run this with: node test_payment_system.js
 * 
 * Prerequisites:
 * 1. Backend server must be running (node server.js)
 * 2. You must have a valid JWT token
 * 3. MongoDB must be connected
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_URL || 'http://localhost:5000';

// Replace with your actual JWT token from login
const JWT_TOKEN = 'YOUR_JWT_TOKEN_HERE';

const headers = {
  'Authorization': `Bearer ${JWT_TOKEN}`,
  'Content-Type': 'application/json'
};

async function testPaymentSystem() {
  console.log('🧪 PAYMENT SYSTEM TEST\n');
  console.log('=' .repeat(60));
  
  try {
    // Test 1: Currency Info
    console.log('\n📋 Test 1: GET /api/payment/currency-info');
    console.log('-' .repeat(60));
    const currencyInfo = await axios.get(
      `${API_BASE_URL}/api/payment/currency-info`,
      { headers }
    );
    console.log('✅ Response:', JSON.stringify(currencyInfo.data, null, 2));
    
    if (currencyInfo.data.displayAmount !== '₹1' && currencyInfo.data.displayAmount !== '$5') {
      console.warn('⚠️  WARNING: Display amount is not ₹1 or $5!');
    }
    
    // Test 2: Check Available Payment
    console.log('\n📋 Test 2: GET /api/payment/check-available');
    console.log('-' .repeat(60));
    const availablePayment = await axios.get(
      `${API_BASE_URL}/api/payment/check-available`,
      { headers }
    );
    console.log('✅ Response:', JSON.stringify(availablePayment.data, null, 2));
    
    // Test 3: Create Order
    console.log('\n📋 Test 3: POST /api/payment/create-order');
    console.log('-' .repeat(60));
    const createOrder = await axios.post(
      `${API_BASE_URL}/api/payment/create-order`,
      {},
      { headers }
    );
    console.log('✅ Response:', JSON.stringify(createOrder.data, null, 2));
    
    if (createOrder.data.amount !== 100 && createOrder.data.amount !== 500) {
      console.warn('⚠️  WARNING: Amount is not 100 (₹1) or 500 ($5)!');
    }
    
    if (createOrder.data.displayAmount !== '₹1' && createOrder.data.displayAmount !== '$5') {
      console.warn('⚠️  WARNING: Display amount is not ₹1 or $5!');
    }
    
    if (!createOrder.data.keyId || !createOrder.data.keyId.startsWith('rzp_')) {
      console.error('❌ ERROR: Invalid Razorpay Key ID!');
    } else {
      console.log('✅ Razorpay Key ID looks valid');
    }
    
    // Test 4: Payment History
    console.log('\n📋 Test 4: GET /api/payment/history');
    console.log('-' .repeat(60));
    const paymentHistory = await axios.get(
      `${API_BASE_URL}/api/payment/history`,
      { headers }
    );
    console.log('✅ Response:', JSON.stringify(paymentHistory.data, null, 2));
    
    console.log('\n' + '=' .repeat(60));
    console.log('✅ ALL TESTS PASSED!');
    console.log('=' .repeat(60));
    console.log('\n📝 SUMMARY:');
    console.log('  ✅ Currency info endpoint working');
    console.log('  ✅ Check available payment working');
    console.log('  ✅ Create order endpoint working');
    console.log('  ✅ Payment history endpoint working');
    console.log('\n💡 NEXT STEPS:');
    console.log('  1. Test payment verification with actual Razorpay payment');
    console.log('  2. Verify payment status updates in database');
    console.log('  3. Test redirect after successful payment');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED!');
    console.error('=' .repeat(60));
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    console.error('\n💡 TROUBLESHOOTING:');
    console.error('  1. Make sure backend server is running (node server.js)');
    console.error('  2. Replace JWT_TOKEN with your actual token from login');
    console.error('  3. Check MongoDB connection');
    console.error('  4. Verify environment variables in .env file');
    process.exit(1);
  }
}

// Run tests
if (JWT_TOKEN === 'YOUR_JWT_TOKEN_HERE') {
  console.error('❌ ERROR: Please set JWT_TOKEN in the script first!');
  console.log('\n📝 HOW TO GET JWT TOKEN:');
  console.log('  1. Start backend: cd backend && node server.js');
  console.log('  2. Start frontend: cd frontend && npm start');
  console.log('  3. Login to the app');
  console.log('  4. Open browser DevTools (F12) → Application → Local Storage');
  console.log('  5. Copy the value of "token"');
  console.log('  6. Replace JWT_TOKEN in this script with that value');
  console.log('  7. Run: node test_payment_system.js');
  process.exit(1);
}

testPaymentSystem();
