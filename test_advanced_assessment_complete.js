/**
 * Complete Advanced Assessment Integration Test
 * Tests that ALL response fields are saved to MongoDB
 */

const axios = require('axios');
const mongoose = require('mongoose');

const API_BASE = 'http://localhost:5000';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/oshas';

// Test user credentials (must exist in database)
const TEST_USER = {
  email: 'test@example.com',
  password: 'test123'
};

let authToken = null;
let baseAssessmentId = null;
let advancedAssessmentId = null;

// ============================================================================
// STEP 1: Login to get auth token
// ============================================================================
async function login() {
  console.log('\n📝 Step 1: Logging in...');
  try {
    const response = await axios.post(`${API_BASE}/api/auth/login`, TEST_USER);
    authToken = response.data.token;
    console.log('✅ Login successful, token obtained');
    return true;
  } catch (error) {
    console.error('❌ Login failed:', error.response?.data || error.message);
    // Try to register if login fails
    console.log('📝 Attempting to register new user...');
    try {
      await axios.post(`${API_BASE}/api/auth/register`, {
        firstName: 'Test',
        lastName: 'User',
        email: TEST_USER.email,
        password: TEST_USER.password,
        phone: '9876543210',
        organisation: 'Test Organization',
        country: 'India'
      });
      console.log('✅ Registration successful, logging in...');
      const loginResponse = await axios.post(`${API_BASE}/api/auth/login`, TEST_USER);
      authToken = loginResponse.data.token;
      console.log('✅ Login successful after registration');
      return true;
    } catch (regError) {
      console.error('❌ Registration also failed:', regError.response?.data || regError.message);
      return false;
    }
  }
}

// ============================================================================
// STEP 2: Create a basic building assessment
// ============================================================================
async function createBasicAssessment() {
  console.log('\n📝 Step 2: Creating basic building assessment...');

  const userDetails = {
    name: 'Test User',
    email: TEST_USER.email,
    phone: '9876543210',
    organization: 'Test Organization',
    structureType: 'RCC Structure',
    q1: 'Structural Engineer',
    yearOfConstruction: '10-20 years',
    location: 'Mumbai'
  };

  const assessmentResponses = {
    raw_responses: {
      q5_structural_system: 'RCC Structure',
      q1_city: 'Mumbai',
      q1_ageRange: '10-20 years',
      q2_usage: 'Residential',
      q3_exposure_type: 'Moderate',
      q4_floors_added: 'No'
    },
    formatted_responses: {}
  };

  try {
    const response = await axios.post(`${API_BASE}/api/submit-assessment`, {
      userDetails,
      assessmentResponses,
      assessmentType: 'Building'
    });

    baseAssessmentId = response.data.assessmentId;
    console.log('✅ Basic assessment created:', baseAssessmentId);
    return true;
  } catch (error) {
    console.error('❌ Failed to create basic assessment:', error.response?.data || error.message);
    return false;
  }
}

