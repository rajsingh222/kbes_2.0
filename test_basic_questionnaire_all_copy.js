/**
 * OSHAS Basic Questionnaire — Deep Field Verification Test
 * Tests all 5 structure types and verifies EVERY sent field is saved correctly in MongoDB
 *
 * Checks:
 *   - HTTP 201 on save
 *   - assessmentId returned
 *   - Every response key present & value-matched in assessment.responses
 *   - Every userDetails field present & value-matched
 *   - assessmentType saved correctly
 *
 * Run: node test_basic_questionnaire_all.js [API_URL]
 */

const axios = require('axios');
const API_URL = process.argv[2] || 'http://localhost:5000';

// ─── Colour helpers ────────────────────────────────────────────────────────────
const G  = s => `\x1b[32m${s}\x1b[0m`;
const R  = s => `\x1b[31m${s}\x1b[0m`;
const Y  = s => `\x1b[33m${s}\x1b[0m`;
const C  = s => `\x1b[36m${s}\x1b[0m`;
const B  = s => `\x1b[1m${s}\x1b[0m`;
const ok   = msg => console.log(`  ${G('✔')} ${msg}`);
const fail = msg => console.log(`  ${R('✘')} ${msg}`);
const info = msg => console.log(`  ${C('ℹ')} ${msg}`);
const warn = msg => console.log(`  ${Y('⚠')} ${msg}`);
const head = msg => console.log(`\n${B(Y('▶ ' + msg))}`);
const sub  = msg => console.log(`    ${Y('→')} ${msg}`);

// ══════════════════════════════════════════════════════════════════════════════
//  TEST DATA — fully filled for every structure type
// ══════════════════════════════════════════════════════════════════════════════

// ─── 1. RCC STRUCTURE ─────────────────────────────────────────────────────────
const rcc = {
  userDetails: {
    name: 'Rajesh Kumar', email: 'rajesh.test@example.com',
    phone: '9876543210', phoneCountryCode: '+91',
    organization: 'SPPL Test Suite', structureType: 'RCC Structure',
    q1: 'Structural Engineer', q1Other: '', yearOfConstruction: 1995, location: 'Mumbai',
  },
  responses: {
    q1_age: '25',                 q1_ageRange: '21-30 years',
    q1_country: 'India',          q1_country_other: '',
    q1_state: 'Maharashtra',      q1_state_other: '',
    q1_city: 'Mumbai',            q1_city_other: '',
    q1_storeys_above: '5',        q1_storeys_below: '1',
    q2_usage: 'Residential',      q2_usage_other: '',
    q3_exposure_type: 'Urban',    q3_exposure_other: '',
    q4_floors_added: 'No',        q4_floors_added_after: '',
    q4_floors_details: '',        q4_heavy_machinery: 'No',
    q5_structural_system: 'RCC Structure',
    // Q6 — Cracks
    q6_cracks_has: 'Yes',
    q6_crack_elements: ['Beams', 'Columns'],       q6_crack_elements_other: '',
    q6_beam_locations: ['Near supports', 'Mid-span'], q6_beam_locations_other: '',
    q6_beam_orientations: ['Diagonal', 'Vertical'],   q6_beam_orientations_other: '',
    q6_column_locations: ['Base', 'Top'],              q6_column_locations_other: '',
    q6_column_orientations: ['Horizontal', 'Diagonal'],q6_column_orientations_other: '',
    q6_rcc_widths: ['0.1–0.3 mm (Fine)'],             q6_rcc_widths_other: '',
    // Q7 — Spalling
    q7_spalling_has: 'Yes',
    q7_spalling_elements: ['Beams', 'Slab'],    q7_spalling_elements_other: '',
    q7_spalling_locations: ['Corner', 'Soffit'],q7_spalling_locations_other: '',
    q7_exposed_steel_has: 'Yes',
    q7_exposed_steel_elements: ['Beams'],       q7_exposed_steel_elements_other: '',
    // Q8 — Moisture
    q8_moisture_has: 'Yes',
    q8_moisture_locations: ['Roof slab', 'External walls'], q8_moisture_locations_other: '',
    q8_seepage_has: 'Yes',
    q8_seepage_locations: ['Basement'],         q8_seepage_locations_other: '',
    q8_white_deposits_has: 'No',
    // Q9 — Deformation
    q9_deflection_has: 'No',   q9_tilt_has: 'No',
    // Q10 — Soil
    q10_soil_type: 'Alluvial', q10_soil_type_other: '', q10_ground_issues_has: 'No',
    // Q11 — Vibration
    q11_vibration_has: 'No',
    // Q12 — Disasters
    q12_disaster_has: 'Yes',
    q12_disaster_types: ['Earthquake'],          q12_disaster_types_other: '',
    q12_earthquake_intensity: 'Moderate',
    // Q13 — Remedial
    q13_rcc_expert_intervention_has: 'Yes',
    q13_rcc_expert_intervention_types: ['Crack injection', 'Waterproofing'],
    q13_rcc_expert_intervention_other: '',       q13_rcc_subscribe_details: '',
  },
};

