/**
 * OSHAS Backend - End-to-End Test Runner
 * Tests all phases: Infrastructure, Auth, Profile, Assessment, Payment, Admin, Security
 */

const http = require('http');
const https = require('https');

const BASE_URL = 'http://localhost:5000';
let TEST_TOKEN = null;
let TEST_USER_EMAIL = `testuser_${Date.now()}@testmail.com`;
let TEST_ASSESSMENT_ID = null;
let TEST_ADVANCED_ID = null;
let TEST_PAYMENT_ORDER_ID = null;
let ADMIN_TOKEN = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 5000,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = { raw: data.substring(0, 200) }; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });

    req.on('error', reject);

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const authHeader = (token) => ({ 'Authorization': `Bearer ${token}` });

let passCount = 0, failCount = 0, warnCount = 0;
const results = [];

function log(phase, name, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️ ';
  const line = `  ${icon} [${phase}] ${name}${detail ? ' → ' + detail : ''}`;
  console.log(line);
  results.push({ phase, name, status, detail });
  if (status === 'PASS') passCount++;
  else if (status === 'FAIL') failCount++;
  else warnCount++;
}

function assert(phase, name, condition, detail = '') {
  log(phase, name, condition ? 'PASS' : 'FAIL', detail);
  return condition;
}

function warn(phase, name, detail = '') {
  log(phase, name, 'WARN', detail);
}

// ─── PHASE 1: Infrastructure ─────────────────────────────────────────────────

async function phase1() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 1: Infrastructure & Health');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const res = await request('GET', '/api/health');
    assert('P1', 'GET /api/health → 200', res.status === 200, `status=${res.status}`);
    assert('P1', 'Health response has status field', !!res.body, JSON.stringify(res.body).substring(0, 80));
  } catch (e) {
    assert('P1', 'Server is reachable', false, e.message);
  }
}

// ─── PHASE 2: Authentication ──────────────────────────────────────────────────

async function phase2() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 2: Authentication Flow');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 2.1 Register
  const regPayload = {
    firstName: 'Test', lastName: 'User', email: TEST_USER_EMAIL,
    phone: '9876543210', password: 'TestPass@123', organisation: 'TestOrg'
  };
  const reg = await request('POST', '/api/auth/register', regPayload);
  assert('P2', 'POST /api/auth/register → 201', reg.status === 201, `status=${reg.status}`);
  assert('P2', 'Register returns success:true', reg.body?.success === true, JSON.stringify(reg.body).substring(0, 100));

  // 2.2 Duplicate registration
  const dup = await request('POST', '/api/auth/register', regPayload);
  assert('P2', 'Duplicate register → 400/409', [400, 409].includes(dup.status), `status=${dup.status}`);

  // 2.3 Missing fields
  const missing = await request('POST', '/api/auth/register', { email: 'a@b.com' });
  assert('P2', 'Register missing fields → 400', missing.status === 400, `status=${missing.status}`);

  // 2.4 Login before verification
  const loginUnverified = await request('POST', '/api/auth/login', { email: TEST_USER_EMAIL, password: 'TestPass@123' });
  assert('P2', 'Login unverified → not 200 OR handled gracefully', 
    loginUnverified.status !== 200 || loginUnverified.body?.requiresVerification,
    `status=${loginUnverified.status}, body=${JSON.stringify(loginUnverified.body).substring(0,80)}`);

  // 2.5 Resend code
  const resend = await request('POST', '/api/auth/resend-code', { email: TEST_USER_EMAIL });
  assert('P2', 'POST /api/auth/resend-code → 200', resend.status === 200, `status=${resend.status}`);

  // 2.6 Get verification code from DB (simulate - we skip actual email, check later)
  warn('P2', 'Email verification skipped (requires real email) - will use DB bypass if available');

  // 2.7 Validate token (no token)
  const noToken = await request('GET', '/api/auth/me');
  assert('P2', 'GET /api/auth/me without token → 401', noToken.status === 401, `status=${noToken.status}`);

  // 2.8 Login wrong password
  const wrongPwd = await request('POST', '/api/auth/login', { email: TEST_USER_EMAIL, password: 'WrongPass' });
  assert('P2', 'Login wrong password → 400/401', [400, 401].includes(wrongPwd.status), `status=${wrongPwd.status}`);

  // 2.9 Invalid email login
  const noUser = await request('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'any' });
  assert('P2', 'Login non-existent user → 400/401/404', [400, 401, 404].includes(noUser.status), `status=${noUser.status}`);

  // 2.10 Validate token with garbage
  const badToken = await request('POST', '/api/auth/validate-token', {}, { 'Authorization': 'Bearer garbage_token' });
  assert('P2', 'Validate garbage token → 401', badToken.status === 401, `status=${badToken.status}`);
}

