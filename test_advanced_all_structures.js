/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ADVANCED ASSESSMENT — ALL STRUCTURE TYPES TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Tests every field of all four advanced assessment structures:
 *   1. Steel Structure
 *   2. Composite Structure (RCC + Steel)
 *   3. Heritage Building
 *   4. Load Bearing Masonry
 *
 * Each test:
 *  • Creates a base assessment of the right type
 *  • POSTs a fully-filled payload to POST /api/assessment/:id/advanced
 *  • GETs it back via GET /api/assessment/:id/advanced
 *  • Verifies every Q section and sub-field is actually stored
 *  • Prints a full pass/fail breakdown per question
 *
 * RUN:  node test_advanced_all_structures.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const axios    = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const BASE_URL  = process.env.TEST_API_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGODB_URI  || 'mongodb://localhost:27017/osham_assessments';

// ── Shared test credentials ────────────────────────────────────────────────────
const TEST_USER = {
  firstName:    'AllStruct',
  lastName:     'Tester',
  email:        'all_struct_test@osham.test',
  phone:        '9898989898',
  password:     'TestPass@123',
  organisation: 'SPPL QA Lab',
  get name()   { return `${this.firstName} ${this.lastName}`; }
};

// ─────────────────────────────────────────────────────────────────────────────
// Console helpers
// ─────────────────────────────────────────────────────────────────────────────
const log = {
  h1:   (t) => console.log('\n' + '═'.repeat(70) + '\n  ' + t + '\n' + '═'.repeat(70)),
  h2:   (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 65 - t.length))),
  pass: (t) => console.log('  ✅  ' + t),
  fail: (t) => console.log('  ❌  ' + t),
  info: (t) => console.log('  ℹ️   ' + t),
  warn: (t) => console.log('  ⚠️   ' + t),
};

let totalPass = 0, totalFail = 0;
const sectionResults = {};

function check(section, label, condition, detail = '') {
  if (!sectionResults[section]) sectionResults[section] = { pass: 0, fail: 0 };
  if (condition) {
    sectionResults[section].pass++;
    totalPass++;
    log.pass(label + (detail ? '  →  ' + detail : ''));
  } else {
    sectionResults[section].fail++;
    totalFail++;
    log.fail(label + (detail ? '  →  ' + detail : ''));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH + BASE ASSESSMENT HELPERS
// ═════════════════════════════════════════════════════════════════════════════
let _token = null;

async function getToken() {
  if (_token) return _token;
  const doLogin = async () => {
    const r = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: TEST_USER.email, password: TEST_USER.password
    });
    return r.data.token;
  };
  try {
    _token = await doLogin();
  } catch (_) {
    await axios.post(`${BASE_URL}/api/auth/register`, {
      firstName:    TEST_USER.firstName,
      lastName:     TEST_USER.lastName,
      email:        TEST_USER.email,
      phone:        TEST_USER.phone,
      password:     TEST_USER.password,
      organisation: TEST_USER.organisation,
    });
    _token = await doLogin();
  }
  log.info(`Authenticated as ${TEST_USER.email}`);
  return _token;
}

async function createBaseAssessment(token, structureType, location) {
  const res = await axios.post(`${BASE_URL}/api/save-assessment`, {
    userDetails: {
      name: TEST_USER.name, email: TEST_USER.email,
      phone: TEST_USER.phone, organisation: TEST_USER.organisation,
      structureType, location: location || 'Chennai', yearOfConstruction: 2005,
    },
    assessmentType: 'Building',
    assessmentResponses: {
      raw_responses: { q1_city: location || 'Chennai', q5_structural_system: structureType }
    },
    reportText: `Test base for ${structureType}`,
  });
  return res.data.assessmentId;
}

