const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5001';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/osham_assessments';

const TEST_USER = {
  firstName: 'Prod',
  lastName: 'RCCQ17',
  email: 'prod_rcc_q17@osham.test',
  phone: '9876543210',
  password: 'TestPass@123',
  organisation: 'SPPL Prod Test'
};

const REQUIRED_KEYS = [
  'adv_usage_changed',
  'q6_rcc_has_cracks',
  'q7_rcc_deformation_has',
  'q4_adv_deterioration_has',
  'q5_adv_hollow_has',
  'q6_adv_rebar_has',
  'q7_adv_past_has',
  'q8_adv_settlement_has',
  'q9_adv_veg_has',
  'q10_adv_design_verify_has',
  'q11_adv_ndt_has',
  'q12_adv_load_test_has',
  'q13_adv_shm_has',
  'q14_adv_dyn_shm_has',
  'q15_adv_struct_audit_mandated',
  'q16_adv_adjacent_connected',
  'q10_adv_disaster_has'
];

const ADVANCED_RESPONSES = {
  adv_usage_changed: 'Yes',
  adv_new_usage_type: ['Commercial'],

  q6_rcc_has_cracks: 'Yes',
  q6_rcc_crack_floor_levels: ['Ground Floor'],

  q7_rcc_deformation_has: 'Yes',
  q7_rcc_deformation_floor_levels: ['First Floor'],

  q4_adv_deterioration_has: 'Yes',
  q4_adv_deterioration_floor_levels: ['Ground Floor'],

  q5_adv_hollow_has: 'No',

  q6_adv_rebar_has: 'Yes',
  q6_adv_rebar_floor_levels: ['Ground Floor'],

  q7_adv_past_has: 'No',

  q8_adv_settlement_has: 'Yes',
  q8_adv_foundation_elements: ['Footing'],

  q9_adv_veg_has: 'Yes',
  q9_adv_veg_locations: ['Roof slab / terrace'],
  q9_adv_veg_roof_slab_terrace_types: ['Moss / algae on concrete surfaces'],
  q9_adv_veg_roof_slab_terrace_distress: ['Surface deterioration'],

  q10_adv_design_verify_has: 'Yes',
  q10_adv_design_analysis_types: ['Manual calculations'],
  q10_adv_design_drawings_available: 'Yes',
  q10_adv_design_member_adequate: 'No',

  q11_adv_ndt_has: 'Yes',
  q11_adv_ndt_test_types: ['Rebound Hammer'],

  q12_adv_load_test_has: 'No',

  q13_adv_shm_has: 'Yes',
  q13_adv_shm_monitoring_type: 'Continuous',

  q14_adv_dyn_shm_has: 'No',

  q15_adv_struct_audit_mandated: 'Yes',

  q16_adv_adjacent_connected: 'No',
  q16_adv_adjacent_pounding_risk: 'Yes',
  q16_adv_adjacent_construction_nearby: 'Yes',

  q10_adv_disaster_has: 'Yes',
  q10_adv_disasters: ['Flood'],
  q10_adv_flood_month_year: '09/2024',
  q10_adv_flood_duration_days: '2',

  _meta: {
    structureType: 'RCC Structure',
    submittedAt: new Date().toISOString(),
    formVersion: 'advanced-rcc-v1'
  }
};

async function registerOrLogin() {
  try {
    const login = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: TEST_USER.email,
      password: TEST_USER.password
    });
    return login.data.token;
  } catch (err) {
    await axios.post(`${BASE_URL}/api/auth/register`, {
      firstName: TEST_USER.firstName,
      lastName: TEST_USER.lastName,
      email: TEST_USER.email,
      password: TEST_USER.password,
      phone: TEST_USER.phone,
      organisation: TEST_USER.organisation,
      country: 'India'
    });
    const login = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: TEST_USER.email,
      password: TEST_USER.password
    });
    return login.data.token;
  }
}

async function createBasicAssessment() {
  const userDetails = {
    name: `${TEST_USER.firstName} ${TEST_USER.lastName}`,
    email: TEST_USER.email,
    phone: TEST_USER.phone,
    organization: TEST_USER.organisation,
    structureType: 'RCC Structure',
    q1: 'Structural Engineer',
    yearOfConstruction: '10-20 years',
    location: 'Mumbai'
  };

  const assessmentResponses = {
    raw_responses: {
      q5_structural_system: 'RCC Structure',
      q1_city: 'Mumbai',
      q12_disaster_has: 'Yes'
    },
    formatted_responses: {}
  };

  const response = await axios.post(`${BASE_URL}/api/submit-assessment`, {
    userDetails,
    assessmentResponses,
    assessmentType: 'Building'
  });

  return response.data.assessmentId;
}

async function run() {
  let mongoConnected = false;
  try {
    console.log('Running RCC advanced Q1-Q17 production-like test...');
    console.log(`API: ${BASE_URL}`);

    const token = await registerOrLogin();
    console.log('Auth OK');

    const assessmentId = await createBasicAssessment();
    console.log(`Base assessment created: ${assessmentId}`);

    const submitRes = await axios.post(
      `${BASE_URL}/api/assessment/${assessmentId}/advanced`,
      { advancedResponses: ADVANCED_RESPONSES },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!submitRes.data.success) {
      throw new Error('Advanced submit failed');
    }

    const advancedAssessmentId = submitRes.data.advancedAssessmentId;

    console.log(`Advanced submit OK. fieldsSaved=${submitRes.data.fieldsSaved}`);

    const fetchRes = await axios.get(
      `${BASE_URL}/api/assessment/${assessmentId}/advanced`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const saved = fetchRes.data?.advancedResponses || {};

    const missingFromApi = REQUIRED_KEYS.filter((k) => !(k in saved));
    if (missingFromApi.length > 0) {
      throw new Error(`Missing keys in API response: ${missingFromApi.join(', ')}`);
    }

    console.log('All required keys present in API retrieval.');

    await mongoose.connect(MONGO_URI);
    mongoConnected = true;

    const AdvancedAssessment = mongoose.model(
      'AdvancedAssessmentRawQ17',
      new mongoose.Schema({}, { strict: false, collection: 'advancedassessments' })
    );

    const doc = await AdvancedAssessment.findById(advancedAssessmentId);
    if (!doc || !doc.responses) {
      throw new Error('No advancedassessments document found for submitted assessment');
    }

    const dbResponses = doc.responses;
    const missingFromDb = REQUIRED_KEYS.filter((k) => !(k in dbResponses));
    if (missingFromDb.length > 0) {
      throw new Error(`Missing keys in MongoDB: ${missingFromDb.join(', ')}`);
    }

    console.log('All required keys present in MongoDB.');
    console.log('PASS: RCC Advanced Q1-Q17 persistence verified.');
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err.response?.data || err.message);
    process.exit(1);
  } finally {
    if (mongoConnected) {
      await mongoose.disconnect();
    }
  }
}

run();