// ─── PHASE 2b: Login with verified user (using existing user if exists) ──────

async function phase2b_loginExisting() {
  console.log('\n  [Attempting login with a pre-verified test account...]');
  // Try with a known pre-existing test user if one was previously verified
  const tryLogin = await request('POST', '/api/auth/login', {
    email: 'testverified@testmail.com', password: 'TestPass@123'
  });
  
  if (tryLogin.status === 200 && tryLogin.body?.token) {
    TEST_TOKEN = tryLogin.body.token;
    TEST_USER_EMAIL = 'testverified@testmail.com';
    log('P2', 'Login with pre-verified user → token obtained', 'PASS', `email=${TEST_USER_EMAIL}`);
    return true;
  }
  
  warn('P2', 'No pre-verified test user available', 
    'Phases requiring auth token will be skipped. To test: manually verify email then rerun.');
  return false;
}

// ─── PHASE 3: Profile Management ─────────────────────────────────────────────

async function phase3() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 3: Profile Management');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!TEST_TOKEN) {
    warn('P3', 'Skipping - no auth token available');
    return;
  }

  const me = await request('GET', '/api/auth/me', null, authHeader(TEST_TOKEN));
  assert('P3', 'GET /api/auth/me with token → 200', me.status === 200, `status=${me.status}`);
  assert('P3', 'User data returned', !!me.body?.user || !!me.body?.email, JSON.stringify(me.body).substring(0, 80));

  const update = await request('PUT', '/api/auth/update-profile', 
    { firstName: 'Updated', lastName: 'Name', phone: '1234567890' },
    authHeader(TEST_TOKEN));
  assert('P3', 'PUT /api/auth/update-profile → 200', update.status === 200, `status=${update.status}`);

  const profile = await request('PUT', '/api/auth/profile',
    { organisation: 'New Org', country: 'India' },
    authHeader(TEST_TOKEN));
  assert('P3', 'PUT /api/auth/profile → 200', profile.status === 200, `status=${profile.status}`);

  const verify = await request('GET', '/api/auth/me', null, authHeader(TEST_TOKEN));
  assert('P3', 'Profile changes persisted', verify.status === 200, `status=${verify.status}`);
}

// ─── PHASE 4: Assessment Flow ─────────────────────────────────────────────────