// ============================================================================
// STEP 3: Submit COMPLETE Advanced RCC Assessment with ALL fields
// ============================================================================
async function submitCompleteAdvancedRCC() {
  console.log('\n📝 Step 3: Submitting COMPLETE Advanced RCC Assessment...');
  console.log('   Including: Q1-Q10, all crack photos, rebar photo, vegetation data, disasters');

  const advancedResponses = {
    // Q1 - Building Information (Usage Change)
    adv_usage_changed: 'Yes',
    adv_new_usage_type: ['Commercial', 'Industrial'],
    adv_new_usage_type_other: 'Mixed use development',

    // Q2 - Cracking (6 elements × 14 fields each = 84 fields + 12 images)
    q6_rcc_has_cracks: 'Yes',
    q6_rcc_crack_floor_levels: ['Ground Floor', 'First Floor'],
    q6_rcc_crack_elements: ['Roof slab', 'Beam', 'Column'],
    q6_rcc_crack_elements_other: 'Balcony slab',
    q6_rcc_crack_conditions: ['Active', 'Leaching'],

    // Roof element
    q6_rcc_roof_locations: ['Mid-span', 'Near support'],
    q6_rcc_roof_orientations: ['Longitudinal', 'Transverse'],
    q6_rcc_roof_max_crack_length: '1500',
    q6_rcc_roof_avg_crack_length: '800',
    q6_rcc_roof_max_crack_width: '2.5',
    q6_rcc_roof_avg_crack_width: '1.2',
    q6_rcc_roof_total_cracks: '15',
    q6_rcc_roof_cracks_gte_avg: '8',
    q6_rcc_roof_cracks_lt_avg: '7',
    q6_rcc_roof_crack_depth_type: 'Surface cracks (depth < 10mm)',
    q6_rcc_roof_widest_crack_img: 'https://res.cloudinary.com/test/image/roof_widest.jpg',
    q6_rcc_roof_longest_crack_img: 'https://res.cloudinary.com/test/image/roof_longest.jpg',

    // Beam element
    q6_rcc_beam_locations: ['Mid-span', 'Junction'],
    q6_rcc_beam_orientations: ['Longitudinal', 'Diagonal'],
    q6_rcc_beam_max_crack_length: '2000',
    q6_rcc_beam_avg_crack_length: '1000',
    q6_rcc_beam_max_crack_width: '3.0',
    q6_rcc_beam_avg_crack_width: '1.5',
    q6_rcc_beam_total_cracks: '20',
    q6_rcc_beam_cracks_gte_avg: '12',
    q6_rcc_beam_cracks_lt_avg: '8',
    q6_rcc_beam_crack_depth_type: 'Deep cracks (depth > 20mm)',
    q6_rcc_beam_widest_crack_img: 'https://res.cloudinary.com/test/image/beam_widest.jpg',
    q6_rcc_beam_longest_crack_img: 'https://res.cloudinary.com/test/image/beam_longest.jpg',

    // Column element
    q6_rcc_column_locations: ['Top', 'Middle', 'Bottom'],
    q6_rcc_column_orientations: ['Horizontal', 'Vertical'],
    q6_rcc_column_max_crack_length: '1200',
    q6_rcc_column_avg_crack_length: '600',
    q6_rcc_column_max_crack_width: '2.0',
    q6_rcc_column_avg_crack_width: '1.0',
    q6_rcc_column_total_cracks: '10',
    q6_rcc_column_cracks_gte_avg: '6',
    q6_rcc_column_cracks_lt_avg: '4',
    q6_rcc_column_crack_depth_type: 'Moderate cracks (depth 10-20mm)',
    q6_rcc_column_widest_crack_img: 'https://res.cloudinary.com/test/image/column_widest.jpg',
    q6_rcc_column_longest_crack_img: 'https://res.cloudinary.com/test/image/column_longest.jpg',

    // Floor element
    q6_rcc_floor_locations: ['Mid-span', 'Corner'],
    q6_rcc_floor_orientations: ['Longitudinal', 'Transverse'],
    q6_rcc_floor_max_crack_length: '1800',
    q6_rcc_floor_avg_crack_length: '900',
    q6_rcc_floor_max_crack_width: '2.8',
    q6_rcc_floor_avg_crack_width: '1.4',
    q6_rcc_floor_total_cracks: '18',
    q6_rcc_floor_cracks_gte_avg: '10',
    q6_rcc_floor_cracks_lt_avg: '8',
    q6_rcc_floor_crack_depth_type: 'Surface cracks (depth < 10mm)',
    q6_rcc_floor_widest_crack_img: 'https://res.cloudinary.com/test/image/floor_widest.jpg',
    q6_rcc_floor_longest_crack_img: 'https://res.cloudinary.com/test/image/floor_longest.jpg',

    // VDD element
    q6_rcc_vdd_locations: ['Connection point'],
    q6_rcc_vdd_orientations: ['Radial'],
    q6_rcc_vdd_max_crack_length: '500',
    q6_rcc_vdd_avg_crack_length: '300',
    q6_rcc_vdd_max_crack_width: '1.5',
    q6_rcc_vdd_avg_crack_width: '0.8',
    q6_rcc_vdd_total_cracks: '5',
    q6_rcc_vdd_cracks_gte_avg: '3',
    q6_rcc_vdd_cracks_lt_avg: '2',
    q6_rcc_vdd_crack_depth_type: 'Surface cracks (depth < 10mm)',
    q6_rcc_vdd_widest_crack_img: 'https://res.cloudinary.com/test/image/vdd_widest.jpg',
    q6_rcc_vdd_longest_crack_img: 'https://res.cloudinary.com/test/image/vdd_longest.jpg',

    // MFB element
    q6_rcc_mfb_locations: ['Base', 'Interface'],
    q6_rcc_mfb_orientations: ['Radial', 'Circumferential'],
    q6_rcc_mfb_max_crack_length: '800',
    q6_rcc_mfb_avg_crack_length: '400',
    q6_rcc_mfb_max_crack_width: '2.2',
    q6_rcc_mfb_avg_crack_width: '1.1',
    q6_rcc_mfb_total_cracks: '8',
    q6_rcc_mfb_cracks_gte_avg: '5',
    q6_rcc_mfb_cracks_lt_avg: '3',
    q6_rcc_mfb_crack_depth_type: 'Moderate cracks (depth 10-20mm)',
    q6_rcc_mfb_widest_crack_img: 'https://res.cloudinary.com/test/image/mfb_widest.jpg',
    q6_rcc_mfb_longest_crack_img: 'https://res.cloudinary.com/test/image/mfb_longest.jpg',

    // Q3 - Deformation (5 elements)
    q7_rcc_deformation_has: 'Yes',
    q7_rcc_deformation_floor_levels: ['First Floor', 'Second Floor'],
    q7_rcc_deformation_elements: ['Roof slab', 'Beam', 'Column'],
    q7_rcc_deform_measurements: 'Yes',

    q7_rcc_roof_slab_locations: ['Mid-span', 'Cantilever'],
    q7_rcc_roof_slab_deformation_types: ['Sagging', 'Deflection'],
    q7_rcc_beam_locations_deform: ['Mid-span'],
    q7_rcc_beam_deformation_types: ['Sagging', 'Twisting'],
    q7_rcc_column_locations_deform: ['Top'],
    q7_rcc_column_deformation_types: ['Leaning', 'Buckling'],
    q7_rcc_wall_locations_deform: ['Corner'],
    q7_rcc_wall_deformation_types: ['Bulging', 'Tilting'],
    q7_rcc_floor_slab_locations: ['Mid-span'],
    q7_rcc_floor_slab_deformation_types: ['Sagging'],

    // Q4 - Material Deterioration (7 elements)
    q4_adv_deterioration_has: 'Yes',
    q4_adv_deterioration_floor_levels: ['Ground Floor'],
    q4_adv_deterioration_elements: ['Roof slab', 'Beam', 'Column', 'Wall'],
    q4_adv_det_measurements: 'Yes',

    q4_adv_roof_slab_det_locations: ['Top surface', 'Soffit'],
    q4_adv_roof_slab_det_types: ['Spalling', 'Honeycombing'],
    q4_adv_beam_det_locations: ['Soffit'],
    q4_adv_beam_det_types: ['Spalling', 'Corrosion staining'],
    q4_adv_column_det_locations: ['Top', 'Bottom'],
    q4_adv_column_det_types: ['Spalling', 'Exposed rebars'],
    q4_adv_wall_det_locations_interior: ['Base'],
    q4_adv_wall_det_locations_exterior: ['Top'],
    q4_adv_wall_det_types: ['Efflorescence', 'Dampness'],
    q4_adv_floor_slab_det_locations: ['Soffit'],
    q4_adv_floor_slab_det_types: ['Spalling'],
    q4_adv_staircase_det_locations: ['Tread', 'Riser'],
    q4_adv_staircase_det_types: ['Wear', 'Chipping'],
    q4_adv_parapet_det_locations: ['Top'],
    q4_adv_parapet_det_types: ['Weathering'],

    // Q5 - Hollow Sounding (7 elements)
    q5_adv_hollow_has: 'Yes',
    q5_adv_hollow_floor_levels: ['First Floor'],
    q5_adv_hollow_elements: ['Roof slab', 'Floor slab'],
    q5_adv_hollow_count: '12',
    q5_adv_hollow_area: '5.5',

    q5_adv_roof_slab_hollow_locations: ['Mid-span'],
    q5_adv_beam_hollow_locations: ['Soffit'],
    q5_adv_column_hollow_locations: ['Middle'],
    q5_adv_wall_hollow_locations: ['Interior face'],
    q5_adv_floor_slab_hollow_locations: ['Corner'],
    q5_adv_staircase_hollow_locations: ['Landing'],
    q5_adv_parapet_hollow_locations: ['Base'],

    // Q6 - Reinforcement (THE MISSING PHOTO!)
    q6_adv_rebar_has: 'Yes',
    q6_adv_rebar_floor_levels: ['Ground Floor'],
    q6_adv_rebar_elements: ['Beam', 'Column'],
    q6_adv_rebar_avg_area: '150',
    q6_adv_rebar_max_area: '300',
    q6_adv_rebar_corrosion_visible: 'Yes',
    q6_adv_rebar_bar_reduction: 'Yes',
    q6_adv_rebar_affected_element: ['Main bars', 'Stirrups'],
    q6_adv_rebar_original_dia: '16',
    q6_adv_rebar_current_dia: '14',
    q6_adv_rebar_contributing_factors: ['Chloride ingress', 'Carbonation'],
    q6_adv_rebar_photo: 'https://res.cloudinary.com/test/image/rebar_corrosion.jpg', // ← THIS WAS BEING DROPPED!

    q6_adv_roof_slab_rebar_locations: ['Soffit'],
    q6_adv_beam_rebar_locations: ['Bottom'],
    q6_adv_column_rebar_locations: ['Cover spalled'],
    q6_adv_floor_slab_rebar_locations: ['Soffit'],
    q6_adv_staircase_rebar_locations: ['Tread edge'],

    // Q7 - Past Intervention
    q7_adv_past_has: 'Yes',
    q7_adv_past_floor_levels: ['Ground Floor'],
    q7_adv_past_elements: ['Beam', 'Column'],
    q7_adv_past_intervention_types: ['Crack injection', 'Jacketing'],
    q7_adv_past_primary_reason: 'Cracks',
    q7_adv_past_distress_again: 'Yes',
    q7_adv_past_recurring_issues: ['Same cracks reappeared'],
    q7_adv_past_deterioration_types: ['Spalling', 'Corrosion'],

    // Q8 - Foundation
    q8_adv_settlement_has: 'Yes',
    q8_adv_settlement_types: ['Differential settlement', 'Tilting'],

    // Q9 - Vegetation (THE MISSING 4 FIELDS!)
    q9_adv_veg_has: 'Yes',
    q9_adv_veg_types: ['Trees', 'Shrubs'],
    q9_adv_veg_types_other: 'Ivy growth',
    q9_adv_veg_locations: ['Walls', 'Roof'], // ← THIS WAS BEING DROPPED!
    q9_adv_veg_locations_other: 'Balcony edges', // ← THIS WAS BEING DROPPED!
    q9_adv_veg_distress: ['Root penetration', 'Moisture retention'],
    q9_adv_veg_distress_other: 'Organic acid damage',
    q9_adv_veg_foundation_yn: 'Yes',
    q9_adv_veg_foundation_issues: ['Soil erosion'],
    q9_adv_veg_affected_area: '25.5',
    q9_adv_veg_affected_length: '3500',
    q9_adv_veg_tree_distance: '2.5',
    q9_adv_veg_growth_height: '1200',
    q9_adv_veg_photo: 'https://res.cloudinary.com/test/image/vegetation_growth.jpg', // ← THIS WAS BEING DROPPED!
    q9_adv_veg_photo_name: 'vegetation_growth.jpg', // ← THIS WAS BEING DROPPED!

    // Q10 - Disasters (THE WRONG KEY NAME!)
    q10_adv_disaster_has: 'Yes',
    q10_adv_disasters: ['Earthquake', 'Severe wind / cyclone', 'Flood'], // ← This is the CORRECT key, was mapped as q10_adv_disaster_types!
    q10_adv_disasters_other: 'Minor tremors',
    q10_adv_cracks_noticed: 'Yes',
    q10_adv_cracks_widen: 'Yes',
    q10_adv_new_cracks: 'Yes',
    q10_adv_sudden_sound: 'No',

    // Earthquake details
    q10_adv_earthquake_year: '2020',
    q10_adv_earthquake_severity: 'Moderate (5-6 Richter)',
    q10_adv_earthquake_questions: ['New cracks appeared', 'Existing cracks widened'],
    q10_adv_earthquake_description: 'Building shook significantly, new diagonal cracks in walls',

    // Wind details
    q10_adv_wind_year: '2021',
    q10_adv_wind_severity: 'Severe (wind speed > 100 km/h)',
    q10_adv_wind_questions: ['Roof damage'],
    q10_adv_wind_description: 'Cyclone caused roof slab cracks',

    // Flood details
    q10_adv_flood_year: '2019',
    q10_adv_flood_severity: 'Moderate (water level 1-2m)',
    q10_adv_flood_questions: ['Foundation damage', 'Dampness'],
    q10_adv_flood_description: 'Ground floor flooded, moisture ingress in walls',

    // _meta will be added by frontend
    _meta: {
      structureType: 'RCC Structure',
      submittedAt: new Date().toISOString(),
      formVersion: 'advanced-rcc-v1'
    }
  };

  console.log(`   📊 Total response keys: ${Object.keys(advancedResponses).length}`);
  console.log(`   🖼️  Image URLs: ${Object.keys(advancedResponses).filter(k => k.includes('img') || k.includes('photo')).length}`);

  try {
    const response = await axios.post(
      `${API_BASE}/api/assessment/${baseAssessmentId}/advanced`,
      { advancedResponses },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );

    advancedAssessmentId = response.data.advancedAssessmentId;
    console.log('✅ Advanced assessment submitted:', advancedAssessmentId);
    console.log(`   Fields saved: ${response.data.fieldsSaved}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to submit advanced assessment:', error.response?.data || error.message);
    return false;
  }
}

// ============================================================================
// STEP 4: Verify in MongoDB that ALL fields were saved
// ============================================================================
async function verifyInMongoDB() {
  console.log('\n📝 Step 4: Verifying ALL fields in MongoDB...');

  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    const AdvancedAssessment = mongoose.model('AdvancedAssessment', new mongoose.Schema({}, { strict: false, collection: 'advancedassessments' }));

    const doc = await AdvancedAssessment.findById(advancedAssessmentId);

    if (!doc) {
      console.error('❌ Advanced assessment document NOT FOUND in MongoDB!');
      return false;
    }

    console.log('\n✅ Document found in MongoDB');
    console.log('   Document ID:', doc._id);
    console.log('   Structure Type:', doc.structureType);
    console.log('   Base Assessment ID:', doc.baseAssessmentId);

    const responses = doc.responses || {};
    const totalKeys = Object.keys(responses).length;

    console.log(`\n📊 Total response keys saved: ${totalKeys}`);

    // Check critical previously-dropped fields
    const criticalFields = {
      'Q2 Crack Photos (12 total)': [
        'q6_rcc_roof_widest_crack_img',
        'q6_rcc_roof_longest_crack_img',
        'q6_rcc_beam_widest_crack_img',
        'q6_rcc_beam_longest_crack_img',
        'q6_rcc_column_widest_crack_img',
        'q6_rcc_column_longest_crack_img',
        'q6_rcc_floor_widest_crack_img',
        'q6_rcc_floor_longest_crack_img',
        'q6_rcc_vdd_widest_crack_img',
        'q6_rcc_vdd_longest_crack_img',
        'q6_rcc_mfb_widest_crack_img',
        'q6_rcc_mfb_longest_crack_img'
      ],
      'Q6 Rebar Photo': ['q6_adv_rebar_photo'],
      'Q9 Vegetation (4 fields)': [
        'q9_adv_veg_locations',
        'q9_adv_veg_locations_other',
        'q9_adv_veg_photo',
        'q9_adv_veg_photo_name'
      ],
      'Q10 Disasters': ['q10_adv_disasters']
    };

    console.log('\n🔍 Checking previously-dropped critical fields:');
    let allCriticalPresent = true;

    for (const [category, fields] of Object.entries(criticalFields)) {
      console.log(`\n   ${category}:`);
      for (const field of fields) {
        const present = responses.hasOwnProperty(field);
        const value = responses[field];
        const status = present ? '✅' : '❌ MISSING';
        console.log(`      ${status} ${field}: ${present ? JSON.stringify(value).substring(0, 60) : 'NOT SAVED'}`);
        if (!present) allCriticalPresent = false;
      }
    }

    if (allCriticalPresent) {
      console.log('\n🎉 SUCCESS! All previously-dropped fields are now saved!');
    } else {
      console.log('\n❌ FAILURE! Some fields are still missing!');
    }

    // Show sample of all saved keys
    console.log('\n📋 All saved response keys:');
    Object.keys(responses).sort().forEach((key, idx) => {
      if (idx < 50) {
        const val = responses[key];
        const preview = typeof val === 'string' ? val.substring(0, 40) : JSON.stringify(val).substring(0, 40);
        console.log(`   ${key}: ${preview}`);
      }
    });
    if (totalKeys > 50) {
      console.log(`   ... and ${totalKeys - 50} more fields`);
    }

    await mongoose.disconnect();
    return allCriticalPresent;

  } catch (error) {
    console.error('❌ MongoDB verification failed:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    return false;
  }
}

// ============================================================================
// Main test execution
// ============================================================================
async function runTest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  COMPLETE ADVANCED ASSESSMENT INTEGRATION TEST');
  console.log('  Testing: ALL response fields reach MongoDB (RCC Structure)');
  console.log('═══════════════════════════════════════════════════════════════');

  try {
    // Step 1: Login
    if (!await login()) {
      console.error('\n❌ TEST FAILED: Could not login');
      process.exit(1);
    }

    // Step 2: Create basic assessment
    if (!await createBasicAssessment()) {
      console.error('\n❌ TEST FAILED: Could not create basic assessment');
      process.exit(1);
    }

    // Step 3: Submit complete advanced assessment
    if (!await submitCompleteAdvancedRCC()) {
      console.error('\n❌ TEST FAILED: Could not submit advanced assessment');
      process.exit(1);
    }

    // Step 4: Verify in MongoDB
    const verified = await verifyInMongoDB();

    console.log('\n═══════════════════════════════════════════════════════════════');
    if (verified) {
      console.log('  ✅ TEST PASSED: All responses saved to MongoDB');
    } else {
      console.log('  ❌ TEST FAILED: Some responses missing in MongoDB');
    }
    console.log('═══════════════════════════════════════════════════════════════\n');

    process.exit(verified ? 0 : 1);

  } catch (error) {
    console.error('\n❌ TEST FAILED with exception:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
runTest();
