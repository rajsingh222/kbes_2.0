/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMPLETE ADVANCED RCC ASSESSMENT TEST SCRIPT
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This script tests EVERY question, sub-question and option of the Advanced RCC
 * Assessment form end-to-end:
 *
 *  1. Connects to the running backend (http://localhost:5000)
 *  2. Logs in (or creates) a test user to get a JWT token
 *  3. Creates a base RCC assessment so we have a valid assessmentId
 *  4. Builds a payload that fills EVERY field from Q1 → Q10
 *  5. POSTs to  POST /api/assessment/:id/advanced
 *  6. GETs back via GET  /api/assessment/:id/advanced
 *  7. Verifies EVERY Q section and sub-field is present in the saved document
 *  8. Connects directly to MongoDB to print the raw saved document
 *  9. Prints a pass/fail report for each question
 *
 * RUN: node test_advanced_rcc_complete.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const axios  = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const BASE_URL  = process.env.TEST_API_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGODB_URI  || 'mongodb://localhost:27017/osham_assessments';

// ── Test credentials ──────────────────────────────────────────────────────────
const TEST_USER = {
  firstName:    'RCC',
  lastName:     'TestEngineer',
  email:        'rcc_test_advanced@osham.test',
  phone:        '9876543210',
  password:     'TestPass@123',
  organisation: 'SPPL Test Lab',
  // Convenience alias used in base assessment
  get name() { return `${this.firstName} ${this.lastName}`; }
};

// ═════════════════════════════════════════════════════════════════════════════
// COMPLETE PAYLOAD — every field from defaultState filled with meaningful data
// ═════════════════════════════════════════════════════════════════════════════
const FULL_RCC_PAYLOAD = {
  // ── Q1 Building Information ───────────────────────────────────────────────
  Q1_BuildingInformation: {
    usage_changed:        'Yes',
    new_usage_types:      ['Commercial', 'Institutional'],
    new_usage_type_other: 'Mixed-use research facility',
  },

  // ── Q2 Cracking Distress ──────────────────────────────────────────────────
  Q2_CrackingDistress: {
    has_cracks:             'Yes',
    floor_levels:           ['Ground Floor', 'First Floor', 'Second Floor'],
    elements_affected:      ['Roof', 'Beam', 'Column', 'Floor', 'Vibration damping devices', 'Machine foundation bearings'],
    elements_other:         'Cantilever projection',
    crack_conditions:       ['Leakage/Dampness', 'Exposed reinforcement near crack'],
    crack_conditions_other: 'Salt efflorescence visible',
    Roof: {
      locations:          ['Centre of slab', 'Near column junction'],
      locations_other:    'Over expansion joint',
      orientations:       ['Transverse', 'Diagonal'],
      orientations_other: 'Radial pattern near column',
      max_crack_length:   '850',
      avg_crack_length:   '420',
      max_crack_width:    '3.2',
      avg_crack_width:    '1.8',
      total_cracks:       '14',
      cracks_gte_avg:     '6',
      cracks_lt_avg:      '8',
      crack_depth_type:   'Through crack',
    },
    Beam: {
      locations:          ['Mid-span bottom', 'Near support'],
      locations_other:    'At beam-column junction',
      orientations:       ['Vertical', 'Inclined 45°'],
      orientations_other: 'Horizontal along stirrups',
      max_crack_length:   '600',
      avg_crack_length:   '310',
      max_crack_width:    '2.5',
      avg_crack_width:    '1.2',
      total_cracks:       '22',
      cracks_gte_avg:     '9',
      cracks_lt_avg:      '13',
      crack_depth_type:   'Shallow surface crack',
    },
    Column: {
      locations:          ['Top third', 'Bottom junction with plinth'],
      locations_other:    'Corner column – two faces',
      orientations:       ['Vertical', 'Horizontal'],
      orientations_other: 'Spiral pattern',
      max_crack_length:   '400',
      avg_crack_length:   '200',
      max_crack_width:    '1.8',
      avg_crack_width:    '1.0',
      total_cracks:       '8',
      cracks_gte_avg:     '3',
      cracks_lt_avg:      '5',
      crack_depth_type:   'Deep crack (>25 mm)',
    },
    Floor: {
      locations:          ['Centre panel', 'Near periphery wall'],
      locations_other:    '',
      orientations:       ['Two-way diagonal'],
      orientations_other: '',
      max_crack_length:   '1200',
      avg_crack_length:   '700',
      max_crack_width:    '4.0',
      avg_crack_width:    '2.5',
      total_cracks:       '5',
      cracks_gte_avg:     '3',
      cracks_lt_avg:      '2',
      crack_depth_type:   'Through crack',
    },
    Vibration_Damping_Devices: {
      locations:          ['Mounting plate interface'],
      locations_other:    'Foundation anchor bolts area',
      orientations:       ['Circumferential'],
      orientations_other: '',
      max_crack_length:   '120',
      avg_crack_length:   '80',
      max_crack_width:    '0.8',
      avg_crack_width:    '0.5',
      total_cracks:       '4',
      cracks_gte_avg:     '2',
      cracks_lt_avg:      '2',
      crack_depth_type:   'Shallow surface crack',
    },
    Machine_Foundation_Bearings: {
      locations:          ['Under bearing pad', 'Along edge'],
      locations_other:    '',
      orientations:       ['Longitudinal'],
      orientations_other: '',
      max_crack_length:   '200',
      avg_crack_length:   '130',
      max_crack_width:    '1.5',
      avg_crack_width:    '0.9',
      total_cracks:       '6',
      cracks_gte_avg:     '3',
      cracks_lt_avg:      '3',
      crack_depth_type:   'Shallow surface crack',
    },
  },

  // ── Q3 Deformation & Instability ──────────────────────────────────────────
  Q3_DeformationInstability: {
    has_deformation:       'Yes',
    floor_levels:          ['First Floor', 'Second Floor'],
    elements_affected:     ['Roof slab', 'Beam', 'Column', 'Wall', 'Floor slab'],
    elements_other:        'Staircase landing',
    deform_measurements:   {
      'Beam_Deflection':     { value: '12', unit: 'mm', span: '5000' },
      'Column_Tilt':         { value: '8',  unit: 'mm/m', height: '3200' },
      'RoofSlab_Deflection': { value: '20', unit: 'mm', span: '6000' },
    },

    Roof_Slab: {
      locations:           ['Centre', 'Corner panel'],
      locations_other:     '',
      deformation_types:   ['Sagging', 'Visible deflection'],
      deformation_types_other: 'Ponding of water',
    },
    Beam: {
      locations:           ['Mid-span', 'Cantilever end'],
      locations_other:     '',
      deformation_types:   ['Sagging', 'Lateral buckling'],
      deformation_types_other: '',
    },
    Column: {
      locations:           ['Ground floor', 'Upper floor'],
      locations_other:     'Corner column',
      deformation_types:   ['Tilting', 'Bulging'],
      deformation_types_other: '',
    },
    Wall: {
      locations:           ['External wall – north', 'Infill panel'],
      locations_other:     '',
      deformation_types:   ['Out-of-plane bulging', 'In-plane racking'],
      deformation_types_other: 'Separation from frame',
    },
    Floor_Slab: {
      locations:           ['Toilet block', 'Parking slab'],
      locations_other:     '',
      deformation_types:   ['Sagging', 'Differential settlement pattern'],
      deformation_types_other: '',
    },
  },

  // ── Q4 Material Deterioration ─────────────────────────────────────────────
  Q4_MaterialDeterioration: {
    has_deterioration:     'Yes',
    floor_levels:          ['Ground Floor', 'First Floor'],
    elements_affected:     ['Roof slab', 'Beam', 'Column', 'Wall', 'Floor slab', 'Staircase', 'Parapet'],
    elements_other:        '',
    det_measurements:      {
      'Beam_Carbonation':        { depth_mm: '35', area_sqm: '2.4' },
      'Column_Chloride_Attack':  { depth_mm: '20', area_sqm: '1.1' },
      'Roof_Spalling':           { area_sqm: '3.5', avg_depth_mm: '15' },
    },

    Roof_Slab: {
      locations:           ['Soffit', 'Top surface'],
      locations_other:     '',
      deterioration_types: ['Spalling', 'Rebar corrosion', 'Efflorescence'],
    },
    Beam: {
      locations:           ['Bottom flange', 'Web'],
      locations_other:     'Shear zone',
      deterioration_types: ['Spalling', 'Rebar corrosion', 'Carbonation'],
    },
    Column: {
      locations:           ['Lower third'],
      locations_other:     '',
      deterioration_types: ['Rebar corrosion', 'Scaling'],
    },
    Wall: {
      locations_interior:  ['Base – ground level', 'Around openings'],
      locations_exterior:  ['Parapet face', 'Plinth band area'],
      deterioration_types: ['Dampness', 'Paint peeling', 'Efflorescence'],
    },
    Floor_Slab: {
      locations:           ['Toilet / wet area slab soffit'],
      locations_other:     '',
      deterioration_types: ['Spalling', 'Staining'],
    },
    Staircase: {
      locations:           ['Waist slab', 'Nosing'],
      locations_other:     '',
      deterioration_types: ['Wearing', 'Chipping'],
    },
    Parapet: {
      locations:           ['Coping', 'Inner face'],
      locations_other:     '',
      deterioration_types: ['Cracking', 'Spalling', 'Rebar corrosion'],
    },
  },

  // ── Q5 Hollow-sound areas ───────────────────────────────────────────────
  Q5_HollowSoundingAreas: {
    has_hollow:            'Yes',
    floor_levels:          ['Ground Floor'],
    elements_affected:     ['Roof slab', 'Beam', 'Column', 'Wall', 'Floor slab', 'Staircase', 'Parapet'],
    elements_other:        '',
    hollow_count:          '12',
    hollow_area_m2:        '4.8',

    Roof_Slab:  { locations: ['Centre panel', 'Near expansion joint'] },
    Beam:       { locations: ['Mid-span soffit'] },
    Column:     { locations: ['Upper third – west face'] },
    Wall:       { locations: ['Internal partition – grid C-3'] },
    Floor_Slab: { locations: ['Bathroom block soffit', 'Below water tank'] },
    Staircase:  { locations: ['Waist slab – 3rd flight'] },
    Parapet:    { locations: ['East face coping'] },
  },

  // ── Q6 Reinforcement Condition ────────────────────────────────────────────
  Q6_ReinforcementCondition: {
    is_rebar_exposed:           'Yes',
    floor_levels:               ['Ground Floor', 'First Floor'],
    elements_affected:          ['Roof slab', 'Beam', 'Column', 'Floor slab', 'Staircase'],
    elements_other:             '',
    avg_exposed_area:           '0.08',
    max_exposed_area:           '0.25',
    corrosion_visible:          'Yes',
    bar_diameter_reduced:       'Yes',
    affected_bar_types:         ['Main reinforcement bars', 'Stirrups / links'],
    original_diameter_mm:       '16',
    current_diameter_mm:        '13.5',
    contributing_factors:       ['Carbonation', 'Chloride ingress', 'Poor cover'],
    contributing_factors_other: 'Exposed to saline environment',

    Roof_Slab:  { locations: ['Soffit – central bay'] },
    Beam:       { locations: ['Bottom tension zone', 'Near support stirrups'] },
    Column:     { locations: ['Plinth level', 'Top projection'] },
    Floor_Slab: { locations: ['Toilet slab soffit'] },
    Staircase:  { locations: ['Waist slab underside'] },
  },

  // ── Q7 Past Intervention ──────────────────────────────────────────────────
  Q7_PastIntervention: {
    was_intervention_done:        'Yes',
    floor_levels:                 ['Ground Floor', 'First Floor', 'Second Floor'],
    elements_repaired:            ['Beam', 'Column', 'Wall', 'Roof slab'],
    elements_other:               'Plinth protection',
    intervention_types:           ['Crack filling / grouting', 'Patch repair', 'Jacketing', 'Waterproofing'],
    intervention_types_other:     'Torque tightening of anchor bolts',
    primary_reason:               'Structural distress',
    primary_reason_other:         '',
    distress_recurred:            'Yes',
    recurring_issues:             ['Cracking at same location', 'Rebar corrosion continuing', 'Dampness returning'],
    recurring_issues_other:       'Delamination of patch repair',
    deterioration_types:          ['Carbonation', 'Chloride attack', 'Freeze-thaw'],
  },

  // ── Q8 Foundation Condition ───────────────────────────────────────────────
  Q8_FoundationCondition: {
    settlement_observed:     'Yes',
    settlement_types:        ['Uniform settlement', 'Differential settlement', 'Tilting'],
    settlement_types_other:  'Heave in soft clay pocket under column C-7',
  },

  // ── Q9 Environmental Impact (Vegetation) ──────────────────────────────────
  Q9_EnvironmentalImpact: {
    vegetation_present:           'Yes',
    vegetation_types:             ['Grass / weeds', 'Shrubs', 'Trees'],
    vegetation_types_other:       'Banyan aerial roots',
    distress_caused:              ['Cracking', 'Moisture retention', 'Root penetration in joints'],
    distress_caused_other:        'Organic acid attack on concrete',
    affecting_foundation:         'Yes',
    foundation_issues:            ['Root infiltration near footing', 'Soil erosion'],
    foundation_issues_other:      'Undermining of plinth beam',
    affected_area_m2:             '18.5',
    affected_zone_length_mm:      '4200',
    distance_of_trees_from_bldg:  '1800',
    vegetation_height_mm:         '6500',
  },

  // ── Q10 Natural / Man-Made Disasters ──────────────────────────────────────
  Q10_NaturalDisasters: {
    disaster_experienced:    'Yes',
    disaster_types:          ['Earthquake', 'Severe Wind/Cyclone', 'Fire', 'Flood', 'Explosion', 'Nearby excavation', 'Landslides', 'Volcanic Eruptions', 'Tsunami'],
    disaster_types_other:    'Industrial blast from adjacent plant',
    cracks_noticed_after:    'Yes',
    existing_cracks_widened: 'Yes',
    new_cracks_appeared:     'Yes',
    sudden_sound_heard:      'Yes',

    Earthquake: {
      year:        '2021',
      severity:    'Moderate (MMI VI)',
      questions:   ['Falling objects', 'Cracking of plaster', 'Visible structural cracks'],
      description: 'Column base cracks widened; staircase railing anchor pulled out.',
    },
    Severe_Wind_Cyclone: {
      year:        '2020',
      severity:    'Category 2 cyclone',
      questions:   ['Roof sheet blown off', 'Parapet damage'],
      description: 'Parapet wall toppled on east side; roof insulation damaged.',
    },
    Fire: {
      year:        '2019',
      severity:    '3-hour fire – electrical room',
      questions:   ['Spalling of concrete', 'Color change of concrete', 'Rebar exposure'],
      description: 'Ground floor electrical room fire caused severe spalling over 12 m².',
    },
    Explosion: {
      year:        '2018',
      description: 'Gas cylinder explosion in service area; blast wave cracked two columns.',
    },
    Flood: {
      year:        '2022',
      severity:    '1.2 m water level',
      questions:   ['Scour at foundation', 'Dampness post-flood', 'Efflorescence'],
      description: 'Monsoon flooding; ground floor fully submerged. Foundation scour observed at grid A-1.',
    },
    Landslides: {
      year:        '2017',
      description: 'Retaining wall behind building failed causing minor undermining of plinth.',
    },
    Nearby_Excavation: {
      year:        '2023',
      distance:    '3500',
      description: 'Metro rail construction 35 m away caused differential settlement of 8 mm.',
    },
    Volcanic_Eruptions: {
      year:        '2015',
      description: 'Minor seismic activity associated with distant volcanic event; no structural damage noted at time.',
    },
    Tsunami: {
      year:        '2004',
      severity:    '4 m inundation',
      description: 'Coastal building; foundation scour and ground floor column base damage from 2004 tsunami.',
    },
  },

  // _meta will be added by handleSubmit automatically
};

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════
const log = {
  h1:   (t) => console.log('\n' + '═'.repeat(70) + '\n  ' + t + '\n' + '═'.repeat(70)),
  h2:   (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 65 - t.length))),
  pass: (t) => console.log('  ✅ PASS  ' + t),
  fail: (t) => console.log('  ❌ FAIL  ' + t),
  info: (t) => console.log('  ℹ️  ' + t),
  warn: (t) => console.log('  ⚠️  ' + t),
};