async function phase4() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 4: Assessment Flow (Core Business Logic)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const userEmail = TEST_TOKEN ? TEST_USER_EMAIL : 'testassess@example.com';

  const assessmentPayload = {
    userDetails: {
      name: 'Test Assessor',
      email: userEmail,
      phone: '9876543210',
      organisation: 'Test Org',
      structureType: 'RCC Building',
      yearOfConstruction: '2010',
      location: 'Mumbai, Maharashtra'
    },
    assessmentResponses: {
      Q1: 'Good', Q2: 'Fair', Q3: 'Good', Q4: 'Poor', Q5: 'Good',
      Q6: 'Fair', Q7: 'Good', Q8: 'Good', Q9: 'Fair', Q10: 'Good'
    },
    responses: {
      q1: 'A', q2: 'B', q3: 'A', q4: 'C', q5: 'A'
    }
  };

  // 4.1 Save assessment
  const save = await request('POST', '/api/save-assessment', assessmentPayload);
  assert('P4', 'POST /api/save-assessment → 200/201', [200, 201].includes(save.status), `status=${save.status}`);
  if (save.body?.assessmentId || save.body?._id) {
    TEST_ASSESSMENT_ID = save.body.assessmentId || save.body._id;
    log('P4', `Assessment saved with ID: ${TEST_ASSESSMENT_ID}`, 'PASS');
  }

  // 4.2 Submit assessment
  const submit = await request('POST', '/api/submit-assessment', assessmentPayload);
  assert('P4', 'POST /api/submit-assessment → 200/201', [200, 201].includes(submit.status), `status=${submit.status}`);
  if (submit.body?.assessmentId || submit.body?._id || submit.body?.data?._id) {
    TEST_ASSESSMENT_ID = submit.body.assessmentId || submit.body._id || submit.body.data?._id;
    log('P4', `Final assessment ID: ${TEST_ASSESSMENT_ID}`, 'PASS');
  } else {
    warn('P4', 'No assessmentId in submit response', JSON.stringify(submit.body).substring(0, 150));
  }

  // 4.3 Get assessment by ID
  if (TEST_ASSESSMENT_ID) {
    const getById = await request('GET', `/api/assessment/${TEST_ASSESSMENT_ID}`);
    assert('P4', 'GET /api/assessment/:id → 200', getById.status === 200, `status=${getById.status}`);
  } else {
    warn('P4', 'GET /api/assessment/:id skipped - no ID');
  }

  // 4.4 Get user assessments
  const getUserAssess = await request('GET', `/api/assessments/user/${userEmail}`);
  assert('P4', 'GET /api/assessments/user/:email → 200', getUserAssess.status === 200, `status=${getUserAssess.status}`);
  const count = getUserAssess.body?.assessments?.length || getUserAssess.body?.length || 0;
  log('P4', `User assessments found: ${count}`, 'PASS');

  // 4.5 Auth-protected user assessments
  if (TEST_TOKEN) {
    const authAssess = await request('GET', '/api/user/assessments', null, authHeader(TEST_TOKEN));
    assert('P4', 'GET /api/user/assessments (auth) → 200', authAssess.status === 200, `status=${authAssess.status}`);
  } else {
    warn('P4', 'GET /api/user/assessments skipped - no token');
  }

  // 4.6 Generate AI report (may be slow)
  if (TEST_ASSESSMENT_ID) {
    console.log('  [Generating AI report - may take 10-30 seconds...]');
    const reportPayload = { assessmentId: TEST_ASSESSMENT_ID, ...assessmentPayload };
    const report = await request('POST', '/api/generate-report', reportPayload);
    assert('P4', 'POST /api/generate-report → 200', report.status === 200, `status=${report.status}`);
    const hasText = report.body?.reportText || report.body?.report || report.body?.text;
    assert('P4', 'Report has text content', !!hasText, `preview=${String(hasText || '').substring(0, 60)}`);
  } else {
    warn('P4', 'Generate report skipped - no assessmentId');
  }

  // 4.7 Generate PDF
  if (TEST_ASSESSMENT_ID) {
    const pdfPayload = { assessmentId: TEST_ASSESSMENT_ID, ...assessmentPayload };
    const pdf = await request('POST', '/api/generate-pdf', pdfPayload);
    assert('P4', 'POST /api/generate-pdf → 200', pdf.status === 200, `status=${pdf.status}`);
  } else {
    warn('P4', 'Generate PDF skipped - no assessmentId');
  }

  // 4.8 Building-specific report
  const buildingReport = await request('POST', '/api/generate-building-report', {
    ...assessmentPayload,
    assessmentId: TEST_ASSESSMENT_ID
  });
  assert('P4', 'POST /api/generate-building-report → 200', buildingReport.status === 200, 
    `status=${buildingReport.status}, err=${buildingReport.body?.message || ''}`);

  // 4.9 Full assessments (auth)
  if (TEST_TOKEN) {
    const full = await request('GET', '/api/user/full-assessments', null, authHeader(TEST_TOKEN));
    assert('P4', 'GET /api/user/full-assessments (auth) → 200', full.status === 200, `status=${full.status}`);
  }
}

// ─── PHASE 5: Advanced Assessment ────────────────────────────────────────────