// ─── 2. STEEL STRUCTURE ───────────────────────────────────────────────────────
const steel = {
  userDetails: {
    name: 'Priya Sharma', email: 'priya.test@example.com',
    phone: '9123456780', phoneCountryCode: '+91',
    organization: 'SPPL Test Suite', structureType: 'Steel Structure',
    q1: 'Civil Engineer', q1Other: '', yearOfConstruction: 2005, location: 'Bengaluru',
  },
  responses: {
    q1_steel_age: '15',              q1_steel_ageRange: '11-20 years',
    q1_steel_country: 'India',       q1_steel_country_other: '',
    q1_steel_state: 'Karnataka',     q1_steel_state_other: '',
    q1_steel_city: 'Bengaluru',      q1_steel_city_other: '',
    q1_steel_storeys_above: '8',     q1_steel_storeys_below: '0',
    q2_steel_usage: 'Commercial',    q2_steel_usage_other: '',
    q3_steel_exposure_type: 'Industrial', q3_steel_exposure_other: '',
    q4_steel_floors_added: 'No',     q4_steel_floors_added_after: '',
    q4_steel_floors_details: '',     q4_steel_heavy_machinery: 'Yes',
    q5_structural_system: 'Steel Structure',
    // Q6 — Corrosion
    q6_steel_corrosion_has: 'Yes',
    q6_steel_corrosion_elements: ['Steel beams', 'Steel columns'],
    q6_steel_corrosion_elements_other: '',
    q6_steel_corrosion_beam_locations: ['Flange', 'Web'],
    q6_steel_corrosion_beam_locations_other: '',
    q6_steel_corrosion_beam_characteristics: ['Surface rust', 'Pitting'],
    q6_steel_corrosion_beam_characteristics_other: '',
    q6_steel_corrosion_column_locations: ['Base plate', 'Mid-height'],
    q6_steel_corrosion_column_locations_other: '',
    q6_steel_corrosion_column_characteristics: ['Surface rust'],
    q6_steel_corrosion_column_characteristics_other: '',
    // Q7 — Deformation
    q7_steel_deformation_has: 'Yes',
    q7_steel_deformation_types: ['Deflection', 'Buckling'],
    q7_steel_deformation_types_other: '',
    q7_steel_beam_deflection_elements: ['Steel beams'],
    q7_steel_beam_deflection_elements_other: '',
    q7_steel_buckling_elements: ['Bracing'],
    q7_steel_buckling_elements_other: '',
    // Q8 — Connections
    q8_steel_connections_has: 'Yes',
    q8_steel_connections_types: ['Loose bolts', 'Weld cracks'],
    q8_steel_connections_types_other: '',
    q8_steel_loose_bolts_locations: ['Beam-column joints'],
    q8_steel_loose_bolts_locations_other: '',
    q8_steel_weld_cracks_locations: ['Gusset plates'],
    q8_steel_weld_cracks_locations_other: '',
    // Q9 — Protective Coating
    q9_steel_coating_has: 'Yes',
    q9_steel_coating_types: ['Paint peeling', 'No coating'],
    q9_steel_coating_types_other: '',
    q9_steel_coating_elements: ['Steel beams'],
    q9_steel_coating_elements_other: '',
    // Q10 — Fire
    q10_steel_fire_has: 'No',
    // Q11 — Vibration
    q11_steel_vibration_has: 'Yes',
    q11_steel_vibration_sources: ['Heavy machinery'],
    q11_steel_vibration_sources_other: '',
    // Q12 — Soil
    q12_steel_soil_type: 'Clayey',     q12_steel_soil_type_other: '',
    q12_steel_ground_issues_has: 'No',
    // Q13 — Disasters
    q13_steel_disaster_has: 'No',
    // Q14 — Remedial
    q14_steel_expert_intervention_has: 'Yes',
    q14_steel_expert_intervention_types: ['Anti-corrosion coating'],
    q14_steel_expert_intervention_other: '',
    q14_steel_subscribe_details: '',
  },
};

