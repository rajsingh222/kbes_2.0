const fs = require('fs');
const path = require('path');
const vm = require('vm');
const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/osham_assessments';

const FRONTEND_FILE = path.resolve(__dirname, '../frontend/src/pages/AdvancedRCCAssessment.js');

const TEST_USER = {
  firstName: 'Pipeline',
  lastName: 'AuditRCC',
  email: 'pipeline_audit_rcc@osham.test',
  phone: '9876543210',
  password: 'TestPass@123',
  organisation: 'SPPL Pipeline Audit'
};

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\') {
      escape = true;
      continue;
    }

    if (!inDouble && !inTemplate && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate;
      continue;
    }

    if (inSingle || inDouble || inTemplate) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function extractDefaultStateObjectLiteral(fileContent) {
  const marker = 'const defaultState = {';
  const markerIndex = fileContent.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('Could not find defaultState marker in AdvancedRCCAssessment.js');
  }

  const openBraceIndex = fileContent.indexOf('{', markerIndex);
  const closeBraceIndex = findMatchingBrace(fileContent, openBraceIndex);
  if (openBraceIndex === -1 || closeBraceIndex === -1) {
    throw new Error('Could not extract defaultState object literal boundaries');
  }

  return fileContent.slice(openBraceIndex, closeBraceIndex + 1);
}

function parseDefaultState(objectLiteral) {
  const sandbox = {};
  return vm.runInNewContext(`(${objectLiteral})`, sandbox);
}

function buildAuditPayloadFromDefaults(defaultState) {
  const payload = {};
  const structuredSectionNames = [
    'Q1_BuildingInformation',
    'Q2_CrackingDistress',
    'Q3_DeformationInstability',
    'Q4_MaterialDeterioration',
    'Q5_HollowSoundingAreas',
    'Q6_ReinforcementCondition',
    'Q7_PastInterventions',
    'Q8_FoundationSettlement',
    'Q9_EnvironmentalImpact',
    'Q10_StructuralDesignVerification',
    'Q11_NDT',
    'Q12_LoadTesting',
    'Q13_StaticSHM',
    'Q14_DynamicSHM',
    'Q15_StructuralAudit',
    'Q16_AdjacentStructureInteraction',
    'Q17_NaturalDisasters'
  ];

  for (const [key, value] of Object.entries(defaultState)) {
    if (Array.isArray(value)) {
      payload[key] = [`VAL_${key}`];
      continue;
    }
    if (typeof value === 'string') {
      payload[key] = `VAL_${key}`;
      continue;
    }
    if (typeof value === 'number') {
      payload[key] = 1;
      continue;
    }
    if (typeof value === 'boolean') {
      payload[key] = true;
      continue;
    }
    if (value === null) {
      payload[key] = null;
      continue;
    }
    payload[key] = `VAL_${key}`;
  }

  // Keep known branching-friendly values realistic for consistency.
  payload.adv_usage_changed = 'Yes';
  payload.q6_rcc_has_cracks = 'Yes';
  payload.q7_rcc_deformation_has = 'Yes';
  payload.q4_adv_deterioration_has = 'Yes';
  payload.q5_adv_hollow_has = 'Yes';
  payload.q6_adv_rebar_has = 'Yes';
  payload.q7_adv_past_has = 'Yes';
  payload.q8_adv_settlement_has = 'Yes';
  payload.q9_adv_veg_has = 'Yes';
  payload.q10_adv_design_verify_has = 'Yes';
  payload.q11_adv_ndt_has = 'Yes';
  payload.q12_adv_load_test_has = 'Yes';
  payload.q13_adv_shm_has = 'Yes';
  payload.q14_adv_dyn_shm_has = 'Yes';
  payload.q15_adv_struct_audit_mandated = 'Yes';
  payload.q16_adv_adjacent_connected = 'Yes';
  payload.q10_adv_disaster_has = 'Yes';

  payload.structured = structuredSectionNames.reduce((acc, sectionName) => {
    acc[sectionName] = { audit_marker: `present_${sectionName}` };
    return acc;
  }, {});

  payload._meta = {
    structureType: 'RCC Structure',
    submittedAt: new Date().toISOString(),
    formVersion: 'advanced-rcc-v1'
  };

  return payload;
}