async function submitAndFetch(token, assessmentId, advancedResponses) {
  const postRes = await axios.post(
    `${BASE_URL}/api/assessment/${assessmentId}/advanced`,
    { advancedResponses },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  const getRes = await axios.get(
    `${BASE_URL}/api/assessment/${assessmentId}/advanced`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return { post: postRes.data, get: getRes.data };
}

// ═════════════════════════════════════════════════════════════════════════════
//  ███████ ████████ ███████ ███████ ██
//  ██         ██    ██      ██      ██
//  ███████    ██    █████   █████   ██
//       ██    ██    ██      ██      ██
//  ███████    ██    ███████ ███████ ███████
// ═════════════════════════════════════════════════════════════════════════════
const STEEL_PAYLOAD = {
  _meta: { structureType: 'Steel structure', submittedAt: new Date().toISOString(), formVersion: 'advanced-steel-v1' },

  // Q1 — Usage Change
  q1_steel_adv_usage_changed:        'Yes',
  q1_steel_adv_previous_usage:       ['Warehouse', 'Industrial'],
  q1_steel_adv_previous_usage_other: 'Cold storage before conversion',

  // Q2 — Steel System Information
  q2_steel_adv_structural_system:       'Portal frame structure',
  q2_steel_adv_structural_system_other: '',
  q2_steel_adv_section_types:          ['I-section', 'H-section', 'Box section (RHS / SHS)', 'Circular Hollow Section / Pipe Section (CHS)'],
  q2_steel_adv_section_types_other:    'Tapered welded plate girder',

  // Q3 — Cracks
  q3_steel_adv_has_cracks:             'Yes',
  q3_steel_adv_crack_floor_levels:     ['Ground Floor', 'Mezzanine Level'],
  q3_steel_adv_crack_elements:         ['Beams', 'Columns', 'Steel connections (welded/bolted/riveted)', 'Bracing members'],

  // Beams
  q3_steel_adv_beams_locations:        ['At mid-span of the beam', 'Near connections (bolted/welded)'],
  q3_steel_adv_beams_locations_other:  'At web cutout',
  q3_steel_adv_beams_orientations:     ['Vertical', 'Diagonal'],
  q3_steel_adv_beams_orientations_other: '',
  q3_steel_adv_beams_max_crack_length: '320',
  q3_steel_adv_beams_avg_crack_length: '180',
  q3_steel_adv_beams_max_crack_width:  '2.4',
  q3_steel_adv_beams_avg_crack_width:  '1.2',
  q3_steel_adv_beams_total_cracks:     '8',
  q3_steel_adv_beams_cracks_gte_avg:   '3',
  q3_steel_adv_beams_cracks_lt_avg:    '5',
  q3_steel_adv_beams_crack_depth_type: 'Through (same crack visible from opposite side)',

  // Columns
  q3_steel_adv_columns_locations:        ['At base plate level', 'At splice locations'],
  q3_steel_adv_columns_locations_other:  '',
  q3_steel_adv_columns_orientations:     ['Horizontal', 'Diagonal'],
  q3_steel_adv_columns_orientations_other: '',
  q3_steel_adv_columns_max_crack_length: '220',
  q3_steel_adv_columns_avg_crack_length: '130',
  q3_steel_adv_columns_max_crack_width:  '1.8',
  q3_steel_adv_columns_avg_crack_width:  '1.0',
  q3_steel_adv_columns_total_cracks:     '5',
  q3_steel_adv_columns_cracks_gte_avg:   '2',
  q3_steel_adv_columns_cracks_lt_avg:    '3',
  q3_steel_adv_columns_crack_depth_type: 'Deep',

  // Connections
  q3_steel_adv_connections_locations:        ['At welded joints', 'Around bolt holes'],
  q3_steel_adv_connections_locations_other:  '',
  q3_steel_adv_connections_orientations:     ['Diagonal'],
  q3_steel_adv_connections_orientations_other: '',
  q3_steel_adv_connections_max_crack_length: '80',
  q3_steel_adv_connections_avg_crack_length: '50',
  q3_steel_adv_connections_max_crack_width:  '1.0',
  q3_steel_adv_connections_avg_crack_width:  '0.6',
  q3_steel_adv_connections_total_cracks:     '12',
  q3_steel_adv_connections_cracks_gte_avg:   '5',
  q3_steel_adv_connections_cracks_lt_avg:    '7',
  q3_steel_adv_connections_crack_depth_type: 'Surface crack',

  // Bracing
  q3_steel_adv_bracing_locations:        ['At end connections', 'At mid-length'],
  q3_steel_adv_bracing_locations_other:  '',
  q3_steel_adv_bracing_orientations:     ['Diagonal'],
  q3_steel_adv_bracing_orientations_other: '',
  q3_steel_adv_bracing_max_crack_length: '150',
  q3_steel_adv_bracing_avg_crack_length: '90',
  q3_steel_adv_bracing_max_crack_width:  '1.5',
  q3_steel_adv_bracing_avg_crack_width:  '0.8',
  q3_steel_adv_bracing_total_cracks:     '4',
  q3_steel_adv_bracing_cracks_gte_avg:   '2',
  q3_steel_adv_bracing_cracks_lt_avg:    '2',
  q3_steel_adv_bracing_crack_depth_type: 'Deep',

  // Q4 — Deformation / Instability
  q4_steel_adv_deformation_has:          'Yes',
  q4_steel_adv_deformation_floor_levels: ['Ground Floor', 'First Floor'],
  q4_steel_adv_deformation_elements:     ['Beams', 'Columns', 'Bracing members'],
  q4_steel_adv_deformation_types:        ['Lateral buckling', 'Local plate buckling', 'Tilting'],

  // Q5 — Material Deterioration
  q5_steel_adv_deterioration_has:          'Yes',
  q5_steel_adv_deterioration_floor_levels: ['Ground Floor'],
  q5_steel_adv_deterioration_elements:     ['Beams', 'Connections', 'Roof'],
  q5_steel_adv_deterioration_types:        ['Corrosion / rusting', 'Loss of cross-section', 'Paint failure', 'Pitting'],

  // Q6 — Age and Maintenance
  q6_steel_adv_building_age:           '22',
  q6_steel_adv_maintenance_frequency:  'Annually',
  q6_steel_adv_last_maintenance:       '2024',

  // Q7 — Past Intervention
  q7_steel_adv_past_intervention:             'Yes',
  q7_steel_adv_past_floor_levels:             ['Ground Floor', 'Mezzanine Level'],
  q7_steel_adv_past_elements:                 ['Beams', 'Columns', 'Connections'],
  q7_steel_adv_past_elements_other:           'Gantry girder',
  q7_steel_adv_past_intervention_types:       ['Re-painting / protective coating', 'Weld repair', 'Bolted plate repair'],
  q7_steel_adv_past_intervention_types_other: 'Post-tensioned external plate',
  q7_steel_adv_past_primary_reason:           'Corrosion damage',
  q7_steel_adv_past_primary_reason_other:     '',
  q7_steel_adv_past_intervention_year:        '2020',
  q7_steel_adv_past_distress_again:           'Yes',
  q7_steel_adv_past_recurring_issues:         ['Corrosion resuming', 'Paint blistering'],
  q7_steel_adv_past_recurring_issues_other:   'Bolt loosening under vibration',

  // Q8 — Foundation Condition
  q8_steel_adv_settlement_has:          'Yes',
  q8_steel_adv_settlement_types:        ['Differential settlement', 'Base plate levelling issues'],
  q8_steel_adv_settlement_types_other:  'Anchor bolt elongation',

  // Q9 — Environmental Impact (Lateral Sway)
  q9_steel_adv_lateral_sway:               'Yes',
  q9_steel_adv_sway_nature:                ['Unidirectional', 'Oscillatory'],
  q9_steel_adv_sway_nature_other:          '',
  q9_steel_adv_structure_height:           '18500',
  q9_steel_adv_max_lateral_displacement:   '45',

  // Q10 — Natural Disasters
  q10_steel_adv_disaster_has:                    'Yes',
  q10_steel_adv_disaster_types:                  ['Earthquake', 'Severe Wind/Cyclone', 'Fire', 'Flood'],
  q10_steel_adv_disaster_date:                   '2022-09',
  q10_steel_adv_disaster_duration_hrs:           '4',
  q10_steel_adv_disaster_duration_days:          '',
  q10_steel_adv_disaster_sound_heard:            'Yes',
  q10_steel_adv_disaster_cracks_widen:           'Yes',
  q10_steel_adv_disaster_cracks_new:             'Yes',
  q10_steel_adv_disaster_deformation_increase:   'Yes',
  q10_steel_adv_disaster_deformation_new:        'No',
  q10_steel_adv_disaster_deterioration_increase: 'Yes',
  q10_steel_adv_disaster_deterioration_new:      'No',
};

async function testSteel() {
  log.h1('TEST 1 — STEEL STRUCTURE ADVANCED ASSESSMENT');
  const SEC = 'Steel';
  const token = await getToken();
  const asmId = await createBaseAssessment(token, 'Steel structure', 'Pune');
  log.info(`Base assessment ID: ${asmId}`);

  const { post, get } = await submitAndFetch(token, asmId, STEEL_PAYLOAD);
  check(SEC, 'POST succeeded',              post.success === true);
  check(SEC, 'GET returned data',           !!get);

  const r = get.responses || get.advancedResponses || get;

  log.h2('Q1 — Usage Change');
  check(SEC, 'Q1 usage_changed = "Yes"',              r.q1_steel_adv_usage_changed === 'Yes');
  check(SEC, 'Q1 previous_usage array saved',         Array.isArray(r.q1_steel_adv_previous_usage) && r.q1_steel_adv_previous_usage.length === 2);
  check(SEC, 'Q1 previous_usage_other saved',         !!r.q1_steel_adv_previous_usage_other);

  log.h2('Q2 — Steel System');
  check(SEC, 'Q2 structural_system saved',            !!r.q2_steel_adv_structural_system);
  check(SEC, 'Q2 section_types array (4 items)',       (r.q2_steel_adv_section_types || []).length === 4);
  check(SEC, 'Q2 section_types_other saved',          !!r.q2_steel_adv_section_types_other);

  log.h2('Q3 — Cracks');
  check(SEC, 'Q3 has_cracks = "Yes"',                 r.q3_steel_adv_has_cracks === 'Yes');
  check(SEC, 'Q3 crack_floor_levels saved',           Array.isArray(r.q3_steel_adv_crack_floor_levels));
  check(SEC, 'Q3 crack_elements (4 elements)',        (r.q3_steel_adv_crack_elements || []).length === 4);
  // Beams sub-fields
  check(SEC, 'Q3.Beams locations saved',              Array.isArray(r.q3_steel_adv_beams_locations));
  check(SEC, 'Q3.Beams max_crack_length = "320"',     r.q3_steel_adv_beams_max_crack_length === '320');
  check(SEC, 'Q3.Beams total_cracks = "8"',           r.q3_steel_adv_beams_total_cracks === '8');
  check(SEC, 'Q3.Beams crack_depth_type saved',       !!r.q3_steel_adv_beams_crack_depth_type);
  // Columns sub-fields
  check(SEC, 'Q3.Columns locations saved',            Array.isArray(r.q3_steel_adv_columns_locations));
  check(SEC, 'Q3.Columns max_crack_width = "1.8"',    r.q3_steel_adv_columns_max_crack_width === '1.8');
  // Connections sub-fields
  check(SEC, 'Q3.Connections locations saved',        Array.isArray(r.q3_steel_adv_connections_locations));
  check(SEC, 'Q3.Connections total = "12"',           r.q3_steel_adv_connections_total_cracks === '12');
  // Bracing sub-fields
  check(SEC, 'Q3.Bracing locations saved',            Array.isArray(r.q3_steel_adv_bracing_locations));
  check(SEC, 'Q3.Bracing max_length = "150"',         r.q3_steel_adv_bracing_max_crack_length === '150');

  log.h2('Q4 — Deformation');
  check(SEC, 'Q4 has_deformation = "Yes"',            r.q4_steel_adv_deformation_has === 'Yes');
  check(SEC, 'Q4 elements saved',                     Array.isArray(r.q4_steel_adv_deformation_elements));
  check(SEC, 'Q4 deformation_types saved',            Array.isArray(r.q4_steel_adv_deformation_types));

  log.h2('Q5 — Material Deterioration');
  check(SEC, 'Q5 has_deterioration = "Yes"',          r.q5_steel_adv_deterioration_has === 'Yes');
  check(SEC, 'Q5 deterioration_elements saved',       Array.isArray(r.q5_steel_adv_deterioration_elements));
  check(SEC, 'Q5 deterioration_types saved',          Array.isArray(r.q5_steel_adv_deterioration_types));

  log.h2('Q6 — Age & Maintenance');
  check(SEC, 'Q6 building_age = "22"',                r.q6_steel_adv_building_age === '22');
  check(SEC, 'Q6 maintenance_frequency saved',        !!r.q6_steel_adv_maintenance_frequency);
  check(SEC, 'Q6 last_maintenance = "2024"',          r.q6_steel_adv_last_maintenance === '2024');

  log.h2('Q7 — Past Intervention');
  check(SEC, 'Q7 past_intervention = "Yes"',          r.q7_steel_adv_past_intervention === 'Yes');
  check(SEC, 'Q7 past_elements saved',                Array.isArray(r.q7_steel_adv_past_elements));
  check(SEC, 'Q7 intervention_types saved',           Array.isArray(r.q7_steel_adv_past_intervention_types));
  check(SEC, 'Q7 intervention_types_other saved',     !!r.q7_steel_adv_past_intervention_types_other);
  check(SEC, 'Q7 primary_reason saved',               !!r.q7_steel_adv_past_primary_reason);
  check(SEC, 'Q7 intervention_year = "2020"',         r.q7_steel_adv_past_intervention_year === '2020');
  check(SEC, 'Q7 distress_again = "Yes"',             r.q7_steel_adv_past_distress_again === 'Yes');
  check(SEC, 'Q7 recurring_issues saved',             Array.isArray(r.q7_steel_adv_past_recurring_issues));
  check(SEC, 'Q7 recurring_issues_other saved',       !!r.q7_steel_adv_past_recurring_issues_other);

  log.h2('Q8 — Foundation');
  check(SEC, 'Q8 settlement_has = "Yes"',             r.q8_steel_adv_settlement_has === 'Yes');
  check(SEC, 'Q8 settlement_types (2 types)',         (r.q8_steel_adv_settlement_types || []).length === 2);
  check(SEC, 'Q8 settlement_types_other saved',       !!r.q8_steel_adv_settlement_types_other);

  log.h2('Q9 — Lateral Sway');
  check(SEC, 'Q9 lateral_sway = "Yes"',              r.q9_steel_adv_lateral_sway === 'Yes');
  check(SEC, 'Q9 sway_nature saved',                  Array.isArray(r.q9_steel_adv_sway_nature));
  check(SEC, 'Q9 structure_height = "18500"',         r.q9_steel_adv_structure_height === '18500');
  check(SEC, 'Q9 max_lateral_displacement = "45"',    r.q9_steel_adv_max_lateral_displacement === '45');

  log.h2('Q10 — Disasters');
  check(SEC, 'Q10 disaster_has = "Yes"',              r.q10_steel_adv_disaster_has === 'Yes');
  check(SEC, 'Q10 disaster_types (4 items)',          (r.q10_steel_adv_disaster_types || []).length === 4);
  check(SEC, 'Q10 disaster_sound_heard = "Yes"',      r.q10_steel_adv_disaster_sound_heard === 'Yes');
  check(SEC, 'Q10 cracks_widen = "Yes"',              r.q10_steel_adv_disaster_cracks_widen === 'Yes');
  check(SEC, 'Q10 cracks_new = "Yes"',                r.q10_steel_adv_disaster_cracks_new === 'Yes');
  check(SEC, 'Q10 deformation_increase = "Yes"',      r.q10_steel_adv_disaster_deformation_increase === 'Yes');
  check(SEC, 'Q10 deterioration_increase = "Yes"',    r.q10_steel_adv_disaster_deterioration_increase === 'Yes');
  check(SEC, '_meta stripped',                         r._meta === undefined);

  log.info(`Steel: ${sectionResults[SEC].pass} pass / ${sectionResults[SEC].fail} fail`);
}

// ═════════════════════════════════════════════════════════════════════════════
//   ██████  ██████  ███    ███ ██████   ██████  ███████ ██ ████████ ███████
//  ██      ██    ██ ████  ████ ██   ██ ██    ██ ██      ██    ██    ██
//  ██      ██    ██ ██ ████ ██ ██████  ██    ██ ███████ ██    ██    █████
//  ██      ██    ██ ██  ██  ██ ██      ██    ██      ██ ██    ██    ██
//   ██████  ██████  ██      ██ ██       ██████  ███████ ██    ██    ███████
// ═════════════════════════════════════════════════════════════════════════════
const COMPOSITE_PAYLOAD = {
  _meta: { structureType: 'Composite structure', submittedAt: new Date().toISOString(), formVersion: 'advanced-composite-v1' },

  // Q1 — Usage Change
  q1_composite_adv_usage_changed:         'Yes',
  q1_composite_adv_previous_usage:        ['Residential', 'Commercial'],
  q1_composite_adv_previous_usage_other:  'Mixed residential-retail podium',

  // Q2 — Composite System Information
  q2_composite_system_type:               ['Steel beams with RCC slab (Shear stud composite system)', 'Concrete Filled Steel Tube (CFST) columns', 'Composite deck slab (metal deck + concrete topping)'],
  q2_composite_system_type_other:         'Hybrid floor with cellular beams',
  q2_composite_steel_sections:            ['I-section', 'H-section', 'Box section (RHS / SHS)', 'Circular Hollow Section / Pipe Section (CHS)', 'Lattice girders'],
  q2_composite_steel_sections_other:      'Plate girder with cover plates',

  // Q3 — Cracks
  q3_composite_adv_cracks_observed:       'Yes',
  q3_composite_adv_cracks_floor_level:    'Ground Floor, First Floor, Second Floor',
  q3_composite_adv_cracks_elements:       ['Steel beam', 'RCC beam', 'Encased Composite Beam', 'Steel column', 'RCC column', 'CFST column (Concrete Filled Steel Tubes)', 'Composite floor slab', 'Steel Bracing members', 'Steel connections'],
  q3_composite_adv_cracks_elements_other: 'Shear stud weld zone',
  q3_composite_adv_crack_orientation:     ['Vertical', 'Diagonal', 'Circumferential'],
  q3_composite_adv_crack_orientation_other: 'Radial around stud welds',
  q3_composite_adv_crack_max_length:      '780',
  q3_composite_adv_crack_avg_length:      '390',
  q3_composite_adv_crack_max_width:       '3.5',
  q3_composite_adv_crack_avg_width:       '1.8',
  q3_composite_adv_crack_max_depth:       '25',
  q3_composite_adv_crack_depth_type:      'Through (same crack visible from opposite side)',
  q3_composite_adv_crack_total_locations: '18',
  q3_composite_adv_crack_num_above_avg:   '8',
  q3_composite_adv_crack_conditions:      ['Leakage/Dampness', 'Exposed reinforcement near crack'],
  q3_composite_adv_crack_conditions_other:'Salt efflorescence at RCC beam soffit',

  // Per-element sub-fields (Steel beam)
  q3_comp_has_cracks:                     'Yes',
  q3_comp_crack_floor_levels:             ['Ground Floor', 'First Floor', 'Second Floor'],
  q3_comp_crack_elements:                 ['Steel beam', 'RCC beam', 'Composite floor slab'],
  q3_comp_crack_elements_other:           '',
  q3_comp_steelbeam_locations:            ['At the middle section of the web(s)', 'At the beam-column junctions'],
  q3_comp_steelbeam_locations_other:      '',
  q3_comp_steelbeam_orientations:         ['Vertical', 'Diagonal'],
  q3_comp_steelbeam_orientations_other:   '',
  q3_comp_steelbeam_max_crack_length:     '450',
  q3_comp_steelbeam_avg_crack_length:     '280',
  q3_comp_steelbeam_max_crack_width:      '2.8',
  q3_comp_steelbeam_avg_crack_width:      '1.5',
  q3_comp_steelbeam_max_crack_depth:      '18',
  q3_comp_steelbeam_total_cracks:         '10',
  q3_comp_steelbeam_cracks_gte_avg:       '4',
  q3_comp_steelbeam_crack_depth_type:     'Deep',

  // Q4 — Deformation
  q4_composite_adv_deformation_observed:   'Yes',
  q4_composite_adv_deformation_floor_level:'Ground Floor, First Floor',
  q4_composite_adv_deformation_elements:   ['Steel beam', 'CFST column (Concrete Filled Steel Tubes)', 'Composite floor slab'],
  q4_composite_adv_deformation_elements_other: 'Shear wall connection zone',
};

async function testComposite() {
  log.h1('TEST 2 — COMPOSITE STRUCTURE ADVANCED ASSESSMENT');
  const SEC = 'Composite';
  const token = await getToken();
  const asmId = await createBaseAssessment(token, 'Composite structure', 'Hyderabad');
  log.info(`Base assessment ID: ${asmId}`);

  const { post, get } = await submitAndFetch(token, asmId, COMPOSITE_PAYLOAD);
  check(SEC, 'POST succeeded',             post.success === true);
  check(SEC, 'GET returned data',          !!get);

  const r = get.responses || get.advancedResponses || get;

  log.h2('Q1 — Usage Change');
  check(SEC, 'Q1 usage_changed = "Yes"',            r.q1_composite_adv_usage_changed === 'Yes');
  check(SEC, 'Q1 previous_usage saved (2 items)',   (r.q1_composite_adv_previous_usage || []).length === 2);
  check(SEC, 'Q1 previous_usage_other saved',       !!r.q1_composite_adv_previous_usage_other);

  log.h2('Q2 — Composite System');
  check(SEC, 'Q2 system_type array (3 items)',      (r.q2_composite_system_type || []).length === 3);
  check(SEC, 'Q2 system_type_other saved',          !!r.q2_composite_system_type_other);
  check(SEC, 'Q2 steel_sections (5 items)',         (r.q2_composite_steel_sections || []).length === 5);
  check(SEC, 'Q2 steel_sections_other saved',       !!r.q2_composite_steel_sections_other);

  log.h2('Q3 — Cracks');
  check(SEC, 'Q3 cracks_observed = "Yes"',          r.q3_composite_adv_cracks_observed === 'Yes');
  check(SEC, 'Q3 cracks_floor_level saved',         !!r.q3_composite_adv_cracks_floor_level);
  check(SEC, 'Q3 cracks_elements (9 items)',        (r.q3_composite_adv_cracks_elements || []).length === 9);
  check(SEC, 'Q3 cracks_elements_other saved',      !!r.q3_composite_adv_cracks_elements_other);
  check(SEC, 'Q3 crack_orientation saved',          Array.isArray(r.q3_composite_adv_crack_orientation));
  check(SEC, 'Q3 crack_max_length = "780"',         r.q3_composite_adv_crack_max_length === '780');
  check(SEC, 'Q3 crack_avg_width = "1.8"',          r.q3_composite_adv_crack_avg_width === '1.8');
  check(SEC, 'Q3 crack_depth_type saved',           !!r.q3_composite_adv_crack_depth_type);
  check(SEC, 'Q3 crack_total_locations = "18"',     r.q3_composite_adv_crack_total_locations === '18');
  check(SEC, 'Q3 crack_conditions saved',           Array.isArray(r.q3_composite_adv_crack_conditions));
  // Per-element sub-fields
  check(SEC, 'Q3 comp_crack_floor_levels saved',    Array.isArray(r.q3_comp_crack_floor_levels));
  check(SEC, 'Q3 steelbeam_locations saved',        Array.isArray(r.q3_comp_steelbeam_locations));
  check(SEC, 'Q3 steelbeam_max_crack_length = "450"', r.q3_comp_steelbeam_max_crack_length === '450');
  check(SEC, 'Q3 steelbeam_crack_depth_type saved', !!r.q3_comp_steelbeam_crack_depth_type);

  log.h2('Q4 — Deformation');
  check(SEC, 'Q4 deformation_observed = "Yes"',    r.q4_composite_adv_deformation_observed === 'Yes');
  check(SEC, 'Q4 deformation_floor_level saved',    !!r.q4_composite_adv_deformation_floor_level);
  check(SEC, 'Q4 deformation_elements (3 items)',   (r.q4_composite_adv_deformation_elements || []).length === 3);
  check(SEC, 'Q4 deformation_elements_other saved', !!r.q4_composite_adv_deformation_elements_other);
  check(SEC, '_meta stripped',                       r._meta === undefined);

  log.info(`Composite: ${sectionResults[SEC].pass} pass / ${sectionResults[SEC].fail} fail`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  ██   ██ ███████ ██████  ██ ████████  █████   ██████  ███████
//  ██   ██ ██      ██   ██ ██    ██    ██   ██ ██       ██
//  ███████ █████   ██████  ██    ██    ███████ ██   ███ █████
//  ██   ██ ██      ██   ██ ██    ██    ██   ██ ██    ██ ██
//  ██   ██ ███████ ██   ██ ██    ██    ██   ██  ██████  ███████
// ═════════════════════════════════════════════════════════════════════════════
const HERITAGE_PAYLOAD = {
  _meta: { structureType: 'Heritage Building', submittedAt: new Date().toISOString(), formVersion: 'advanced-heritage-v1' },

  // Q1 — Usage Change
  adv_usage_changed:          'Yes',
  adv_prev_usage_type:        ['Religious', 'Cultural'],
  adv_prev_usage_type_other:  'Converted to museum with religious sections',

  // Q2 — Masonry Information
  adv_masonry_type:              'Composite masonry',
  adv_masonry_type_other:        '',
  adv_composite_masonry_type:    'Stone facing with brick backing',
  adv_composite_masonry_type_other: '',
  adv_mortar_type:               'Lime mortar',

  // Q3 — Cracks
  q3_ht_has_cracks:          'Yes',
  q3_ht_crack_floor_levels:  ['Ground Floor', 'First Floor'],
  q3_ht_crack_elements:      ['Primary masonry walls', 'Pillars / columns (vertical supports)', 'At junctions', 'Arches', 'Vaults', 'Domes'],

  // Primary masonry walls
  q3_ht_wall_locations:          ['At the middle section', 'Near openings'],
  q3_ht_wall_locations_other:    '',
  q3_ht_wall_orientations:       ['Vertical', 'Diagonal', 'Stepped (along brick/stone joints)'],
  q3_ht_wall_orientations_other: '',
  q3_ht_wall_max_crack_length:   '650',
  q3_ht_wall_avg_crack_length:   '380',
  q3_ht_wall_max_crack_width:    '4.2',
  q3_ht_wall_avg_crack_width:    '2.1',
  q3_ht_wall_total_cracks:       '20',
  q3_ht_wall_cracks_gte_avg:     '9',
  q3_ht_wall_crack_depth_type:   'Through full wall thickness',

  // Pillars
  q3_ht_pillar_locations:          ['Near the top', 'Near base'],
  q3_ht_pillar_locations_other:    '',
  q3_ht_pillar_orientations:       ['Vertical', 'Horizontal'],
  q3_ht_pillar_orientations_other: '',
  q3_ht_pillar_max_crack_length:   '400',
  q3_ht_pillar_avg_crack_length:   '210',
  q3_ht_pillar_max_crack_width:    '3.0',
  q3_ht_pillar_avg_crack_width:    '1.6',
  q3_ht_pillar_total_cracks:       '10',
  q3_ht_pillar_cracks_gte_avg:     '4',
  q3_ht_pillar_crack_depth_type:   'Through masonry unit',

  // Junctions
  q3_ht_junction_locations:          ['At the junction of primary masonry walls – roofs', 'At the junction of two primary masonry walls'],
  q3_ht_junction_locations_other:    '',
  q3_ht_junction_orientations:       ['Diagonal', 'Stepped (along brick/stone joints)'],
  q3_ht_junction_orientations_other: '',
  q3_ht_junction_max_crack_length:   '300',
  q3_ht_junction_avg_crack_length:   '180',
  q3_ht_junction_max_crack_width:    '2.5',
  q3_ht_junction_avg_crack_width:    '1.3',
  q3_ht_junction_total_cracks:       '8',
  q3_ht_junction_cracks_gte_avg:     '3',
  q3_ht_junction_crack_depth_type:   'Through mortar joint',

  // Arches
  q3_ht_arch_locations:            ['At the crown (At the middle section)', 'At the haunches'],
  q3_ht_arch_locations_other:      '',
  q3_ht_arch_orientations:         ['Vertical', 'Diagonal'],
  q3_ht_arch_orientations_other:   '',
  q3_ht_arch_max_crack_length:     '500',
  q3_ht_arch_avg_crack_length:     '280',
  q3_ht_arch_max_crack_width:      '3.8',
  q3_ht_arch_avg_crack_width:      '2.0',
  q3_ht_arch_total_cracks:         '12',
  q3_ht_arch_cracks_gte_avg:       '5',
  q3_ht_arch_crack_depth_type:     'Through masonry unit',

  // Vaults
  q3_ht_vault_locations:           ['At the crown (At the middle section)', 'At the springing levels'],
  q3_ht_vault_locations_other:     '',
  q3_ht_vault_orientations:        ['Transverse', 'Longitudinal'],
  q3_ht_vault_orientations_other:  '',
  q3_ht_vault_max_crack_length:    '420',
  q3_ht_vault_avg_crack_length:    '240',
  q3_ht_vault_max_crack_width:     '2.9',
  q3_ht_vault_avg_crack_width:     '1.5',
  q3_ht_vault_total_cracks:        '9',
  q3_ht_vault_cracks_gte_avg:      '4',
  q3_ht_vault_crack_depth_type:    'Through full wall thickness',

  // Domes
  q3_ht_dome_locations:            ['At the crown (At the middle section)', 'At the Drums'],
  q3_ht_dome_locations_other:      '',
  q3_ht_dome_orientations:         ['Meridional (vertical)', 'Hoop (horizontal)'],
  q3_ht_dome_orientations_other:   '',
  q3_ht_dome_max_crack_length:     '350',
  q3_ht_dome_avg_crack_length:     '200',
  q3_ht_dome_max_crack_width:      '3.2',
  q3_ht_dome_avg_crack_width:      '1.7',
  q3_ht_dome_total_cracks:         '7',
  q3_ht_dome_cracks_gte_avg:       '3',
  q3_ht_dome_crack_depth_type:     'Through masonry unit',

  // Q4 — Deformation
  q4_ht_deformation_has:           'Yes',
  q4_ht_deformation_floor_levels:  ['Ground Floor'],
  q4_ht_deformation_elements:      ['Primary masonry walls', 'Pillars / columns (vertical supports)', 'Arches'],
  q4_ht_deformation_types:         ['Out-of-plane bulging', 'In-plane racking', 'Spreading of arch'],

  // Q5 — Material Deterioration
  q5_ht_deterioration_has:          'Yes',
  q5_ht_deterioration_floor_levels: ['Ground Floor', 'First Floor'],
  q5_ht_deterioration_elements:     ['Primary masonry walls', 'Arches', 'Domes'],
  q5_ht_deterioration_types:        ['Weathering/erosion', 'Spalling of masonry units', 'Mortar joint deterioration', 'Biological growth (moss/algae)', 'Salt efflorescence'],

  // Q6 — Hollow-sound areas
  q6_ht_hollow_has:                 'Yes',
  q6_ht_hollow_floor_levels:        ['Ground Floor'],
  q6_ht_hollow_elements:            ['Primary masonry walls', 'Vaults'],
  q6_ht_hollow_locations:           ['Lower third of wall', 'Crown of vault'],

  // Q7 — Reinforcement
  q7_ht_rebar_provided:             'Yes',
  q7_ht_rebar_exposed:              'Yes',
  q7_ht_rebar_floor_levels:         ['Ground Floor'],
  q7_ht_rebar_elements:             ['Tie rods', 'Ring beam reinforcement'],
  q7_ht_rebar_avg_area:             '0.12',
  q7_ht_rebar_max_area:             '0.35',
  q7_ht_rebar_corrosion_visible:    'Yes',

  // Q8 — Past Intervention
  q8_ht_past_has:                   'Yes',
  q8_ht_past_floor_levels:          ['Ground Floor', 'First Floor'],
  q8_ht_past_elements:              ['Primary masonry walls', 'Foundation', 'Arches'],
  q8_ht_past_intervention_types:    ['Crack injection (lime grout / cement grout / epoxy)', 'Re-pointing of masonry joints', 'Crack stitching (steel bars / dowels)', 'Waterproofing treatment'],
  q8_ht_past_primary_reason:        'Structural cracks in masonry',
  q8_ht_past_primary_reason_other:  '',
  q8_ht_past_distress_again:        'Yes',
  q8_ht_past_recurring_issues:      ['Crack reappearance', 'Spalling', 'Leakage'],
  q8_ht_past_recurring_issues_other:'Delamination of injected grout',

  // Q9 — Foundation Condition
  q9_ht_settlement_has:             'Yes',
  q9_ht_settlement_types:           ['Differential settlement', 'Foundation exposure', 'Gap between plinth and soil'],
  q9_ht_settlement_types_other:     'Undermining of stone footing',

  // Q10 — Environmental Impact
  q10_ht_veg_has:                   'Yes',
  q10_ht_veg_locations:             ['Roof', 'Wall joints', 'Foundation perimeter', 'Buttresses'],
  q10_ht_veg_types:                 ['Shrubs', 'Roots penetrating cracks or joints', 'Moss / algae on surfaces'],
  q10_ht_veg_distress:              ['Crack widening', 'Surface deterioration', 'Drain blockage'],
  q10_ht_veg_foundation_yn:         'Yes',
  q10_ht_veg_foundation_issues:     ['Root intrusion near footing', 'Settlement signs', 'Plinth cracking'],
  q10_ht_veg_affected_area:         '22',
  q10_ht_veg_affected_length:       '5500',
  q10_ht_veg_tree_distance:         '2400',
  q10_ht_veg_growth_height:         '4200',

  // Q11 — Natural Disasters
  q11_ht_disaster_has:              'Yes',
  q11_ht_disaster_types:            ['Earthquake', 'Flood', 'Landslides', 'Nearby excavation'],
  q11_ht_sudden_sound:              'Yes',
  q11_ht_cracks_widen:              'Yes',
  q11_ht_cracks_new:                'Yes',
  q11_ht_deform_increase:           'No',
  q11_ht_deform_new:                'No',
  q11_ht_deterioration_increase:    'Yes',
  q11_ht_deterioration_new:         'No',
};

async function testHeritage() {
  log.h1('TEST 3 — HERITAGE BUILDING ADVANCED ASSESSMENT');
  const SEC = 'Heritage';
  const token = await getToken();
  const asmId = await createBaseAssessment(token, 'Heritage structure', 'Ahmedabad');
  log.info(`Base assessment ID: ${asmId}`);

  const { post, get } = await submitAndFetch(token, asmId, HERITAGE_PAYLOAD);
  check(SEC, 'POST succeeded',              post.success === true);
  check(SEC, 'GET returned data',           !!get);

  const r = get.responses || get.advancedResponses || get;

  log.h2('Q1 — Usage Change');
  check(SEC, 'Q1 usage_changed = "Yes"',              r.adv_usage_changed === 'Yes');
  check(SEC, 'Q1 prev_usage_type (2 items)',           (r.adv_prev_usage_type || []).length === 2);
  check(SEC, 'Q1 prev_usage_type_other saved',         !!r.adv_prev_usage_type_other);

  log.h2('Q2 — Masonry Information');
  check(SEC, 'Q2 masonry_type saved',                  !!r.adv_masonry_type);
  check(SEC, 'Q2 composite_masonry_type saved',        !!r.adv_composite_masonry_type);
  check(SEC, 'Q2 mortar_type saved',                   !!r.adv_mortar_type);

  log.h2('Q3 — Cracks');
  check(SEC, 'Q3 has_cracks = "Yes"',                  r.q3_ht_has_cracks === 'Yes');
  check(SEC, 'Q3 crack_floor_levels saved',             Array.isArray(r.q3_ht_crack_floor_levels));
  check(SEC, 'Q3 crack_elements (6 items)',             (r.q3_ht_crack_elements || []).length === 6);
  // Wall sub-fields
  check(SEC, 'Q3.Wall locations saved',                Array.isArray(r.q3_ht_wall_locations));
  check(SEC, 'Q3.Wall max_crack_length = "650"',       r.q3_ht_wall_max_crack_length === '650');
  check(SEC, 'Q3.Wall crack_depth_type saved',         !!r.q3_ht_wall_crack_depth_type);
  // Pillar sub-fields
  check(SEC, 'Q3.Pillar locations saved',              Array.isArray(r.q3_ht_pillar_locations));
  check(SEC, 'Q3.Pillar max_crack_width = "3.0"',      r.q3_ht_pillar_max_crack_width === '3.0');
  // Junction sub-fields
  check(SEC, 'Q3.Junction locations saved',            Array.isArray(r.q3_ht_junction_locations));
  check(SEC, 'Q3.Junction crack_depth_type saved',     !!r.q3_ht_junction_crack_depth_type);
  // Arch sub-fields
  check(SEC, 'Q3.Arch locations saved',                Array.isArray(r.q3_ht_arch_locations));
  check(SEC, 'Q3.Arch max_crack_length = "500"',       r.q3_ht_arch_max_crack_length === '500');
  // Vault sub-fields
  check(SEC, 'Q3.Vault locations saved',               Array.isArray(r.q3_ht_vault_locations));
  check(SEC, 'Q3.Vault total_cracks = "9"',            r.q3_ht_vault_total_cracks === '9');
  // Dome sub-fields
  check(SEC, 'Q3.Dome locations saved',                Array.isArray(r.q3_ht_dome_locations));
  check(SEC, 'Q3.Dome max_crack_width = "3.2"',        r.q3_ht_dome_max_crack_width === '3.2');

  log.h2('Q4 — Deformation');
  check(SEC, 'Q4 deformation_has = "Yes"',             r.q4_ht_deformation_has === 'Yes');
  check(SEC, 'Q4 deformation_elements saved',          Array.isArray(r.q4_ht_deformation_elements));
  check(SEC, 'Q4 deformation_types saved',             Array.isArray(r.q4_ht_deformation_types));

  log.h2('Q5 — Material Deterioration');
  check(SEC, 'Q5 deterioration_has = "Yes"',           r.q5_ht_deterioration_has === 'Yes');
  check(SEC, 'Q5 deterioration_elements saved',        Array.isArray(r.q5_ht_deterioration_elements));
  check(SEC, 'Q5 deterioration_types (5 items)',       (r.q5_ht_deterioration_types || []).length === 5);

  log.h2('Q6 — Hollow-Sounding');
  check(SEC, 'Q6 hollow_has = "Yes"',                  r.q6_ht_hollow_has === 'Yes');
  check(SEC, 'Q6 hollow_elements saved',               Array.isArray(r.q6_ht_hollow_elements));
  check(SEC, 'Q6 hollow_locations saved',              Array.isArray(r.q6_ht_hollow_locations));

  log.h2('Q7 — Reinforcement');
  check(SEC, 'Q7 rebar_provided = "Yes"',              r.q7_ht_rebar_provided === 'Yes');
  check(SEC, 'Q7 rebar_exposed = "Yes"',               r.q7_ht_rebar_exposed === 'Yes');
  check(SEC, 'Q7 rebar_elements saved',                Array.isArray(r.q7_ht_rebar_elements));
  check(SEC, 'Q7 rebar_avg_area = "0.12"',             r.q7_ht_rebar_avg_area === '0.12');
  check(SEC, 'Q7 corrosion_visible = "Yes"',           r.q7_ht_rebar_corrosion_visible === 'Yes');

  log.h2('Q8 — Past Intervention');
  check(SEC, 'Q8 past_has = "Yes"',                    r.q8_ht_past_has === 'Yes');
  check(SEC, 'Q8 past_elements saved',                 Array.isArray(r.q8_ht_past_elements));
  check(SEC, 'Q8 intervention_types (4 items)',        (r.q8_ht_past_intervention_types || []).length === 4);
  check(SEC, 'Q8 primary_reason saved',                !!r.q8_ht_past_primary_reason);
  check(SEC, 'Q8 distress_again = "Yes"',              r.q8_ht_past_distress_again === 'Yes');
  check(SEC, 'Q8 recurring_issues (3 items)',          (r.q8_ht_past_recurring_issues || []).length === 3);
  check(SEC, 'Q8 recurring_issues_other saved',        !!r.q8_ht_past_recurring_issues_other);

  log.h2('Q9 — Foundation');
  check(SEC, 'Q9 settlement_has = "Yes"',              r.q9_ht_settlement_has === 'Yes');
  check(SEC, 'Q9 settlement_types (3 items)',          (r.q9_ht_settlement_types || []).length === 3);
  check(SEC, 'Q9 settlement_types_other saved',        !!r.q9_ht_settlement_types_other);

  log.h2('Q10 — Environmental Impact');
  check(SEC, 'Q10 veg_has = "Yes"',                   r.q10_ht_veg_has === 'Yes');
  check(SEC, 'Q10 veg_locations (4 items)',            (r.q10_ht_veg_locations || []).length === 4);
  check(SEC, 'Q10 veg_types saved',                    Array.isArray(r.q10_ht_veg_types));
  check(SEC, 'Q10 veg_distress saved',                 Array.isArray(r.q10_ht_veg_distress));
  check(SEC, 'Q10 foundation_yn = "Yes"',              r.q10_ht_veg_foundation_yn === 'Yes');
  check(SEC, 'Q10 foundation_issues (3 items)',        (r.q10_ht_veg_foundation_issues || []).length === 3);
  check(SEC, 'Q10 affected_area = "22"',               r.q10_ht_veg_affected_area === '22');
  check(SEC, 'Q10 tree_distance = "2400"',             r.q10_ht_veg_tree_distance === '2400');
  check(SEC, 'Q10 growth_height = "4200"',             r.q10_ht_veg_growth_height === '4200');

  log.h2('Q11 — Natural Disasters');
  check(SEC, 'Q11 disaster_has = "Yes"',               r.q11_ht_disaster_has === 'Yes');
  check(SEC, 'Q11 disaster_types (4 items)',           (r.q11_ht_disaster_types || []).length === 4);
  check(SEC, 'Q11 sudden_sound = "Yes"',               r.q11_ht_sudden_sound === 'Yes');
  check(SEC, 'Q11 cracks_widen = "Yes"',               r.q11_ht_cracks_widen === 'Yes');
  check(SEC, 'Q11 deterioration_increase = "Yes"',     r.q11_ht_deterioration_increase === 'Yes');
  check(SEC, '_meta stripped',                          r._meta === undefined);

  log.info(`Heritage: ${sectionResults[SEC].pass} pass / ${sectionResults[SEC].fail} fail`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  ██       ██████   █████  ██████      ██████  ███████  █████  ██████  ██ ███    ██  ██████
//  ██      ██    ██ ██   ██ ██   ██     ██   ██ ██      ██   ██ ██   ██ ██ ████   ██ ██
//  ██      ██    ██ ███████ ██   ██     ██████  █████   ███████ ██████  ██ ██ ██  ██ ██   ███
//  ██      ██    ██ ██   ██ ██   ██     ██   ██ ██      ██   ██ ██   ██ ██ ██  ██ ██ ██    ██
//  ███████  ██████  ██   ██ ██████      ██████  ███████ ██   ██ ██   ██ ██ ██   ████  ██████
// ═════════════════════════════════════════════════════════════════════════════
const LB_PAYLOAD = {
  _meta: { structureType: 'Load bearing masonry', submittedAt: new Date().toISOString(), formVersion: 'advanced-lb-v1' },

  // Q1 — Usage Change
  q1_lb_adv_usage_changed:          'Yes',
  q1_lb_adv_previous_usage:         ['Residential', 'Institutional'],
  q1_lb_adv_previous_usage_other:   'Former government residency converted to offices',

  // Q2 — Masonry Information
  q2_lb_adv_masonry_type:           ['Burnt clay brick masonry', 'Stone masonry (Random Rubble/Ashlar)'],
  q2_lb_adv_masonry_type_other:     '',
  q2_lb_adv_composite_masonry_type: ['Stone facing with brick backing'],
  q2_lb_adv_composite_masonry_type_other: '',
  q2_lb_adv_mortar_type:            ['Lime mortar', 'Lime-cement mortar'],
  q2_lb_adv_mortar_type_other:      '',

  // Q3 — Cracks (main)
  q3_lb_adv_has_cracks:             'Yes',
  q3_lb_adv_crack_floor_levels:     ['Ground Floor', 'First Floor'],
  q3_lb_adv_crack_elements:         ['Column / Pier', 'Load bearing wall', 'Cross wall (partition wall)', 'Lintel beam', 'Arch', 'Floor slab', 'Roof', 'Parapet'],
  q3_lb_adv_crack_elements_other:   '',
  q3_lb_adv_crack_conditions:       ['Dampness visible', 'Leakage', 'Efflorescence'],
  q3_lb_adv_crack_conditions_other: 'Vegetation through crack',

  // Per-element sub-fields (Column/Pier)
  q3_lb_adv_column_pier_locations:           ['Near the top', 'Near base'],
  q3_lb_adv_column_pier_locations_other:     '',
  q3_lb_adv_column_pier_orientations:        ['Vertical', 'Diagonal'],
  q3_lb_adv_column_pier_orientations_other:  '',

  // Load bearing wall
  q3_lb_adv_wall_locations:                  ['At the middle section', 'Near openings', 'Near wall intersections'],
  q3_lb_adv_wall_locations_other:            '',
  q3_lb_adv_wall_orientations:               ['Vertical', 'Stepped (along brick/stone joints)'],
  q3_lb_adv_wall_orientations_other:         '',

  // Cross wall
  q3_lb_adv_cross_wall_locations:            ['At junction with main wall'],
  q3_lb_adv_cross_wall_locations_other:      '',
  q3_lb_adv_cross_wall_orientations:         ['Horizontal', 'Diagonal'],
  q3_lb_adv_cross_wall_orientations_other:   '',

  // Lintel
  q3_lb_adv_lintel_locations:                ['At mid-span', 'At supports'],
  q3_lb_adv_lintel_locations_other:          '',
  q3_lb_adv_lintel_orientations:             ['Vertical'],
  q3_lb_adv_lintel_orientations_other:       '',

  // Arch
  q3_lb_adv_arch_locations:                  ['At the crown (At the middle section)', 'At the haunches'],
  q3_lb_adv_arch_locations_other:            '',
  q3_lb_adv_arch_orientations:               ['Vertical', 'Diagonal'],
  q3_lb_adv_arch_orientations_other:         '',

  // Staircase
  q3_lb_adv_staircase_locations:             ['Waist slab', 'Newel post area'],
  q3_lb_adv_staircase_locations_other:       '',
  q3_lb_adv_staircase_orientations:          ['Vertical'],
  q3_lb_adv_staircase_orientations_other:    '',

  // Floor slab
  q3_lb_adv_floor_slab_locations:            ['Centre panel', 'Near supporting wall'],
  q3_lb_adv_floor_slab_locations_other:      '',
  q3_lb_adv_floor_slab_orientations:         ['Diagonal', 'Two-way'],
  q3_lb_adv_floor_slab_orientations_other:   '',

  // Roof
  q3_lb_adv_roof_locations:                  ['Near parapet wall', 'Over existing patches'],
  q3_lb_adv_roof_locations_other:            '',
  q3_lb_adv_roof_orientations:               ['Transverse', 'Longitudinal'],
  q3_lb_adv_roof_orientations_other:         '',

  // Parapet
  q3_lb_adv_parapet_locations:               ['Top coping', 'Base of parapet'],
  q3_lb_adv_parapet_locations_other:         '',
  q3_lb_adv_parapet_orientations:            ['Vertical', 'Horizontal'],
  q3_lb_adv_parapet_orientations_other:      '',

  // Partition wall
  q3_lb_adv_partition_wall_locations:        ['Full height crack'],
  q3_lb_adv_partition_wall_locations_other:  '',
  q3_lb_adv_partition_wall_orientations:     ['Diagonal'],
  q3_lb_adv_partition_wall_orientations_other: '',

  // Junction
  q3_lb_adv_junction_locations:             ['Wall-roof junction', 'Wall-floor junction'],
  q3_lb_adv_junction_locations_other:       '',
  q3_lb_adv_junction_orientations:          ['Horizontal', 'Stepped (along brick/stone joints)'],
  q3_lb_adv_junction_orientations_other:    '',

  // Q4 — Deformation
  q4_lb_adv_deformation_has:                'Yes',
  q4_lb_adv_deformation_floor_levels:       ['Ground Floor', 'First Floor'],
  q4_lb_adv_deformation_has_elements:       ['Load bearing wall', 'Column / Pier', 'Arch'],
  q4_lb_adv_deformation_has_elements_other: 'Cantilever sunshade',

  // Q5 — Material Deterioration
  q5_lb_adv_deterioration_has:              'Yes',
  q5_lb_adv_deterioration_floor_levels:     ['Ground Floor'],
  q5_lb_adv_deterioration_elements:         ['Load bearing wall', 'Foundation', 'Lintel beam', 'Arch', 'Staircase', 'Floor slab', 'Roof', 'Parapet'],

  // Per-element deterioration locations
  q5_lb_adv_foundation_locations:       ['Exposed footing – south', 'Near water tank'],
  q5_lb_adv_column_locations:           ['Bottom third'],
  q5_lb_adv_lbwall_locations:           ['Interior face', 'Exterior – weather face'],
  q5_lb_adv_crosswall_locations:        ['Near junctions'],
  q5_lb_adv_lintel_locations:           ['Soffit', 'Bearing zone'],
  q5_lb_adv_arch_locations:             ['Crown', 'Springing points'],
  q5_lb_adv_staircase_locations:        ['Nosing', 'Waist slab bottom'],
  q5_lb_adv_floor_locations:            ['Bathroom block soffit'],
  q5_lb_adv_roof_locations:             ['Waterproofing layer area'],

  // Q6 — Hollow-sound areas
  q6_lb_adv_hollow_has:                 'Yes',
  q6_lb_adv_hollow_floor_levels:        ['Ground Floor'],
  q6_lb_adv_hollow_locations:           ['Lower portion of Load bearing wall', 'Foundation area'],
  q6_lb_adv_hollow_locations_other:     'Behind stone cladding',
  q6_lb_adv_hollow_patch_count:         '6',
  q6_lb_adv_hollow_patch_area:          '0.8',

  // Q7 — Reinforcement / Exposed Rebar
  q7_lb_adv_reinforcement_provided:     'Yes',
  q7_lb_adv_reinforcement_exposed:      'Yes',
  q7_lb_adv_reinforcement_floor_levels: ['Ground Floor', 'First Floor'],
  q7_lb_adv_reinforcement_elements:     ['Load bearing wall', 'Column / Pier', 'Lintel beam', 'Floor slab'],
  // Per-element rebar location sub-fields
  q7_lb_adv_column_locations:           ['Near the top', 'Near base'],
  q7_lb_adv_column_location_other:      '',
  q7_lb_adv_lbwall_locations:           ['Interior face', 'Corner junction'],
  q7_lb_adv_lbwall_location_other:      '',
  q7_lb_adv_crosswall_locations:        ['Junction with main wall'],
  q7_lb_adv_crosswall_location_other:   '',
  q7_lb_adv_lintel_locations:           ['Soffit', 'At supports'],
  q7_lb_adv_lintel_location_other:      '',
  q7_lb_adv_arch_locations:             ['At the haunches'],
  q7_lb_adv_arch_location_other:        '',
  q7_lb_adv_staircase_locations:        ['Waist slab bottom'],
  q7_lb_adv_staircase_location_other:   '',
  q7_lb_adv_floor_locations:            ['Centre panel', 'Edge strip'],
  q7_lb_adv_floor_location_other:       '',
  q7_lb_adv_roof_locations:             ['Near parapet', 'Over slab drain'],
  q7_lb_adv_roof_location_other:        '',
  q7_lb_adv_parapet_locations:          ['Top coping'],
  q7_lb_adv_parapet_location_other:     '',
  q7_lb_adv_partition_locations:        ['Full height'],
  q7_lb_adv_partition_location_other:   '',
  q7_lb_adv_junction_locations:         ['Wall-roof junction'],
  q7_lb_adv_junction_location_other:    '',
  q7_lb_adv_other_locations:            ['External plaster zone'],
  q7_lb_adv_other_location_other:       '',
  // Rebar measurements
  q7_lb_adv_reinforcement_avg_area:     '1200',
  q7_lb_adv_reinforcement_max_area:     '3500',
  q7_lb_adv_corrosion_visible:          'Yes',
  q7_lb_adv_diameter_reduction:         'Yes',
  q7_lb_adv_affected_element:           ['Load bearing wall', 'Lintel beam'],
  q7_lb_adv_affected_element_other:     '',
  q7_lb_adv_original_diameter:          '12',
  q7_lb_adv_current_diameter:           '9',
  q7_lb_adv_contributing_factors:       ['Water penetration', 'Lack of cover', 'Chloride exposure'],
  q7_lb_adv_contributing_factors_other: 'Carbonation depth exceeding cover',

  // Q8 — Past Intervention
  q8_lb_adv_intervention_done:          'Yes',
  q8_lb_adv_intervention_floor_levels:  ['Ground Floor', 'First Floor'],
  q8_lb_adv_intervention_elements:      ['Load bearing wall', 'Foundation', 'Lintel beam'],
  q8_lb_adv_intervention_elements_other:'Parapet coping',
  q8_lb_adv_intervention_types:         ['Crack injection (lime grout / cement grout / epoxy)', 'Re-pointing of masonry joints', 'Waterproofing treatment', 'Underpinning'],
  q8_lb_adv_intervention_types_other:   'External reinforced plaster band',
  q8_lb_adv_intervention_reason:        'Structural cracks in masonry',
  q8_lb_adv_intervention_reason_other:  '',
  q8_lb_adv_intervention_year:          '2019',
  q8_lb_adv_distress_again:             'Yes',
  q8_lb_adv_recurring_issues:           ['Crack reappearance', 'Leakage / seepage'],
  q8_lb_adv_recurring_issues_other:     'Grout debonding from old masonry',
  q8_lb_adv_deformation_specify:        'Bulging resumed on south wall at lintel zone',

  // Q9 — Foundation Settlement + Vegetation
  q9_lb_adv_settlement_observed:        'Yes',
  q9_lb_adv_settlement_types:           ['Differential settlement', 'Foundation exposure', 'Gap between plinth and soil'],
  q9_lb_adv_settlement_types_other:     'Cracking at plinth level',
  q9_lb_adv_vegetation_observed:        'Yes',
  q9_lb_adv_vegetation_locations:       ['Roof', 'Wall joints', 'Foundation perimeter'],
  q9_lb_adv_vegetation_locations_other: 'Through parapet drain holes',

  // Q10 — Vegetation Types / Distress
  q10_lb_adv_vegetation_types:                   ['Shrubs', 'Roots penetrating cracks or joints', 'Moss / algae on surfaces'],
  q10_lb_adv_vegetation_types_other:             'Grass growing from mortar joints',
  q10_lb_adv_vegetation_distress:                ['Crack widening', 'Surface deterioration', 'Drain blockage'],
  q10_lb_adv_vegetation_distress_other:          'Moisture retention causing plaster peeling',
  q10_lb_adv_vegetation_foundation_affected:     'Yes',
  q10_lb_adv_vegetation_foundation_issues:       ['Root intrusion near footing', 'Settlement signs', 'Plinth cracking'],
  q10_lb_adv_vegetation_foundation_issues_other: 'Undermining of stone block footing',
  q10_lb_adv_vegetation_area:                    '18',
  q10_lb_adv_vegetation_length:                  '4800',
  q10_lb_adv_vegetation_tree_distance:           '2200',
  q10_lb_adv_vegetation_height:                  '3600',

  // Q11 — Natural Disasters
  q11_lb_adv_disaster_experienced:      'Yes',
  q11_lb_adv_disaster_types:            ['Earthquake', 'Flood', 'Landslides', 'Nearby excavation / blasting'],
  q11_lb_adv_disaster_types_other:      '',
  q11_lb_adv_earthquake_intensity:      '5.4',
  q11_lb_adv_disaster_date:             '2021-07',
  q11_lb_adv_disaster_duration_hours:   '6',
  q11_lb_adv_disaster_duration_days:    '',
  q11_lb_adv_sudden_sound:              'Yes',
  q11_lb_adv_cracks_widened:            'Yes',
  q11_lb_adv_new_cracks:                'Yes',
  q11_lb_adv_deformation_increased:     'Yes',
  q11_lb_adv_new_deformation:           'No',
  q11_lb_adv_deterioration_increased:   'Yes',
  q11_lb_adv_new_deterioration:         'No',
};

async function testLoadBearing() {
  log.h1('TEST 4 — LOAD BEARING MASONRY ADVANCED ASSESSMENT');
  const SEC = 'LoadBearing';
  const token = await getToken();
  const asmId = await createBaseAssessment(token, 'Load bearing masonry', 'Kolkata');
  log.info(`Base assessment ID: ${asmId}`);

  const { post, get } = await submitAndFetch(token, asmId, LB_PAYLOAD);
  check(SEC, 'POST succeeded',               post.success === true);
  check(SEC, 'GET returned data',            !!get);

  const r = get.responses || get.advancedResponses || get;

  log.h2('Q1 — Usage Change');
  check(SEC, 'Q1 usage_changed = "Yes"',               r.q1_lb_adv_usage_changed === 'Yes');
  check(SEC, 'Q1 previous_usage (2 items)',             (r.q1_lb_adv_previous_usage || []).length === 2);
  check(SEC, 'Q1 previous_usage_other saved',           !!r.q1_lb_adv_previous_usage_other);

  log.h2('Q2 — Masonry Information');
  check(SEC, 'Q2 masonry_type (2 items)',               (r.q2_lb_adv_masonry_type || []).length === 2);
  check(SEC, 'Q2 composite_masonry_type saved',         Array.isArray(r.q2_lb_adv_composite_masonry_type));
  check(SEC, 'Q2 mortar_type (2 items)',                (r.q2_lb_adv_mortar_type || []).length === 2);

  log.h2('Q3 — Cracks');
  check(SEC, 'Q3 has_cracks = "Yes"',                   r.q3_lb_adv_has_cracks === 'Yes');
  check(SEC, 'Q3 crack_floor_levels saved',              Array.isArray(r.q3_lb_adv_crack_floor_levels));
  check(SEC, 'Q3 crack_elements (8 items)',              (r.q3_lb_adv_crack_elements || []).length === 8);
  check(SEC, 'Q3 crack_conditions (3 items)',            (r.q3_lb_adv_crack_conditions || []).length === 3);
  check(SEC, 'Q3 crack_conditions_other saved',          !!r.q3_lb_adv_crack_conditions_other);
  // Per-element
  check(SEC, 'Q3.ColumnPier locations (2 items)',        (r.q3_lb_adv_column_pier_locations || []).length === 2);
  check(SEC, 'Q3.Wall locations (3 items)',              (r.q3_lb_adv_wall_locations || []).length === 3);
  check(SEC, 'Q3.Wall orientations saved',               Array.isArray(r.q3_lb_adv_wall_orientations));
  check(SEC, 'Q3.CrossWall locations saved',             Array.isArray(r.q3_lb_adv_cross_wall_locations));
  check(SEC, 'Q3.Lintel locations saved',                Array.isArray(r.q3_lb_adv_lintel_locations));
  check(SEC, 'Q3.Arch locations saved',                  Array.isArray(r.q3_lb_adv_arch_locations));
  check(SEC, 'Q3.Staircase locations saved',             Array.isArray(r.q3_lb_adv_staircase_locations));
  check(SEC, 'Q3.FloorSlab locations saved',             Array.isArray(r.q3_lb_adv_floor_slab_locations));
  check(SEC, 'Q3.Roof locations saved',                  Array.isArray(r.q3_lb_adv_roof_locations));
  check(SEC, 'Q3.Parapet locations saved',               Array.isArray(r.q3_lb_adv_parapet_locations));
  check(SEC, 'Q3.PartitionWall locations saved',         Array.isArray(r.q3_lb_adv_partition_wall_locations));
  check(SEC, 'Q3.Junction locations (2 items)',          (r.q3_lb_adv_junction_locations || []).length === 2);

  log.h2('Q4 — Deformation');
  check(SEC, 'Q4 deformation_has = "Yes"',               r.q4_lb_adv_deformation_has === 'Yes');
  check(SEC, 'Q4 deformation_floor_levels saved',        Array.isArray(r.q4_lb_adv_deformation_floor_levels));
  check(SEC, 'Q4 deformation_elements (3 items)',        (r.q4_lb_adv_deformation_has_elements || []).length === 3);
  check(SEC, 'Q4 deformation_elements_other saved',      !!r.q4_lb_adv_deformation_has_elements_other);

  log.h2('Q5 — Material Deterioration');
  check(SEC, 'Q5 deterioration_has = "Yes"',             r.q5_lb_adv_deterioration_has === 'Yes');
  check(SEC, 'Q5 deterioration_floor_levels saved',      Array.isArray(r.q5_lb_adv_deterioration_floor_levels));
  check(SEC, 'Q5 deterioration_elements (8 items)',      (r.q5_lb_adv_deterioration_elements || []).length === 8);
  check(SEC, 'Q5 foundation locations saved',            Array.isArray(r.q5_lb_adv_foundation_locations));
  check(SEC, 'Q5 lbwall locations saved',                Array.isArray(r.q5_lb_adv_lbwall_locations));
  check(SEC, 'Q5 lintel locations saved',                Array.isArray(r.q5_lb_adv_lintel_locations));
  check(SEC, 'Q5 arch locations saved',                  Array.isArray(r.q5_lb_adv_arch_locations));
  check(SEC, 'Q5 staircase locations saved',             Array.isArray(r.q5_lb_adv_staircase_locations));
  check(SEC, 'Q5 floor locations saved',                 Array.isArray(r.q5_lb_adv_floor_locations));
  check(SEC, 'Q5 roof locations saved',                  Array.isArray(r.q5_lb_adv_roof_locations));

  log.h2('Q6 — Hollow-sound areas');
  check(SEC, 'Q6 hollow_has = "Yes"',                    r.q6_lb_adv_hollow_has === 'Yes');
  check(SEC, 'Q6 hollow_floor_levels saved',             Array.isArray(r.q6_lb_adv_hollow_floor_levels));
  check(SEC, 'Q6 hollow_locations saved',                Array.isArray(r.q6_lb_adv_hollow_locations));
  check(SEC, 'Q6 hollow_locations_other saved',          !!r.q6_lb_adv_hollow_locations_other);
  check(SEC, 'Q6 hollow_patch_count = "6"',              r.q6_lb_adv_hollow_patch_count === '6');
  check(SEC, 'Q6 hollow_patch_area = "0.8"',             r.q6_lb_adv_hollow_patch_area === '0.8');

  log.h2('Q7 — Exposed Reinforcement');
  check(SEC, 'Q7 reinforcement_provided = "Yes"',        r.q7_lb_adv_reinforcement_provided === 'Yes');
  check(SEC, 'Q7 reinforcement_exposed = "Yes"',         r.q7_lb_adv_reinforcement_exposed === 'Yes');
  check(SEC, 'Q7 reinforcement_floor_levels saved',      Array.isArray(r.q7_lb_adv_reinforcement_floor_levels));
  check(SEC, 'Q7 reinforcement_elements (4 items)',      (r.q7_lb_adv_reinforcement_elements || []).length === 4);
  check(SEC, 'Q7 column rebar locations saved',          Array.isArray(r.q7_lb_adv_column_locations));
  check(SEC, 'Q7 lbwall rebar locations saved',          Array.isArray(r.q7_lb_adv_lbwall_locations));
  check(SEC, 'Q7 lintel rebar locations saved',          Array.isArray(r.q7_lb_adv_lintel_locations));
  check(SEC, 'Q7 floor rebar locations saved',           Array.isArray(r.q7_lb_adv_floor_locations));
  check(SEC, 'Q7 roof rebar locations saved',            Array.isArray(r.q7_lb_adv_roof_locations));
  check(SEC, 'Q7 reinforcement_avg_area = "1200"',       r.q7_lb_adv_reinforcement_avg_area === '1200');
  check(SEC, 'Q7 reinforcement_max_area = "3500"',       r.q7_lb_adv_reinforcement_max_area === '3500');
  check(SEC, 'Q7 corrosion_visible = "Yes"',             r.q7_lb_adv_corrosion_visible === 'Yes');
  check(SEC, 'Q7 diameter_reduction = "Yes"',            r.q7_lb_adv_diameter_reduction === 'Yes');
  check(SEC, 'Q7 affected_element saved',                Array.isArray(r.q7_lb_adv_affected_element));
  check(SEC, 'Q7 original_diameter = "12"',              r.q7_lb_adv_original_diameter === '12');
  check(SEC, 'Q7 current_diameter = "9"',                r.q7_lb_adv_current_diameter === '9');
  check(SEC, 'Q7 contributing_factors (3 items)',        (r.q7_lb_adv_contributing_factors || []).length === 3);
  check(SEC, 'Q7 contributing_factors_other saved',      !!r.q7_lb_adv_contributing_factors_other);

  log.h2('Q8 — Past Intervention');
  check(SEC, 'Q8 intervention_done = "Yes"',             r.q8_lb_adv_intervention_done === 'Yes');
  check(SEC, 'Q8 intervention_floor_levels saved',       Array.isArray(r.q8_lb_adv_intervention_floor_levels));
  check(SEC, 'Q8 intervention_elements (3 items)',       (r.q8_lb_adv_intervention_elements || []).length === 3);
  check(SEC, 'Q8 intervention_elements_other saved',     !!r.q8_lb_adv_intervention_elements_other);
  check(SEC, 'Q8 intervention_types (4 items)',          (r.q8_lb_adv_intervention_types || []).length === 4);
  check(SEC, 'Q8 intervention_types_other saved',        !!r.q8_lb_adv_intervention_types_other);
  check(SEC, 'Q8 intervention_reason saved',             !!r.q8_lb_adv_intervention_reason);
  check(SEC, 'Q8 intervention_year = "2019"',            r.q8_lb_adv_intervention_year === '2019');
  check(SEC, 'Q8 distress_again = "Yes"',                r.q8_lb_adv_distress_again === 'Yes');
  check(SEC, 'Q8 recurring_issues (2 items)',            (r.q8_lb_adv_recurring_issues || []).length === 2);
  check(SEC, 'Q8 recurring_issues_other saved',          !!r.q8_lb_adv_recurring_issues_other);
  check(SEC, 'Q8 deformation_specify saved',             !!r.q8_lb_adv_deformation_specify);

  log.h2('Q9 — Foundation Settlement + Vegetation');
  check(SEC, 'Q9 settlement_observed = "Yes"',           r.q9_lb_adv_settlement_observed === 'Yes');
  check(SEC, 'Q9 settlement_types (3 items)',            (r.q9_lb_adv_settlement_types || []).length === 3);
  check(SEC, 'Q9 settlement_types_other saved',          !!r.q9_lb_adv_settlement_types_other);
  check(SEC, 'Q9 vegetation_observed = "Yes"',           r.q9_lb_adv_vegetation_observed === 'Yes');
  check(SEC, 'Q9 vegetation_locations (3 items)',        (r.q9_lb_adv_vegetation_locations || []).length === 3);
  check(SEC, 'Q9 vegetation_locations_other saved',      !!r.q9_lb_adv_vegetation_locations_other);

  log.h2('Q10 — Vegetation Types / Distress');
  check(SEC, 'Q10 vegetation_types (3 items)',           (r.q10_lb_adv_vegetation_types || []).length === 3);
  check(SEC, 'Q10 vegetation_types_other saved',         !!r.q10_lb_adv_vegetation_types_other);
  check(SEC, 'Q10 vegetation_distress (3 items)',        (r.q10_lb_adv_vegetation_distress || []).length === 3);
  check(SEC, 'Q10 vegetation_distress_other saved',      !!r.q10_lb_adv_vegetation_distress_other);
  check(SEC, 'Q10 foundation_affected = "Yes"',          r.q10_lb_adv_vegetation_foundation_affected === 'Yes');
  check(SEC, 'Q10 foundation_issues (3 items)',          (r.q10_lb_adv_vegetation_foundation_issues || []).length === 3);
  check(SEC, 'Q10 foundation_issues_other saved',        !!r.q10_lb_adv_vegetation_foundation_issues_other);
  check(SEC, 'Q10 vegetation_area = "18"',               r.q10_lb_adv_vegetation_area === '18');
  check(SEC, 'Q10 vegetation_length = "4800"',           r.q10_lb_adv_vegetation_length === '4800');
  check(SEC, 'Q10 vegetation_tree_distance = "2200"',    r.q10_lb_adv_vegetation_tree_distance === '2200');
  check(SEC, 'Q10 vegetation_height = "3600"',           r.q10_lb_adv_vegetation_height === '3600');

  log.h2('Q11 — Natural Disasters');
  check(SEC, 'Q11 disaster_experienced = "Yes"',         r.q11_lb_adv_disaster_experienced === 'Yes');
  check(SEC, 'Q11 disaster_types (4 items)',             (r.q11_lb_adv_disaster_types || []).length === 4);
  check(SEC, 'Q11 earthquake_intensity = "5.4"',         r.q11_lb_adv_earthquake_intensity === '5.4');
  check(SEC, 'Q11 disaster_date = "2021-07"',            r.q11_lb_adv_disaster_date === '2021-07');
  check(SEC, 'Q11 disaster_duration_hours = "6"',        r.q11_lb_adv_disaster_duration_hours === '6');
  check(SEC, 'Q11 sudden_sound = "Yes"',                 r.q11_lb_adv_sudden_sound === 'Yes');
  check(SEC, 'Q11 cracks_widened = "Yes"',               r.q11_lb_adv_cracks_widened === 'Yes');
  check(SEC, 'Q11 new_cracks = "Yes"',                   r.q11_lb_adv_new_cracks === 'Yes');
  check(SEC, 'Q11 deformation_increased = "Yes"',        r.q11_lb_adv_deformation_increased === 'Yes');
  check(SEC, 'Q11 deterioration_increased = "Yes"',      r.q11_lb_adv_deterioration_increased === 'Yes');
  check(SEC, 'Q11 new_deterioration = "No"',             r.q11_lb_adv_new_deterioration === 'No');
  check(SEC, '_meta stripped',                            r._meta === undefined);

  log.info(`LoadBearing: ${sectionResults[SEC].pass} pass / ${sectionResults[SEC].fail} fail`);
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 5 — Dump section summary from MongoDB
// ═════════════════════════════════════════════════════════════════════════════
async function dumpCollectionSummary() {
  log.h2('MongoDB advancedassessments — recent documents summary');
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000, family: 4 });
    const col = mongoose.connection.db.collection('advancedassessments');
    const docs = await col
      .find({}, { projection: { structureType: 1, userEmail: 1, updatedAt: 1, _id: 1 } })
      .sort({ updatedAt: -1 })
      .limit(10)
      .toArray();
    console.log('\n  Last 10 advanced assessment documents:');
    docs.forEach(d => {
      console.log(`    ${d._id}  |  ${(d.structureType || '').padEnd(25)}  |  ${d.userEmail || ''}  |  ${d.updatedAt ? new Date(d.updatedAt).toLocaleString('en-IN') : 'n/a'}`);
    });
  } catch (err) {
    log.warn('Direct MongoDB read skipped: ' + err.message);
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════
(async () => {
  log.h1('ALL STRUCTURE TYPES — ADVANCED ASSESSMENT TEST SUITE');

  try {
    await testSteel();
    await testComposite();
    await testHeritage();
    await testLoadBearing();
    await dumpCollectionSummary();
  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err.response?.data || err.message);
    if (err.response?.data) console.error('Response data:', JSON.stringify(err.response.data, null, 2));
    process.exit(1);
  }

  // ── Final summary ───────────────────────────────────────────────────────
  log.h1('FINAL TEST SUMMARY');
  const structures = ['Steel', 'Composite', 'Heritage', 'LoadBearing'];
  structures.forEach(s => {
    const sr = sectionResults[s] || { pass: 0, fail: 0 };
    const status = sr.fail === 0 ? '🎉 ALL PASS' : `⚠️  ${sr.fail} FAIL`;
    console.log(`  ${s.padEnd(12)}  ${String(sr.pass).padStart(3)} pass  /  ${String(sr.fail).padStart(2)} fail  →  ${status}`);
  });
  console.log(`\n  ──────────────────────────────────────────────`);
  console.log(`  Total checks : ${totalPass + totalFail}`);
  console.log(`  Passed       : ${totalPass}`);
  console.log(`  Failed       : ${totalFail}`);
  if (totalFail === 0) {
    console.log('\n  🎉  ALL CHECKS PASSED — all structure types verified in MongoDB!\n');
  } else {
    console.log('\n  ⚠️   Some checks failed — see ❌ lines above.\n');
    process.exit(1);
  }
})();