// ─── 3. COMPOSITE STRUCTURE ───────────────────────────────────────────────────
const composite = {
  userDetails: {
    name: 'Anita Verma', email: 'anita.test@example.com',
    phone: '9988776655', phoneCountryCode: '+91',
    organization: 'SPPL Test Suite', structureType: 'Composite Structure (RCC + Steel)',
    q1: 'Architect', q1Other: '', yearOfConstruction: 2012, location: 'New Delhi',
  },
  responses: {
    // Q1 (shared base keys — no composite prefix)
    q1_age: '10',                q1_ageRange: '6-10 years',
    q1_country: 'India',         q1_country_other: '',
    q1_state: 'Delhi',           q1_state_other: '',
    q1_city: 'New Delhi',        q1_city_other: '',
    q1_storeys_above: '12',      q1_storeys_below: '2',
    q2_usage: 'Commercial',      q2_usage_other: '',
    q3_exposure_type: 'Urban',   q3_exposure_other: '',
    q4_floors_added: 'No',       q4_floors_added_after: '',
    q4_floors_details: '',       q4_heavy_machinery: 'No',
    q5_structural_system: 'Composite Structure (RCC + Steel)',
    // Q6 — Connection Distress
    q6_composite_connections_has: 'Yes',
    q6_composite_connections_types: ['Gaps observed between connected steel components'],
    q6_composite_connections_types_other: '',
    q6_composite_gaps_conditions: ['Thermal expansion'],
    q6_composite_gaps_conditions_other: '',
    q6_composite_gaps_locations: ['Beam-column joint'],
    q6_composite_gaps_locations_other: '',
    q6_composite_bent_plates_locations: [],
    q6_composite_bent_plates_locations_other: '',
    q6_composite_anchor_locations: [],
    q6_composite_anchor_locations_other: '',
    // Q7 — Cracks
    q7_composite_cracks_has: 'Yes',
    q7_composite_cracks_elements: ['Composite floor slabs'],
    q7_composite_cracks_elements_other: '',
    q7_composite_loc_floor_slab: ['Centre panel', 'Near column'],
    q7_composite_loc_floor_slab_other: '',
    q7_composite_floor_orientations: ['Map/spider web pattern'],
    q7_composite_floor_orientations_other: '',
    // Q8 — Deformation
    q8_composite_deformation_has: 'No',
    q8_composite_deformation_types: [],       q8_composite_deformation_types_other: '',
    // Q9 — Spalling
    q9_composite_spalling_has: 'No',
    q9_composite_spalling_elements: [],       q9_composite_spalling_elements_other: '',
    // Q10 — Moisture
    q10a_composite_damp_has: 'No',
    q10b_composite_white_has: 'No',
    q10c_composite_green_has: 'No',
    // Q11 — Corrosion
    q11a_composite_corrosion_has: 'Yes',
    q11a_composite_corrosion_types: ['Surface rust'],
    q11a_composite_corrosion_types_other: '',
    q11a_composite_corrosion_elements: ['Steel beams'],
    q11a_composite_corrosion_elements_other: '',
    q11a_composite_corrosion_steel_beams_locations: ['Exposed flange'],
    q11a_composite_corrosion_steel_beams_locations_other: '',
    q11a_composite_corrosion_steel_beams_characteristics: ['Pitting corrosion'],
    q11a_composite_corrosion_steel_beams_characteristics_other: '',
    // Q12 — Vibration
    q12a_composite_vibration_has: 'No',
    q12b_composite_recurring_has: 'No',
    // Q13 — Soil
    q13_composite_soil_types: ['Sandy'],      q13_composite_soil_types_other: '',
    q13_composite_ground_issues_has: 'No',
    q13_composite_ground_issues: [],          q13_composite_ground_issues_other: '',
    // Q14 — Disasters
    q14_composite_disaster_has: 'No',
    q14_composite_disaster_types: [],         q14_composite_disaster_types_other: '',
    q14_composite_earthquake_intensity: '',
    // Q15 — Remedial
    q15_composite_expert_intervention_has: 'No',
    q15_composite_expert_intervention_types:[],
    q15_composite_expert_intervention_other:'',
    q15_composite_subscribe_details: '',
  },
};