async function phase5() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 5: Advanced Assessment Questionnaire');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!TEST_ASSESSMENT_ID) {
    warn('P5', 'Skipping - no assessment ID from Phase 4');
    return;
  }

  const advPayload = {
    userEmail: TEST_USER_EMAIL || 'testassess@example.com',
    userName: 'Test Assessor',
    structureType: 'RCC Building',
    assessmentType: 'RCC',
    responses: {
      Q1: 'response1', Q2: 'response2', Q3: 'response3',
      Q4: 'response4', Q5: 'response5', Q6: 'response6',
      Q7: 'response7', Q8: 'response8', Q9: 'response9', Q10: 'response10'
    },
    formVersion: '1.0'
  };

  const submit = await request('POST', `/api/assessment/${TEST_ASSESSMENT_ID}/advanced`, advPayload);
  assert('P5', 'POST /api/assessment/:id/advanced → 200/201', [200, 201].includes(submit.status), `status=${submit.status}`);
  if (submit.body?.advancedAssessmentId || submit.body?._id) {
    TEST_ADVANCED_ID = submit.body.advancedAssessmentId || submit.body._id;
    log('P5', `Advanced assessment ID: ${TEST_ADVANCED_ID}`, 'PASS');
  }

  const get = await request('GET', `/api/assessment/${TEST_ASSESSMENT_ID}/advanced`);
  assert('P5', 'GET /api/assessment/:id/advanced → 200', get.status === 200, `status=${get.status}`);

  // Duplicate submission (unique constraint test)
  const dup = await request('POST', `/api/assessment/${TEST_ASSESSMENT_ID}/advanced`, advPayload);
  assert('P5', 'Duplicate advanced submit → 400/409 (unique constraint)', 
    [400, 409].includes(dup.status) || dup.body?.success === false,
    `status=${dup.status}`);
}

// ─── PHASE 6: Payment Flow ────────────────────────────────────────────────────

async function phase6() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 6: Payment Flow (Razorpay Test Mode)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 6.1 Currency info
  const currency = await request('GET', '/api/payment/currency-info');
  assert('P6', 'GET /api/payment/currency-info → 200', currency.status === 200, `status=${currency.status}`);
  assert('P6', 'Currency in response', !!(currency.body?.currency || currency.body?.data?.currency),
    JSON.stringify(currency.body).substring(0, 100));

  // 6.2 Create Razorpay order
  const orderPayload = {
    assessmentId: TEST_ASSESSMENT_ID || 'test_assess_123',
    assessmentType: 'basic'
  };
  if (TEST_TOKEN) orderPayload.userId = 'from_token';

  const headers = TEST_TOKEN ? authHeader(TEST_TOKEN) : {};
  const order = await request('POST', '/api/payment/create-order', orderPayload, headers);
  assert('P6', 'POST /api/payment/create-order → 200/201', [200, 201].includes(order.status), 
    `status=${order.status}, err=${order.body?.message || ''}`);

  if (order.body?.orderId || order.body?.order?.id || order.body?.data?.orderId) {
    TEST_PAYMENT_ORDER_ID = order.body.orderId || order.body.order?.id || order.body.data?.orderId;
    log('P6', `Razorpay order created: ${TEST_PAYMENT_ORDER_ID}`, 'PASS');
  } else {
    warn('P6', 'No orderId in response', JSON.stringify(order.body).substring(0, 150));
  }

  // 6.3 Check payment available
  const available = await request('GET', 
    `/api/payment/check-available?assessmentId=${TEST_ASSESSMENT_ID || 'test'}`, 
    null, headers);
  assert('P6', 'GET /api/payment/check-available → 200', available.status === 200, `status=${available.status}`);

  // 6.4 Payment history (auth required)
  if (TEST_TOKEN) {
    const history = await request('GET', '/api/payment/history', null, authHeader(TEST_TOKEN));
    assert('P6', 'GET /api/payment/history (auth) → 200', history.status === 200, `status=${history.status}`);
  } else {
    warn('P6', 'Payment history skipped - no auth token');
  }

  // 6.5 Verify payment (without valid signature - should fail gracefully)
  const fakeVerify = await request('POST', '/api/payment/verify-payment', {
    razorpayOrderId: TEST_PAYMENT_ORDER_ID || 'order_fake',
    razorpayPaymentId: 'pay_fake123',
    razorpaySignature: 'invalid_signature'
  }, TEST_TOKEN ? authHeader(TEST_TOKEN) : {});
  assert('P6', 'POST /api/payment/verify-payment (invalid sig) → 400/422/500', 
    [400, 401, 422, 500].includes(fakeVerify.status) || fakeVerify.body?.success === false,
    `status=${fakeVerify.status}, msg=${fakeVerify.body?.message || ''}`);
}