async function registerOrLogin() {
  try {
    const login = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: TEST_USER.email,
      password: TEST_USER.password
    });
    return login.data.token;
  } catch (_) {
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
      q8a_damp_has: 'Yes',
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

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function run() {
  let mongoConnected = false;
  try {
    printSection('RCC Advanced Full Key Pipeline Audit');
    console.log(`API URL: ${BASE_URL}`);

    const fileContent = fs.readFileSync(FRONTEND_FILE, 'utf8');
    const defaultStateLiteral = extractDefaultStateObjectLiteral(fileContent);
    const defaultState = parseDefaultState(defaultStateLiteral);
    const defaultKeys = Object.keys(defaultState);

    console.log(`Extracted default frontend keys: ${defaultKeys.length}`);

    const advancedResponses = buildAuditPayloadFromDefaults(defaultState);
    const submittedKeys = Object.keys(advancedResponses).filter((k) => k !== '_meta');
    console.log(`Prepared keys for submit (excluding _meta): ${submittedKeys.length}`);

    const token = await registerOrLogin();
    console.log('Authentication successful');

    const assessmentId = await createBasicAssessment();
    console.log(`Created base assessment: ${assessmentId}`);

    const submit = await axios.post(
      `${BASE_URL}/api/assessment/${assessmentId}/advanced`,
      { advancedResponses },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!submit.data?.success) {
      throw new Error('Advanced submit returned unsuccessful response');
    }

    console.log(`Submit successful, backend reported fieldsSaved=${submit.data.fieldsSaved}`);

    const fetch = await axios.get(
      `${BASE_URL}/api/assessment/${assessmentId}/advanced`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const apiSaved = fetch.data?.advancedResponses || {};
    const missingInApi = submittedKeys.filter((key) => !(key in apiSaved));

    if (missingInApi.length > 0) {
      throw new Error(`Missing keys in API retrieval (${missingInApi.length}): ${missingInApi.slice(0, 30).join(', ')}`);
    }

    console.log('API retrieval contains all submitted keys');

    await mongoose.connect(MONGO_URI);
    mongoConnected = true;

    const AdvancedAssessment = mongoose.model(
      'AdvancedAssessmentPipelineAudit',
      new mongoose.Schema({}, { strict: false, collection: 'advancedassessments' })
    );

    const doc = await AdvancedAssessment.findById(submit.data.advancedAssessmentId);

    if (!doc || !doc.responses) {
      throw new Error('No advancedassessments doc/responses found for submitted record');
    }

    const dbSaved = doc.responses;
    const missingInDb = submittedKeys.filter((key) => !(key in dbSaved));

    if (missingInDb.length > 0) {
      throw new Error(`Missing keys in MongoDB (${missingInDb.length}): ${missingInDb.slice(0, 30).join(', ')}`);
    }

    console.log('MongoDB document contains all submitted keys');

    const structured = dbSaved.structured || {};
    const requiredSections = [
      'Q1_BuildingInformation',
      'Q2_CrackingDistress',
      'Q3_DeformationInstability',
      'Q4_MaterialDeterioration',
      'Q5_HollowSoundingAreas',
      'Q6_ReinforcementCondition',
      'Q7_PastInterventions',
      'Q8_FoundationSettlement',
      'Q9_EnvironmentalImpact',
      'Q10_StructuralDesignVerification',
      'Q11_NDT',
      'Q12_LoadTesting',
      'Q13_StaticSHM',
      'Q14_DynamicSHM',
      'Q15_StructuralAudit',
      'Q16_AdjacentStructureInteraction',
      'Q17_NaturalDisasters'
    ];

    const missingStructuredSections = requiredSections.filter((s) => !(s in structured));
    if (missingStructuredSections.length > 0) {
      throw new Error(`Missing structured sections: ${missingStructuredSections.join(', ')}`);
    }

    console.log('Structured payload includes Q1 through Q17 sections');

    printSection('PASS');
    console.log(`Verified ${submittedKeys.length} frontend keys across API and MongoDB`);
    process.exit(0);
  } catch (err) {
    printSection('FAIL');
    console.error(err.response?.data || err.message);
    process.exit(1);
  } finally {
    if (mongoConnected) {
      await mongoose.disconnect();
    }
  }
}

run();
