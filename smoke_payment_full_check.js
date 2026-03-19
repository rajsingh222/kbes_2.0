const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const API = process.env.API_URL || 'http://localhost:5000';

function assert(condition, message, details = '') {
  if (!condition) {
    throw new Error(`${message}${details ? ` | ${details}` : ''}`);
  }
}

async function call(method, path, data, token, expectedStatuses = [200]) {
  const response = await axios({
    method,
    url: `${API}${path}`,
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    validateStatus: () => true,
    timeout: 60000
  });

  return {
    ok: expectedStatuses.includes(response.status),
    status: response.status,
    data: response.data
  };
}

async function run() {
  const now = Date.now();
  const email = `deploy_pay_${now}@example.com`;
  const password = 'TestPass@123';

  console.log('\n=== PAYMENT FULL CHECK START ===');

  const register = await call('post', '/api/auth/register', {
    firstName: 'Deploy',
    lastName: 'Payment',
    email,
    phone: '9876543210',
    password,
    organisation: 'QA'
  }, null, [201]);
  assert(register.ok, 'Register failed', JSON.stringify(register.data));
  console.log('PASS signup');

  const login = await call('post', '/api/auth/login', { email, password }, null, [200]);
  assert(login.ok && login.data && login.data.token, 'Login failed', JSON.stringify(login.data));
  const token = login.data.token;
  console.log('PASS login');

  const save = await call('post', '/api/save-assessment', {
    userDetails: {
      name: 'Deploy Payment',
      email,
      phone: '9876543210',
      organization: 'QA',
      structureType: 'RCC Frame'
    },
    assessmentResponses: {
      raw_responses: {
        q1_city: 'Mumbai',
        q1_country: 'India',
        q5_structural_system: 'RCC Frame'
      }
    },
    assessmentType: 'Building'
  }, null, [201]);
  assert(save.ok && save.data.assessmentId, 'save-assessment failed', JSON.stringify(save.data));
  const assessmentId = save.data.assessmentId;
  console.log('PASS save-assessment');

  const createOrder = await call('post', '/api/payment/create-order', {
    assessmentId,
    assessmentLevel: 'advanced'
  }, token, [200]);
  assert(createOrder.ok, 'create-order failed', JSON.stringify(createOrder.data));
  assert(createOrder.data.amount === 200, 'advanced amount not 200', JSON.stringify(createOrder.data));
  const orderId = createOrder.data.orderId;
  console.log('PASS create-order advanced amount=200');

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  assert(!!keySecret, 'Missing RAZORPAY_KEY_SECRET in backend .env');

  const fakePaymentId = `pay_test_${Date.now()}`;
  const signature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${fakePaymentId}`)
    .digest('hex');

  const verify = await call('post', '/api/payment/verify-payment', {
    razorpay_order_id: orderId,
    razorpay_payment_id: fakePaymentId,
    razorpay_signature: signature
  }, token, [200]);

  assert(verify.ok && verify.data.success === true, 'verify-payment failed', JSON.stringify(verify.data));
  console.log('PASS verify-payment');

  const availableBefore = await call('get', `/api/payment/check-available?assessmentId=${assessmentId}`, null, token, [200]);
  assert(availableBefore.ok, 'check-available before mark-used failed', JSON.stringify(availableBefore.data));
  assert(availableBefore.data.hasAvailablePayment === true, 'expected available payment before mark-used', JSON.stringify(availableBefore.data));
  console.log('PASS check-available before mark-used=true');

  const markUsed = await call('post', '/api/payment/mark-used', {
    assessmentId,
    assessmentType: 'Building'
  }, token, [200]);
  assert(markUsed.ok && markUsed.data.success === true, 'mark-used failed', JSON.stringify(markUsed.data));
  console.log('PASS mark-used');

  const availableAfter = await call('get', `/api/payment/check-available?assessmentId=${assessmentId}`, null, token, [200]);
  assert(availableAfter.ok, 'check-available after mark-used failed', JSON.stringify(availableAfter.data));
  assert(availableAfter.data.hasAvailablePayment === false, 'expected no available payment after mark-used', JSON.stringify(availableAfter.data));
  console.log('PASS check-available after mark-used=false');

  const history = await call('get', '/api/payment/history', null, token, [200]);
  assert(history.ok && Array.isArray(history.data.payments), 'payment history failed', JSON.stringify(history.data));
  console.log('PASS payment-history');

  console.log('\n=== PAYMENT FULL CHECK SUCCESS ===');
}

run().catch((error) => {
  console.error('\n=== PAYMENT FULL CHECK FAILED ===');
  console.error(error.message || error);
  process.exit(1);
});
