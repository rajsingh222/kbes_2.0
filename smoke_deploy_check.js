const axios = require('axios');

const API = process.env.API_URL || 'http://localhost:5000';

function assert(condition, message, details = '') {
  if (!condition) {
    const err = new Error(`${message}${details ? ` | ${details}` : ''}`);
    err.isAssertion = true;
    throw err;
  }
}

async function call(method, path, data, token, expectedStatuses = [200]) {
  try {
    const response = await axios({
      method,
      url: `${API}${path}`,
      data,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      validateStatus: () => true,
      timeout: 60000
    });

    const ok = expectedStatuses.includes(response.status);
    return { ok, status: response.status, data: response.data };
  } catch (error) {
    return { ok: false, status: -1, data: { error: error.message } };
  }
}

async function run() {
  const now = Date.now();
  const email = `deploy_smoke_${now}@example.com`;
  const password = 'TestPass@123';

  console.log('\n=== DEPLOY SMOKE CHECK START ===');
  console.log(`API: ${API}`);

  const health = await call('get', '/api/health', null, null, [200]);
  assert(health.ok, 'Health endpoint failed', JSON.stringify(health.data));
  console.log('PASS health');

  const register = await call('post', '/api/auth/register', {
    firstName: 'Deploy',
    lastName: 'Smoke',
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

  const me = await call('get', '/api/auth/me', null, token, [200]);
  assert(me.ok, 'Auth me failed', JSON.stringify(me.data));
  console.log('PASS auth profile');

  const basicCurrency = await call('get', '/api/payment/currency-info?assessmentLevel=basic', null, token, [200]);
  assert(basicCurrency.ok, 'Basic currency info failed', JSON.stringify(basicCurrency.data));
  assert(basicCurrency.data.amount === 100, 'Basic INR amount mismatch', JSON.stringify(basicCurrency.data));
  console.log('PASS basic currency amount=100');

  const basicOrder = await call('post', '/api/payment/create-order', { assessmentLevel: 'basic' }, token, [200]);
  assert(basicOrder.ok, 'Basic create-order failed', JSON.stringify(basicOrder.data));
  assert(basicOrder.data.amount === 100, 'Basic order amount mismatch', JSON.stringify(basicOrder.data));
  console.log('PASS basic order amount=100');

  const payload = {
    userDetails: {
      name: 'Deploy Smoke',
      email,
      phone: '9876543210',
      organization: 'QA',
      structureType: 'RCC Frame'
    },
    assessmentResponses: {
      raw_responses: {
        q1_city: 'Mumbai',
        q1_country: 'India',
        q5_structural_system: 'RCC Frame',
        q3_occupancy_type: 'Commercial'
      }
    },
    assessmentType: 'Building'
  };

  const save = await call('post', '/api/save-assessment', payload, null, [201]);
  assert(save.ok && save.data.assessmentId, 'Save assessment failed', JSON.stringify(save.data));
  const assessmentId = save.data.assessmentId;
  console.log('PASS save-assessment');

  const submit = await call('post', '/api/submit-assessment', payload, null, [201]);
  assert(submit.ok && submit.data.assessmentId, 'Submit assessment failed', JSON.stringify(submit.data));
  console.log('PASS submit-assessment');

  const getAssessment = await call('get', `/api/assessment/${assessmentId}`, null, null, [200]);
  assert(getAssessment.ok, 'Get assessment failed', JSON.stringify(getAssessment.data));
  console.log('PASS get assessment by id');

  const listUserAssess = await call('get', '/api/user/assessments', null, token, [200]);
  assert(listUserAssess.ok, 'Auth user assessments failed', JSON.stringify(listUserAssess.data));
  console.log('PASS user assessments auth');

  const advancedCurrency = await call('get', '/api/payment/currency-info?assessmentLevel=advanced', null, token, [200]);
  assert(advancedCurrency.ok, 'Advanced currency info failed', JSON.stringify(advancedCurrency.data));
  assert(advancedCurrency.data.amount === 200, 'Advanced INR amount mismatch', JSON.stringify(advancedCurrency.data));
  console.log('PASS advanced currency amount=200');

  const advancedOrder = await call('post', '/api/payment/create-order', {
    assessmentId,
    assessmentLevel: 'advanced'
  }, token, [200]);
  assert(advancedOrder.ok, 'Advanced create-order failed', JSON.stringify(advancedOrder.data));
  assert(advancedOrder.data.amount === 200, 'Advanced order amount mismatch', JSON.stringify(advancedOrder.data));
  console.log('PASS advanced order amount=200');

  const checkAvailable = await call('get', `/api/payment/check-available?assessmentId=${assessmentId}`, null, token, [200]);
  assert(checkAvailable.ok, 'check-available failed', JSON.stringify(checkAvailable.data));
  console.log('PASS payment check-available endpoint');

  const history = await call('get', '/api/payment/history', null, token, [200]);
  assert(history.ok, 'payment history failed', JSON.stringify(history.data));
  console.log('PASS payment history endpoint');

  const advancedSave = await call('post', `/api/assessment/${assessmentId}/advanced`, {
    advancedResponses: {
      _meta: { structureType: 'RCC Frame', formVersion: '1.0' },
      adv_usage_changed: 'No',
      q6_rcc_has_cracks: 'No'
    }
  }, token, [200]);
  assert(advancedSave.ok, 'advanced save failed', JSON.stringify(advancedSave.data));
  console.log('PASS advanced save');

  const advancedGet = await call('get', `/api/assessment/${assessmentId}/advanced`, null, token, [200]);
  assert(advancedGet.ok && advancedGet.data.exists === true, 'advanced get failed', JSON.stringify(advancedGet.data));
  console.log('PASS advanced get');

  console.log('\n=== DEPLOY SMOKE CHECK SUCCESS ===');
}

run().catch((error) => {
  console.error('\n=== DEPLOY SMOKE CHECK FAILED ===');
  console.error(error.message || error);
  process.exit(1);
});