// ─── 4. HERITAGE STRUCTURE ────────────────────────────────────────────────────
const heritage = {
  userDetails: {
    name: 'Suresh Patel', email: 'suresh.test@example.com',
    phone: '9001122334', phoneCountryCode: '+91',
    organization: 'SPPL Test Suite', structureType: 'Heritage Structure',
    q1: 'Conservation Architect', q1Other: '', yearOfConstruction: 1902, location: 'Jaipur',
  },
  responses: {
    q1_heritage_age: '120',            q1_heritage_ageRange: '>100 years',
    q1_heritage_country: 'India',      q1_heritage_country_other: '',
    q1_heritage_state: 'Rajasthan',    q1_heritage_state_other: '',
    q1_heritage_city: 'Jaipur',        q1_heritage_city_other: '',
    q1_heritage_storeys_above: '2',    q1_heritage_storeys_below: '0',
    q2_heritage_usage: 'Cultural / Heritage', q2_heritage_usage_other: '',
    q3_heritage_exposure_type: 'Arid / Semi-arid', q3_heritage_exposure_other: '',
    q4_heritage_floors_added: 'No',    q4_heritage_floors_added_after: '',
    q4_heritage_floors_details: '',    q4_heritage_heavy_machinery: 'No',
    q5_structural_system: 'Heritage Structure',
    // Q6 — Cracks
    q6_heritage_cracks_has: 'Yes',
    q6_heritage_crack_elements: ['Stone walls', 'Arches'],
    q6_heritage_crack_elements_other: '',
    q6_heritage_wall_locations: ['Corner junction', 'Window lintel'],
    q6_heritage_wall_locations_other: '',
    q6_heritage_wall_orientations: ['Diagonal', 'Vertical'],
    q6_heritage_wall_orientations_other: '',
    q6_heritage_arch_locations: ['Crown', 'Springing line'],
    q6_heritage_arch_locations_other: '',
    q6_heritage_arch_orientations: ['Radial'],
    q6_heritage_arch_orientations_other: '',
    q6_heritage_widths: ['0.1–0.3 mm (Fine)'],
    q6_heritage_widths_other: '',
    // Q7 — Spalling
    q7_heritage_spalling_has: 'Yes',
    q7_heritage_spalling_elements: ['Stone facade', 'Plasterwork'],
    q7_heritage_spalling_elements_other: '',
    q7_heritage_spalling_locations: ['Sunlit face', 'Base'],
    q7_heritage_spalling_locations_other: '',
    // Q8 — Moisture
    q8_heritage_moisture_has: 'Yes',
    q8_heritage_moisture_locations: ['Basement level', 'Roof parapet'],
    q8_heritage_moisture_locations_other: '',
    q8_heritage_seepage_has: 'No',
    q8_heritage_white_deposits_has: 'Yes',
    q8_heritage_white_deposits_locations: ['Stone walls'],
    q8_heritage_white_deposits_locations_other: '',
    // Q9 — Biological Growth
    q9_heritage_bio_has: 'Yes',
    q9_heritage_bio_types: ['Moss', 'Lichen'],      q9_heritage_bio_types_other: '',
    q9_heritage_bio_locations: ['North face', 'Plinth area'],
    q9_heritage_bio_locations_other: '',
    // Q10 — Disasters
    q10_heritage_disaster_has: 'Yes',
    q10_heritage_disaster_types: ['Earthquake'],    q10_heritage_disaster_types_other: '',
    q10_heritage_earthquake_intensity: 'Low',
    // Q11 — Remedial
    q11_heritage_expert_intervention_has: 'Yes',
    q11_heritage_expert_intervention_types: ['Stone consolidation', 'Repointing'],
    q11_heritage_expert_intervention_other: '',
    q11_heritage_subscribe_details: '',
  },
};