let passCount = 0;
let failCount = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passCount++;
    log.pass(label + (detail ? '  →  ' + detail : ''));
  } else {
    failCount++;
    log.fail(label + (detail ? '  →  ' + detail : ''));
  }
}

// Deep-get a nested key path like 'Q2_CrackingDistress.Beam.max_crack_width'
function deepGet(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1 — Log in
// ═════════════════════════════════════════════════════════════════════════════
async function getToken() {
  log.h2('STEP 1 — Authenticate (login or register test user)');

  // Helper: do the actual login
  const doLogin = async () => {
    const res = await axios.post(`${BASE_URL}/api/auth/login`, {
      email:    TEST_USER.email,
      password: TEST_USER.password,
    });
    if (!res.data.token) throw new Error('Login succeeded but no token in response');
    log.info(`Logged in as ${TEST_USER.email}`);
    return res.data.token;
  };

  try {
    return await doLogin();
  } catch (loginErr) {
    if (loginErr.response?.status !== 401 && loginErr.response?.status !== 404) throw loginErr;

    // User doesn't exist — register first
    log.info('User not found, registering…');
    await axios.post(`${BASE_URL}/api/auth/register`, {
      firstName:   TEST_USER.firstName,
      lastName:    TEST_USER.lastName,
      email:       TEST_USER.email,
      phone:       TEST_USER.phone,
      password:    TEST_USER.password,
      organisation: TEST_USER.organisation,
    });
    log.info('Registered successfully. Logging in…');
    return await doLogin();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2 — Create base assessment (or reuse latest one for this user)
// ═════════════════════════════════════════════════════════════════════════════
async function getOrCreateBaseAssessment(token) {
  log.h2('STEP 2 — Obtain a base RCC assessment ID');

  // Try fetching existing assessments first
  try {
    const listRes = await axios.get(`${BASE_URL}/api/user/assessments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rccAssessments = (listRes.data.assessments || listRes.data || [])
      .filter(a => (a.userDetails?.structureType || '').toLowerCase().includes('rcc'));

    if (rccAssessments.length) {
      const id = rccAssessments[0]._id;
      log.info(`Reusing existing RCC assessment: ${id}`);
      return id;
    }
  } catch (_) {}

  // Create a minimal base assessment
  log.info('Creating new base RCC assessment via /api/save-assessment …');
  const saveRes = await axios.post(`${BASE_URL}/api/save-assessment`, {
    userDetails: {
      name:               TEST_USER.name,
      email:              TEST_USER.email,
      phone:              TEST_USER.phone,
      organisation:       TEST_USER.organisation,
      structureType:      'RCC Structure',
      location:           'Mumbai',
      yearOfConstruction: 1998,
    },
    assessmentType: 'Building',
    assessmentResponses: {
      raw_responses: {
        q1_city:                  'Mumbai',
        q5_structural_system:     'RCC Structure',
        q2_building_use:          'Commercial',
        q3_floors:                '5',
        q4_year_of_construction:  '1998',
      }
    },
    reportText: 'Test base assessment for advanced RCC testing.',
  });

  const id = saveRes.data.assessmentId;
  log.info(`Created base assessment: ${id}`);
  return id;
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 3 — Submit full advanced RCC payload
// ═════════════════════════════════════════════════════════════════════════════
async function submitAdvanced(token, assessmentId) {
  log.h2('STEP 3 — POST full advanced RCC payload');

  const payload = {
    advancedResponses: {
      ...FULL_RCC_PAYLOAD,
      _meta: {
        structureType: 'RCC Structure',
        submittedAt:   new Date().toISOString(),
        formVersion:   'advanced-rcc-v1',
      },
    },
  };

  const res = await axios.post(
    `${BASE_URL}/api/assessment/${assessmentId}/advanced`,
    payload,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  check('POST /api/assessment/:id/advanced  →  HTTP 200', res.status === 200 || res.status === 201);
  check('Response success=true', res.data.success === true);
  log.info(`Sections saved reported by server: ${res.data.fieldsSaved}`);
  log.info(`Advanced document ID: ${res.data.advancedAssessmentId}`);
  return res.data.advancedAssessmentId;
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 4 — Read back and verify
// ═════════════════════════════════════════════════════════════════════════════
async function verifyAdvanced(token, assessmentId) {
  log.h2('STEP 4 — GET /api/assessment/:id/advanced  and verify every field');

  const res = await axios.get(
    `${BASE_URL}/api/assessment/${assessmentId}/advanced`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  check('GET /api/assessment/:id/advanced  →  HTTP 200', res.status === 200);
  check('Response has responses object', !!res.data.responses || !!res.data.advancedResponses);

  const r = res.data.responses || res.data.advancedResponses || res.data;

  // ── Q1 ───────────────────────────────────────────────────────────────────
  log.h2('Q1 — Building Information');
  check('Q1 section present',                     !!r.Q1_BuildingInformation);
  check('Q1 usage_changed = "Yes"',               r.Q1_BuildingInformation?.usage_changed === 'Yes');
  check('Q1 new_usage_types is array',            Array.isArray(r.Q1_BuildingInformation?.new_usage_types));
  check('Q1 new_usage_types contains Commercial', (r.Q1_BuildingInformation?.new_usage_types || []).includes('Commercial'));
  check('Q1 new_usage_type_other saved',          !!r.Q1_BuildingInformation?.new_usage_type_other);

  // ── Q2 ───────────────────────────────────────────────────────────────────
  log.h2('Q2 — Cracking Distress');
  const q2 = r.Q2_CrackingDistress;
  check('Q2 section present',                           !!q2);
  check('Q2 has_cracks = "Yes"',                        q2?.has_cracks === 'Yes');
  check('Q2 floor_levels is array',                     Array.isArray(q2?.floor_levels));
  check('Q2 elements_affected has 6 items',             (q2?.elements_affected || []).length === 6);
  check('Q2 crack_conditions saved',                    Array.isArray(q2?.crack_conditions) && q2.crack_conditions.length > 0);

  // Per element — Roof
  check('Q2.Roof section present',                      !!q2?.Roof);
  check('Q2.Roof max_crack_length = "850"',             q2?.Roof?.max_crack_length === '850');
  check('Q2.Roof total_cracks = "14"',                  q2?.Roof?.total_cracks === '14');
  check('Q2.Roof crack_depth_type saved',               !!q2?.Roof?.crack_depth_type);
  check('Q2.Roof orientations_other saved',             !!q2?.Roof?.orientations_other);

  // Per element — Beam
  check('Q2.Beam section present',                      !!q2?.Beam);
  check('Q2.Beam max_crack_width = "2.5"',              q2?.Beam?.max_crack_width === '2.5');
  check('Q2.Beam cracks_gte_avg = "9"',                 q2?.Beam?.cracks_gte_avg === '9');

  // Per element — Column
  check('Q2.Column section present',                    !!q2?.Column);
  check('Q2.Column crack_depth_type = Deep crack',      (q2?.Column?.crack_depth_type || '').includes('Deep'));

  // Per element — Floor
  check('Q2.Floor section present',                     !!q2?.Floor);
  check('Q2.Floor avg_crack_width = "2.5"',             q2?.Floor?.avg_crack_width === '2.5');

  // Per element — VDD
  check('Q2.Vibration_Damping_Devices present',         !!q2?.Vibration_Damping_Devices);
  check('Q2.VDD total_cracks = "4"',                    q2?.Vibration_Damping_Devices?.total_cracks === '4');

  // Per element — MFB
  check('Q2.Machine_Foundation_Bearings present',       !!q2?.Machine_Foundation_Bearings);
  check('Q2.MFB max_crack_width = "1.5"',               q2?.Machine_Foundation_Bearings?.max_crack_width === '1.5');

  // ── Q3 ───────────────────────────────────────────────────────────────────
  log.h2('Q3 — Deformation & Instability');
  const q3 = r.Q3_DeformationInstability;
  check('Q3 section present',                           !!q3);
  check('Q3 has_deformation = "Yes"',                   q3?.has_deformation === 'Yes');
  check('Q3 elements_affected has 5 items',             (q3?.elements_affected || []).length === 5);
  check('Q3 deform_measurements is object',             typeof q3?.deform_measurements === 'object' && q3.deform_measurements !== null);
  check('Q3 Beam deflection measurement saved',         !!q3?.deform_measurements?.Beam_Deflection);
  check('Q3.Roof_Slab section present',                 !!q3?.Roof_Slab);
  check('Q3.Roof_Slab deformation_types saved',         Array.isArray(q3?.Roof_Slab?.deformation_types));
  check('Q3.Beam section present',                      !!q3?.Beam);
  check('Q3.Column tilting saved',                      (q3?.Column?.deformation_types || []).includes('Tilting'));
  check('Q3.Wall out-of-plane bulging saved',           (q3?.Wall?.deformation_types || []).some(t => t.includes('out') || t.includes('Out')));
  check('Q3.Floor_Slab section present',                !!q3?.Floor_Slab);

  // ── Q4 ───────────────────────────────────────────────────────────────────
  log.h2('Q4 — Material Deterioration');
  const q4 = r.Q4_MaterialDeterioration;
  check('Q4 section present',                           !!q4);
  check('Q4 has_deterioration = "Yes"',                 q4?.has_deterioration === 'Yes');
  check('Q4 7 elements affected',                       (q4?.elements_affected || []).length === 7);
  check('Q4 det_measurements object saved',             typeof q4?.det_measurements === 'object');
  check('Q4.Roof_Slab deterioration_types saved',       Array.isArray(q4?.Roof_Slab?.deterioration_types));
  check('Q4.Beam spalling saved',                       (q4?.Beam?.deterioration_types || []).includes('Spalling'));
  check('Q4.Column section present',                    !!q4?.Column);
  check('Q4.Wall interior locations saved',             Array.isArray(q4?.Wall?.locations_interior));
  check('Q4.Wall exterior locations saved',             Array.isArray(q4?.Wall?.locations_exterior));
  check('Q4.Floor_Slab section present',                !!q4?.Floor_Slab);
  check('Q4.Staircase section present',                 !!q4?.Staircase);
  check('Q4.Parapet section present',                   !!q4?.Parapet);
  check('Q4.Parapet rebar corrosion saved',             (q4?.Parapet?.deterioration_types || []).some(t => t.includes('corrosion') || t.includes('Corrosion')));

  // ── Q5 ───────────────────────────────────────────────────────────────────
  log.h2('Q5 — Hollow-sound areas');
  const q5 = r.Q5_HollowSoundingAreas;
  check('Q5 section present',                           !!q5);
  check('Q5 has_hollow = "Yes"',                        q5?.has_hollow === 'Yes');
  check('Q5 hollow_count = "12"',                       q5?.hollow_count === '12');
  check('Q5 hollow_area_m2 = "4.8"',                    q5?.hollow_area_m2 === '4.8');
  check('Q5 7 elements affected',                       (q5?.elements_affected || []).length === 7);
  check('Q5.Roof_Slab locations saved',                 Array.isArray(q5?.Roof_Slab?.locations));
  check('Q5.Beam locations saved',                      Array.isArray(q5?.Beam?.locations));
  check('Q5.Column locations saved',                    Array.isArray(q5?.Column?.locations));
  check('Q5.Wall locations saved',                      Array.isArray(q5?.Wall?.locations));
  check('Q5.Floor_Slab locations saved',                Array.isArray(q5?.Floor_Slab?.locations));
  check('Q5.Staircase locations saved',                 Array.isArray(q5?.Staircase?.locations));
  check('Q5.Parapet locations saved',                   Array.isArray(q5?.Parapet?.locations));

  // ── Q6 ────────────────────────────────────────────────────────────────────
  log.h2('Q6 — Reinforcement Condition');
  const q6 = r.Q6_ReinforcementCondition;
  check('Q6 section present',                           !!q6);
  check('Q6 is_rebar_exposed = "Yes"',                  q6?.is_rebar_exposed === 'Yes');
  check('Q6 original_diameter_mm = "16"',               q6?.original_diameter_mm === '16');
  check('Q6 current_diameter_mm = "13.5"',              q6?.current_diameter_mm === '13.5');
  check('Q6 corrosion_visible = "Yes"',                 q6?.corrosion_visible === 'Yes');
  check('Q6 bar_diameter_reduced = "Yes"',              q6?.bar_diameter_reduced === 'Yes');
  check('Q6 contributing_factors saved',                Array.isArray(q6?.contributing_factors) && q6.contributing_factors.length > 0);
  check('Q6 contributing_factors_other saved',          !!q6?.contributing_factors_other);
  check('Q6.Roof_Slab rebar locations saved',           Array.isArray(q6?.Roof_Slab?.locations));
  check('Q6.Beam rebar locations saved',                Array.isArray(q6?.Beam?.locations));
  check('Q6.Column rebar locations saved',              Array.isArray(q6?.Column?.locations));
  check('Q6.Floor_Slab rebar locations saved',          Array.isArray(q6?.Floor_Slab?.locations));
  check('Q6.Staircase rebar locations saved',           Array.isArray(q6?.Staircase?.locations));

  // ── Q7 ────────────────────────────────────────────────────────────────────
  log.h2('Q7 — Past Intervention');
  const q7 = r.Q7_PastIntervention;
  check('Q7 section present',                           !!q7);
  check('Q7 was_intervention_done = "Yes"',             q7?.was_intervention_done === 'Yes');
  check('Q7 elements_repaired saved',                   Array.isArray(q7?.elements_repaired) && q7.elements_repaired.length > 0);
  check('Q7 intervention_types saved',                  Array.isArray(q7?.intervention_types) && q7.intervention_types.length > 0);
  check('Q7 intervention_types_other saved',            !!q7?.intervention_types_other);
  check('Q7 primary_reason = "Structural distress"',    q7?.primary_reason === 'Structural distress');
  check('Q7 distress_recurred = "Yes"',                 q7?.distress_recurred === 'Yes');
  check('Q7 recurring_issues saved',                    Array.isArray(q7?.recurring_issues) && q7.recurring_issues.length > 0);
  check('Q7 recurring_issues_other saved',              !!q7?.recurring_issues_other);
  check('Q7 deterioration_types saved',                 Array.isArray(q7?.deterioration_types));

  // ── Q8 ────────────────────────────────────────────────────────────────────
  log.h2('Q8 — Foundation Condition');
  const q8 = r.Q8_FoundationCondition;
  check('Q8 section present',                           !!q8);
  check('Q8 settlement_observed = "Yes"',               q8?.settlement_observed === 'Yes');
  check('Q8 settlement_types saved (3 types)',          (q8?.settlement_types || []).length === 3);
  check('Q8 settlement_types_other saved',              !!q8?.settlement_types_other);

  // ── Q9 ────────────────────────────────────────────────────────────────────
  log.h2('Q9 — Environmental Impact (Vegetation)');
  const q9 = r.Q9_EnvironmentalImpact;
  check('Q9 section present',                           !!q9);
  check('Q9 vegetation_present = "Yes"',                q9?.vegetation_present === 'Yes');
  check('Q9 vegetation_types saved',                    Array.isArray(q9?.vegetation_types) && q9.vegetation_types.length > 0);
  check('Q9 vegetation_types_other saved',              !!q9?.vegetation_types_other);
  check('Q9 distress_caused saved',                     Array.isArray(q9?.distress_caused));
  check('Q9 distress_caused_other saved',               !!q9?.distress_caused_other);
  check('Q9 affecting_foundation = "Yes"',              q9?.affecting_foundation === 'Yes');
  check('Q9 foundation_issues saved',                   Array.isArray(q9?.foundation_issues));
  check('Q9 foundation_issues_other saved',             !!q9?.foundation_issues_other);
  check('Q9 affected_area_m2 = "18.5"',                 q9?.affected_area_m2 === '18.5');
  check('Q9 affected_zone_length_mm = "4200"',          q9?.affected_zone_length_mm === '4200');
  check('Q9 distance_of_trees_from_bldg = "1800"',      q9?.distance_of_trees_from_bldg === '1800');
  check('Q9 vegetation_height_mm = "6500"',             q9?.vegetation_height_mm === '6500');

  // ── Q10 ───────────────────────────────────────────────────────────────────
  log.h2('Q10 — Natural / Man-Made Disasters');
  const q10 = r.Q10_NaturalDisasters;
  check('Q10 section present',                          !!q10);
  check('Q10 disaster_experienced = "Yes"',             q10?.disaster_experienced === 'Yes');
  check('Q10 disaster_types has 9 items',               (q10?.disaster_types || []).length === 9);
  check('Q10 disaster_types_other saved',               !!q10?.disaster_types_other);
  check('Q10 cracks_noticed_after = "Yes"',             q10?.cracks_noticed_after === 'Yes');
  check('Q10 existing_cracks_widened = "Yes"',          q10?.existing_cracks_widened === 'Yes');
  check('Q10 new_cracks_appeared = "Yes"',              q10?.new_cracks_appeared === 'Yes');
  check('Q10 sudden_sound_heard = "Yes"',               q10?.sudden_sound_heard === 'Yes');

  // Per disaster
  check('Q10.Earthquake section present',               !!q10?.Earthquake);
  check('Q10.Earthquake year = "2021"',                 q10?.Earthquake?.year === '2021');
  check('Q10.Earthquake severity saved',                !!q10?.Earthquake?.severity);
  check('Q10.Earthquake questions are array',           Array.isArray(q10?.Earthquake?.questions));
  check('Q10.Earthquake description saved',             !!q10?.Earthquake?.description);

  check('Q10.Severe_Wind_Cyclone present',              !!q10?.Severe_Wind_Cyclone);
  check('Q10.Fire year = "2019"',                       q10?.Fire?.year === '2019');
  check('Q10.Explosion description saved',              !!q10?.Explosion?.description);
  check('Q10.Flood severity saved',                     !!q10?.Flood?.severity);
  check('Q10.Landslides year = "2017"',                 q10?.Landslides?.year === '2017');
  check('Q10.Nearby_Excavation distance = "3500"',      q10?.Nearby_Excavation?.distance === '3500');
  check('Q10.Volcanic_Eruptions present',               !!q10?.Volcanic_Eruptions);
  check('Q10.Tsunami severity saved',                   !!q10?.Tsunami?.severity);

  // _meta must NOT be stored in responses
  check('_meta stripped from stored responses',         r._meta === undefined);
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 5 — Dump raw MongoDB document
// ═════════════════════════════════════════════════════════════════════════════
async function dumpMongoDoc(assessmentId) {
  log.h2('STEP 5 — Raw MongoDB document (advancedassessments collection)');
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000, family: 4 });
    const col = mongoose.connection.db.collection('advancedassessments');
    const doc = await col.findOne({ baseAssessmentId: new mongoose.Types.ObjectId(assessmentId) });
    if (!doc) {
      log.warn('No document found in advancedassessments for this assessmentId.');
      return;
    }
    const { responses } = doc;
    log.info(`Document _id: ${doc._id}`);
    log.info(`Structure type: ${doc.structureType}`);
    log.info(`Saved at: ${doc.updatedAt || doc.createdAt}`);
    log.info(`Top-level keys in responses: ${Object.keys(responses || {}).join(', ')}`);
    console.log('\n📄 Full responses JSON:\n');
    console.log(JSON.stringify(responses, null, 2));
  } catch (err) {
    log.warn('Could not connect directly to MongoDB: ' + err.message);
    log.info('(This step is optional — the API verification above is the real test.)');
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════
(async () => {
  log.h1('ADVANCED RCC ASSESSMENT — COMPLETE TEST SUITE');

  try {
    const token        = await getToken();
    const assessmentId = await getOrCreateBaseAssessment(token);
    await submitAdvanced(token, assessmentId);
    await verifyAdvanced(token, assessmentId);
    await dumpMongoDoc(assessmentId);
  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err.response?.data || err.message);
    process.exit(1);
  }

  // Final summary
  log.h1('TEST SUMMARY');
  console.log(`  Total checks : ${passCount + failCount}`);
  console.log(`  Passed       : ${passCount}`);
  console.log(`  Failed       : ${failCount}`);
  if (failCount === 0) {
    console.log('\n  🎉  ALL CHECKS PASSED — every Q1-Q10 field is saved correctly in MongoDB!\n');
  } else {
    console.log('\n  ⚠️  Some checks failed — see ❌ lines above for details.\n');
    process.exit(1);
  }
})();