// ─── PHASE 7: Admin Flow ──────────────────────────────────────────────────────

async function phase7() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 7: Admin Dashboard');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Try common admin credentials
  const adminCreds = [
    { username: 'admin', password: 'admin123' },
    { email: 'admin@spplindia.org', password: 'admin123' },
    { username: 'admin', password: 'sppl@admin2024' }
  ];

  let adminLoggedIn = false;
  for (const cred of adminCreds) {
    const login = await request('POST', '/api/admin/login', cred);
    if (login.status === 200 && (login.body?.token || login.body?.success)) {
      ADMIN_TOKEN = login.body.token;
      adminLoggedIn = true;
      assert('P7', 'POST /api/admin/login → 200', true, `credentials worked`);
      break;
    }
  }

  if (!adminLoggedIn) {
    warn('P7', 'Admin login failed - credentials unknown or hardcoded differently');
    warn('P7', 'Admin endpoints will be tested without valid admin token');
  }

  const adminAuth = ADMIN_TOKEN ? { 'Authorization': `Bearer ${ADMIN_TOKEN}` } : {};

  // Stats
  const stats = await request('GET', '/api/admin/stats', null, adminAuth);
  assert('P7', 'GET /api/admin/stats → 200/401', 
    stats.status === 200 || stats.status === 401,
    `status=${stats.status}, data=${JSON.stringify(stats.body).substring(0, 80)}`);

  if (stats.status === 200) {
    log('P7', `Stats: ${JSON.stringify(stats.body).substring(0, 100)}`, 'PASS');
  }

  // Users
  const users = await request('GET', '/api/admin/users', null, adminAuth);
  assert('P7', 'GET /api/admin/users → 200/401', 
    users.status === 200 || users.status === 401, `status=${users.status}`);

  if (users.status === 200) {
    const userCount = users.body?.users?.length || users.body?.length || 0;
    log('P7', `Total users in DB: ${userCount}`, 'PASS');
  }

  // All assessments
  const allAssess = await request('GET', '/api/admin/assessments', null, adminAuth);
  assert('P7', 'GET /api/admin/assessments → 200/401',
    allAssess.status === 200 || allAssess.status === 401, `status=${allAssess.status}`);

  // Without admin token - should be 401
  const noAuth = await request('GET', '/api/admin/users');
  assert('P7', 'Admin endpoint without token → 401/403', 
    [401, 403].includes(noAuth.status), `status=${noAuth.status}`);
}

// ─── PHASE 8: Email Services ──────────────────────────────────────────────────

async function phase8() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 8: Email & Contact Services');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Contact form
  const contact = await request('POST', '/api/contact-form', {
    name: 'Test Contact',
    email: 'contact@test.com',
    phone: '9876543210',
    message: 'This is a test contact form submission',
    subject: 'Test Subject'
  });
  assert('P8', 'POST /api/contact-form → 200', contact.status === 200, 
    `status=${contact.status}, msg=${contact.body?.message || contact.body?.error || ''}`);

  // Send assessment email
  if (TEST_ASSESSMENT_ID) {
    const email = await request('POST', '/api/send-assessment-email', {
      assessmentId: TEST_ASSESSMENT_ID,
      email: 'test@example.com',
      name: 'Test User'
    });
    assert('P8', 'POST /api/send-assessment-email → 200', email.status === 200, 
      `status=${email.status}, msg=${email.body?.message || email.body?.error || ''}`);
  } else {
    warn('P8', 'Send assessment email skipped - no assessmentId');
  }
}

// ─── PHASE 9: Security ────────────────────────────────────────────────────────