// ─── 5. LOAD BEARING MASONRY ──────────────────────────────────────────────────
const loadbearing = {
  userDetails: {
    name: 'Deepika Nair', email: 'deepika.test@example.com',
    phone: '9444333222', phoneCountryCode: '+91',
    organization: 'SPPL Test Suite', structureType: 'Load Bearing Masonry',
    q1: 'Structural Engineer', q1Other: '', yearOfConstruction: 1972, location: 'Chennai',
  },
  responses: {
    q1_lb_age: '50',               q1_lb_ageRange: '41-50 years',
    q1_lb_country: 'India',        q1_lb_country_other: '',
    q1_lb_state: 'Tamil Nadu',     q1_lb_state_other: '',
    q1_lb_city: 'Chennai',         q1_lb_city_other: '',
    q1_lb_storeys_above: '3',      q1_lb_storeys_below: '0',
    q2_lb_usage: 'Residential',    q2_lb_usage_other: '',
    q3_lb_exposure_type: 'Coastal',q3_lb_exposure_other: '',
    q4_lb_floors_added: 'Yes',     q4_lb_floors_added_after: '1990',
    q4_lb_floors_details: 'One additional storey added',
    q4_lb_heavy_machinery: 'No',
    q5_structural_system: 'Load Bearing Masonry',
    // Q6 — Cracks
    q6_lb_cracks_has: 'Yes',
    q6_lb_crack_elements: ['Exterior brick walls', 'Internal partition walls'],
    q6_lb_crack_elements_other: '',
    q6_lb_ext_wall_locations: ['Corner', 'Above door/window openings'],
    q6_lb_ext_wall_locations_other: '',
    q6_lb_ext_wall_orientations: ['Diagonal', 'Vertical'],
    q6_lb_ext_wall_orientations_other: '',
    q6_lb_int_wall_locations: ['Junction with floors'],
    q6_lb_int_wall_locations_other: '',
    q6_lb_int_wall_orientations: ['Horizontal'],
    q6_lb_int_wall_orientations_other: '',
    q6_lb_widths: ['0.3–1.0 mm (Medium)'],
    q6_lb_widths_other: '',
    // Q7 — Spalling
    q7_lb_spalling_has: 'Yes',
    q7_lb_spalling_elements: ['Brick walls', 'Plasterwork'],
    q7_lb_spalling_elements_other: '',
    q7_lb_spalling_locations: ['Base of walls', 'Window sills'],
    q7_lb_spalling_locations_other: '',
    // Q8 — Moisture
    q8_lb_moisture_has: 'Yes',
    q8_lb_moisture_locations: ['Ground floor walls'],
    q8_lb_moisture_locations_other: '',
    q8_lb_seepage_has: 'Yes',
    q8_lb_seepage_locations: ['Roof junction'],
    q8_lb_seepage_locations_other: '',
    q8_lb_white_deposits_has: 'Yes',
    q8_lb_white_deposits_locations: ['Exterior walls'],
    q8_lb_white_deposits_locations_other: '',
    // Q9 — Deformation
    q9_lb_deflection_has: 'No',    q9_lb_tilt_has: 'No',
    q9_lb_settlement_has: 'Yes',
    q9_lb_settlement_locations: ['Corner column base'],
    q9_lb_settlement_locations_other: '',
    // Q10 — Soil
    q10_lb_soil_type: 'Expansive black cotton', q10_lb_soil_type_other: '',
    q10_lb_ground_issues_has: 'Yes',
    q10_lb_ground_issues: ['Water logging during monsoon'],
    q10_lb_ground_issues_other: '',
    // Q11 — Vibration
    q11_lb_vibration_has: 'No',
    // Q12 — Disasters
    q12_lb_disaster_has: 'Yes',
    q12_lb_disaster_types: ['Flood', 'Earthquake'],
    q12_lb_disaster_types_other: '',
    q12_lb_earthquake_intensity: 'Low',
    // Q13 — Remedial
    q13_lb_expert_intervention_has: 'Yes',
    q13_lb_expert_intervention_types: ['Crack stitching', 'Waterproofing treatment'],
    q13_lb_expert_intervention_other: '',
    q13_lb_subscribe_details: '',
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  VERIFICATION HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function deepEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  // MongoDB may return numbers as strings or vice-versa for Mixed fields — normalise
  return String(a) === String(b);
}

/**
 * Compares every key in `sent` against `saved` (from DB).
 * Returns { passed, missing, mismatched }
 */
function verifyFields(sent, saved, label) {
  const missing    = [];
  const mismatched = [];
  let passCount    = 0;

  for (const [key, sentVal] of Object.entries(sent)) {
    if (!(key in saved)) {
      missing.push(key);
    } else if (!deepEqual(sentVal, saved[key])) {
      mismatched.push({ key, sent: sentVal, got: saved[key] });
    } else {
      passCount++;
    }
  }

  const total  = Object.keys(sent).length;
  const passed = missing.length === 0 && mismatched.length === 0;

  info(`${label}: ${passCount}/${total} fields verified`);

  if (missing.length) {
    fail(`  MISSING (${missing.length}) — fields not saved to DB at all:`);
    missing.forEach(k => sub(R(k)));
  }
  if (mismatched.length) {
    fail(`  MISMATCHED (${mismatched.length}) — saved with wrong value:`);
    mismatched.forEach(({ key, sent: s, got: g }) => {
      sub(Y(key) + `\n      sent: ${JSON.stringify(s)}\n      got:  ${JSON.stringify(g)}`);
    });
  }
  if (passed) ok(`All ${total} fields saved correctly`);

  return { passed, missing, mismatched, total, passCount };
}

function verifyUserDetails(sent, saved) {
  const fields = ['name','email','phone','organization','structureType','q1','q1Other','location'];
  const missing = []; const mismatched = []; let passCount = 0;

  for (const key of fields) {
    if (!(key in saved)) {
      missing.push(key);
    } else if (String(sent[key] || '') !== String(saved[key] || '')) {
      mismatched.push({ key, sent: sent[key], got: saved[key] });
    } else {
      passCount++;
    }
  }
  const total  = fields.length;
  const passed = missing.length === 0 && mismatched.length === 0;
  info(`userDetails: ${passCount}/${total} fields verified`);
  if (missing.length)    { fail(`  MISSING userDetails fields:`); missing.forEach(k => sub(R(k))); }
  if (mismatched.length) {
    fail(`  MISMATCHED userDetails fields:`);
    mismatched.forEach(({ key, sent: s, got: g }) =>
      sub(Y(key) + ` → sent: "${s}"  got: "${g}"`));
  }
  if (passed) ok(`All ${total} userDetails fields saved correctly`);
  return { passed, missing, mismatched, total, passCount };
}

// ══════════════════════════════════════════════════════════════════════════════
//  CORE TEST RUNNER
// ══════════════════════════════════════════════════════════════════════════════
async function runTest(label, { userDetails, responses }) {
  head(label);

  const keyCount = Object.keys(responses).length;
  info(`Sending ${keyCount} response keys → POST /api/save-assessment`);

  // ── Save ──────────────────────────────────────────────────────────────────
  let saveRes;
  try {
    saveRes = await axios.post(`${API_URL}/api/save-assessment`, {
      userDetails,
      assessmentResponses: responses,
      assessmentType: 'Building',
    }, { timeout: 15000 });
  } catch (err) {
    fail(`Save failed: ${err.response?.data?.details || err.message}`);
    return { passed: false, label };
  }

  if (saveRes.status !== 201 || !saveRes.data.success) {
    fail(`Unexpected save response: ${saveRes.status} ${JSON.stringify(saveRes.data)}`);
    return { passed: false, label };
  }
  const id = saveRes.data.assessmentId;
  ok(`Saved → ID: ${id}`);

  // ── Fetch back ────────────────────────────────────────────────────────────
  let doc;
  try {
    const getRes = await axios.get(`${API_URL}/api/assessment/${id}`, { timeout: 10000 });
    doc = getRes.data;
  } catch (err) {
    fail(`Could not fetch saved assessment: ${err.message}`);
    return { passed: false, label };
  }
  ok(`Fetched from DB successfully`);

  // ── assessmentType check ──────────────────────────────────────────────────
  if (doc.assessmentType === 'Building') {
    ok(`assessmentType = "Building" ✓`);
  } else {
    fail(`assessmentType mismatch: got "${doc.assessmentType}"`);
  }

  // ── userDetails check ─────────────────────────────────────────────────────
  console.log(`\n  ${B('— userDetails —')}`);
  const udResult = verifyUserDetails(userDetails, doc.userDetails || {});

  // ── responses check ───────────────────────────────────────────────────────
  console.log(`\n  ${B('— responses (flat key store) —')}`);
  const rResult  = verifyFields(responses, doc.responses || {}, 'responses');

  // ── assessmentResponses check (nested raw) ────────────────────────────────
  console.log(`\n  ${B('— assessmentResponses.raw_responses —')}`);
  const rawStored = doc.assessmentResponses?.raw_responses || doc.assessmentResponses || {};
  const arResult  = verifyFields(responses, rawStored, 'assessmentResponses');

  const allPassed = udResult.passed && rResult.passed && arResult.passed &&
                    doc.assessmentType === 'Building';

  const totalSent   = keyCount;
  const totalPassed = rResult.passCount;

  return {
    passed: allPassed,
    label,
    id,
    totalSent,
    totalPassed,
    missing:    [...rResult.missing,    ...arResult.missing],
    mismatched: [...rResult.mismatched, ...arResult.mismatched],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════════════════════
const SUITE = [
  { label: '1. RCC Structure',                   data: rcc         },
  { label: '2. Steel Structure',                 data: steel       },
  { label: '3. Composite Structure (RCC+Steel)', data: composite   },
  { label: '4. Heritage Structure',              data: heritage    },
  { label: '5. Load Bearing Masonry',            data: loadbearing },
];

async function main() {
  console.log(B('\n══════════════════════════════════════════════════'));
  console.log(B('  OSHAS — Basic Questionnaire Deep DB Verify'));
  console.log(B(`  API: ${API_URL}`));
  console.log(B('══════════════════════════════════════════════════'));

  // Health check
  try {
    const h = await axios.get(`${API_URL}/api/health`, { timeout: 5000 });
    ok(`Server reachable — DB: ${h.data.database}`);
  } catch (e) {
    fail(`Cannot reach ${API_URL} — is the server running?\n  ${e.message}`);
    process.exit(1);
  }

  const results = [];
  for (const { label, data } of SUITE) {
    const r = await runTest(label, data);
    results.push(r);
  }

  // ── Grand summary ─────────────────────────────────────────────────────────
  head('FINAL SUMMARY');
  const cols = ['Structure Type', 'Status', 'Fields Sent', 'Fields Saved', 'Missing', 'Mismatch'];
  const rows = results.map(r => [
    r.label,
    r.passed ? G('PASS') : R('FAIL'),
    String(r.totalSent  || 0),
    String(r.totalPassed|| 0),
    String((r.missing   || []).length),
    String((r.mismatched|| []).length),
  ]);

  const widths = cols.map((c, i) => Math.max(c.length,
    ...rows.map(r => r[i].replace(/\x1b\[[0-9;]*m/g, '').length)));

  const fmt = row => row.map((v, i) =>
    v.replace(/\x1b\[[0-9;]*m/g, '').padEnd(widths[i])
     .replace(/^(.*)$/, v.includes('\x1b') ? v + ' '.repeat(Math.max(0, widths[i] - v.replace(/\x1b\[[0-9;]*m/g, '').length)) : v)
  ).join('  ');

  console.log('\n  ' + B(fmt(cols)));
  console.log('  ' + '─'.repeat(widths.reduce((a,b)=>a+b+2,0)));
  rows.forEach(r => console.log('  ' + fmt(r)));

  const allPassed = results.every(r => r.passed);
  const totalMissing = results.reduce((s, r) => s + (r.missing || []).length, 0);

  console.log();
  if (allPassed) {
    console.log(G(B(`  ✔  All ${results.length} structure types — every field saved correctly to MongoDB!`)));
  } else {
    const failed = results.filter(r => !r.passed).length;
    console.log(R(B(`  ✘  ${failed}/${results.length} tests FAILED — ${totalMissing} fields missing from DB`)));
  }
  console.log();
  process.exit(allPassed ? 0 : 1);
}

main().catch(e => { fail(`Crash: ${e.message}`); process.exit(1); });