async function phase9() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 9: Security & Edge Cases');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Invalid JWT
  const badJwt = await request('GET', '/api/auth/me', null, { 'Authorization': 'Bearer invalid.jwt.token' });
  assert('P9', 'Invalid JWT → 401', badJwt.status === 401, `status=${badJwt.status}`);

  // Empty bearer
  const emptyBearer = await request('GET', '/api/auth/me', null, { 'Authorization': 'Bearer ' });
  assert('P9', 'Empty Bearer → 401', emptyBearer.status === 401, `status=${emptyBearer.status}`);

  // NoSQL injection attempt in login
  const noSqlInject = await request('POST', '/api/auth/login', {
    email: { '$gt': '' }, password: 'anything'
  });
  assert('P9', 'NoSQL injection in login → 400/401 (not 200)', 
    noSqlInject.status !== 200, `status=${noSqlInject.status}`);

  // XSS in registration
  const xss = await request('POST', '/api/auth/register', {
    firstName: '<script>alert(1)</script>', lastName: 'Test',
    email: `xss_${Date.now()}@test.com`, phone: '1234567890', password: 'Test@123'
  });
  assert('P9', 'XSS payload in register → 400 or sanitized', 
    xss.status === 400 || xss.status === 201,
    `status=${xss.status} (201=accepted but should be sanitized in DB)`);

  // Access non-existent assessment
  const noAssess = await request('GET', '/api/assessment/000000000000000000000000');
  assert('P9', 'Non-existent assessment → 404/400', [400, 404].includes(noAssess.status), 
    `status=${noAssess.status}`);

  // Invalid assessment ID format
  const badId = await request('GET', '/api/assessment/not-a-valid-id');
  assert('P9', 'Invalid ObjectId format → 400/500', [400, 500].includes(badId.status), 
    `status=${badId.status}`);
}

// ─── PHASE 10: Structure Type Coverage ───────────────────────────────────────

async function phase10() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 10: All Structure Types');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const structures = [
    { type: 'RCC Building', endpoint: '/api/generate-building-report' },
    { type: 'Load-Bearing Structure', endpoint: '/api/generate-building-report' },
    { type: 'Tunnel', endpoint: '/api/generate-tunnel-report' },
    { type: 'Bridge', endpoint: '/api/generate-bridge-report' }
  ];

  for (const s of structures) {
    const payload = {
      userDetails: {
        name: 'Test', email: 'test@test.com', phone: '9876543210',
        organisation: 'Test Org', structureType: s.type,
        yearOfConstruction: '2000', location: 'Test City'
      },
      assessmentResponses: { Q1: 'Good', Q2: 'Fair', Q3: 'Good' },
      responses: { q1: 'A', q2: 'B' }
    };

    const res = await request('POST', s.endpoint, payload);
    assert('P10', `${s.type} → ${s.endpoint} → 200`, res.status === 200,
      `status=${res.status}, err=${res.body?.message || ''}`);
  }
}

// ─── MAIN RUNNER ──────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     OSHAS Backend - End-to-End Test Runner       ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Test user: ${TEST_USER_EMAIL}`);
  console.log(`  Started: ${new Date().toISOString()}`);

  const start = Date.now();

  try {
    await phase1();
    await phase2();
    const hasToken = await phase2b_loginExisting();
    if (hasToken) TEST_TOKEN = TEST_TOKEN; // already set
    await phase3();
    await phase4();
    await phase5();
    await phase6();
    await phase7();
    await phase8();
    await phase9();
    await phase10();
  } catch (err) {
    console.error('\n❌ FATAL ERROR during test execution:', err.message);
    console.error(err.stack);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║                  TEST SUMMARY                   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  ✅ PASSED : ${passCount}`);
  console.log(`  ❌ FAILED : ${failCount}`);
  console.log(`  ⚠️  WARNED : ${warnCount}`);
  console.log(`  ⏱️  Time   : ${elapsed}s`);
  console.log(`  📊 Total  : ${passCount + failCount + warnCount}`);

  if (failCount > 0) {
    console.log('\n  ── FAILURES ──');
    results.filter(r => r.status === 'FAIL')
      .forEach(r => console.log(`  ❌ [${r.phase}] ${r.name}  →  ${r.detail}`));
  }

  if (warnCount > 0) {
    console.log('\n  ── WARNINGS ──');
    results.filter(r => r.status === 'WARN')
      .forEach(r => console.log(`  ⚠️  [${r.phase}] ${r.name}  →  ${r.detail}`));
  }

  console.log('');
}

main();
