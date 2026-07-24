const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { GridFSBucket } = require('mongodb');
const helmet = require('helmet');
require('dotenv').config();

const app = express();

// Security Middleware
const { sanitizeInput } = require('./middleware/securityMiddleware');
const { apiLimiter, authLimiter, paymentLimiter, reportLimiter } = require('./middleware/rateLimiter');

// Apply Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP as it may conflict with inline scripts
  crossOriginEmbedderPolicy: false
}));

// Trust proxy - CRITICAL for Render/Railway/Heroku to get real client IP
// Use 1 instead of true to prevent IP spoofing (express-rate-limit requirement)
app.set('trust proxy', 1);

app.use(express.json({ limit: '50mb' })); // Increased limit for PDF data
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ensure malformed JSON payloads return clean API responses (not HTML error pages).
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON payload'
    });
  }
  next(err);
});

// Apply input sanitization middleware to prevent NoSQL injection
app.use(sanitizeInput);

// CORS configuration for production
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Apply general rate limiting to all API routes
app.use('/api/', apiLimiter);

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/osham_assessments';
let gridFSBucket;

// MongoDB connection options for better stability
const mongooseOptions = {
  serverSelectionTimeoutMS: 30000, // Increase timeout to 30 seconds
  socketTimeoutMS: 45000,
  family: 4 // Force IPv4
};

mongoose.connect(MONGODB_URI, mongooseOptions)
.then(() => {
  console.log('✅ MongoDB connected successfully');
  console.log('📍 Database:', mongoose.connection.name);
  // Initialize GridFS bucket for file storage
  gridFSBucket = new GridFSBucket(mongoose.connection.db, {
    bucketName: 'adminReports'
  });
  console.log('✅ GridFS bucket initialized');
})
.catch((err) => {
  console.error('❌ MongoDB connection error:', err.message);
  console.log('⚠️ Server will continue without database functionality');
  console.log('💡 Tip: Check your MONGODB_URI in .env file');
  console.log('💡 Tip: Ensure MongoDB Atlas allows your IP address');
});

// Import models and services
const Assessment = require('./models/Assessment');
const AdvancedAssessment = require('./models/AdvancedAssessment');
const FinalAssessment = require('./models/FinalAssessment');
const Payment = require('./models/Payment');
const { notifyRajOnSubmission } = require('./services/emailService');
const cloudinaryService = require('./services/cloudinaryService');

/**
 * Notify raj-it@spplindia.org when an assessment is submitted.
 * Fire-and-forget — does not block the response.
 */
function notifyAdminOnAssessmentSubmission(userDetails, assessmentType, reportText, pdfBuffer, assessmentId) {
  notifyRajOnSubmission(userDetails, assessmentType, assessmentId)
    .catch(err => console.error('⚠️ notifyRajOnSubmission error:', err.message));
}

// Import auth routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payment');

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to authenticate user token
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No token provided',
      requiresLogin: true
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      requiresLogin: true
    });
  }
};

// Helper function to get IST timestamp
function getISTTimestamp() {
  const date = new Date();
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(date.getTime() + istOffset);
}

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

// Helper: generate PDF Buffer from report text and user details (server-side)
async function generatePdfBufferFromReport(reportText, user_details) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4', 
        margins: { top: 50, bottom: 70, left: 60, right: 60 },
        bufferPages: true
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const result = Buffer.concat(chunks);
        console.log('🔵 [PDF] Buffer created, size:', result.length, 'bytes');
        resolve(result);
      });
      doc.on('error', (err) => {
        console.error('❌ [PDF] PDFDocument error:', err);
        reject(err);
      });

      const pageWidth = doc.page.width;
      const leftMargin = 60;
      const rightMargin = pageWidth - 60;

      // Add title and metadata
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#003366');
      doc.text('PRELIMINARY ASSESSMENT REPORT', leftMargin, 60, { width: rightMargin - leftMargin, align: 'center' });
      doc.moveDown(1.5);

      doc.font('Helvetica').fontSize(11).fillColor('#444444');
      if (user_details && user_details.name) {
        doc.text(`Name: ${user_details.name}`, { width: rightMargin - leftMargin });
        doc.moveDown(0.5);
      }
      if (user_details && user_details.email) {
        doc.text(`Email: ${user_details.email}`, { width: rightMargin - leftMargin });
        doc.moveDown(0.5);
      }
      doc.moveDown(1);

      // Clean and process report text with better markdown handling
      const cleaned = String(reportText || '')
        .replace(/\r/g, '');

      console.log('🔵 [PDF] Report text length:', cleaned.length, 'characters');
      
      if (!cleaned || cleaned.trim().length === 0) {
        console.warn('⚠️ [PDF] Report text is empty! Adding placeholder content.');
        doc.font('Helvetica').fontSize(10).fillColor('#FF0000');
        doc.text('No report content available. Please regenerate the assessment.', { 
          width: rightMargin - leftMargin, 
          align: 'left' 
        });
      } else {
        // Split by double newlines to preserve paragraphs
        const sections = cleaned.split(/\n\n+/);
        console.log('🔵 [PDF] Processing', sections.length, 'sections');
        
        for (const section of sections) {
          const text = section.trim();
          if (!text) continue;
          
          // Check if we need a new page (leave 120px margin at bottom)
          if (doc.y > doc.page.height - 120) {
            doc.addPage();
          }
          
          // Handle main section headers (like "1. OVERVIEW", "2. KEY OBSERVATIONS")
          if (text.match(/^\d+\.\s+[A-Z\s]+$/)) {
            doc.font('Helvetica-Bold').fontSize(14).fillColor('#003366');
            doc.text(text, { width: rightMargin - leftMargin, align: 'left' });
            doc.moveDown(0.8);
            continue;
          }
          
          // Handle subheadings with ** or ending with : (like "**Structural Cracks:**" or "Structural Cracks:")
          if (text.match(/^\*\*[^*]+\*\*:?$/) || text.match(/^[A-Z][^:]+:$/)) {
            doc.font('Helvetica-Bold').fontSize(12).fillColor('#003366');
            const headerText = text.replace(/\*\*/g, '').replace(/^#+\s*/, '');
            doc.text(headerText, { width: rightMargin - leftMargin, align: 'left' });
            doc.moveDown(0.5);
            continue;
          }
          
          // Handle bullet points - always regular black text
          if (text.match(/^[\-\*\•]/)) {
            doc.font('Helvetica').fontSize(10).fillColor('#222222');
            const bulletText = text.replace(/^[\-\*\•]\s*/, '• ').replace(/\*\*(.+?)\*\*/g, '$1');
            doc.text(bulletText, { 
              width: rightMargin - leftMargin - 20, 
              align: 'left',
              indent: 20,
              lineGap: 4
            });
            doc.moveDown(0.3);
            continue;
          }
          
          // Regular paragraphs - always black text
          doc.font('Helvetica').fontSize(10).fillColor('#222222');
          const cleanText = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
          doc.text(cleanText, { 
            width: rightMargin - leftMargin, 
            align: 'justify', 
            lineGap: 5
          });
          doc.moveDown(0.6);
        }
      }

      doc.end();
    } catch (err) {
      console.error('❌ [PDF] generatePdfBufferFromReport error:', err);
      reject(err);
    }
  });
}

// Generate mock report for testing (fallback)
function generateMockReport(user_details, assessment_responses) {
  // Unwrap the raw responses if they are wrapped
  const actualResponses = assessment_responses.raw_responses || assessment_responses;
  
  const pick = (obj, ...keys) => {
    for (const k of keys) {
      if (typeof obj[k] !== 'undefined' && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return undefined;
  };

  const severity = (pick(actualResponses, 'q9_rcc_corrosion_has', 'q10_steel_corrosion_has', 'q10_lb_corrosion_has', 'q11a_composite_corrosion_has') === 'Yes' || 
                   pick(actualResponses, 'q8a_damp_has', 'q8a_steel_damp_has', 'q9a_lb_damp_has', 'q10a_composite_damp_has') === 'Yes' ||
                   pick(actualResponses, 'q6_rcc_has_cracks', 'q7_steel_has_cracks', 'q6_lb_has_cracks', 'q6_heritage_has_cracks', 'q7_composite_cracks_has') === 'Yes' ||
                   pick(actualResponses, 'q11_ground_issues_has', 'q13_steel_ground_issues_has', 'q12_lb_ground_issues_has', 'q11_heritage_ground_issues_has', 'q13_composite_ground_issues_has') === 'Yes' ||
                   pick(actualResponses, 'q12_disaster_has', 'q14_steel_disaster_has', 'q13_lb_disaster_has', 'q12_heritage_disaster_has', 'q14_composite_disaster_has') === 'Yes') ? 'Fair' : 'Good';
  
  const buildingAge = pick(actualResponses, 'q1_age', 'q1_steel_age', 'q1_lb_age', 'q1_heritage_age') || 'Unknown';
  const location = pick(actualResponses, 'q1_city', 'q1_city_other', 'q1_steel_city', 'q1_steel_city_other', 'q1_lb_city', 'q1_lb_city_other', 'q1_heritage_city', 'q1_heritage_city_other') || 'Not specified';
  const structuralSystem = pick(actualResponses, 'q5_structural_system', 'q5_steel_structural_system', 'q5_lb_structural_system', 'q5_heritage_structural_system', 'q5_composite_structural_system', 'q2_structural_system') || 'Not specified';
  const rawUsage = pick(actualResponses, 'q2_usage', 'q2_usage_other', 'q2_steel_usage', 'q2_steel_usage_other', 'q2_lb_usage', 'q2_lb_usage_other', 'q2_heritage_usage', 'q2_heritage_usage_other') || 'Residential';
  const usageString = (Array.isArray(rawUsage) ? rawUsage.join(', ') : String(rawUsage)).replace(/\s*building\s*/gi, '').trim();
  
  // Extract specific crack details
  const crackElem = pick(actualResponses, 'q6_rcc_crack_elements', 'q7_steel_crack_elements', 'q6_lb_crack_elements', 'q6_heritage_crack_elements', 'q7_composite_cracks_elements') || 'Roof';
  const crackElemText = Array.isArray(crackElem) ? crackElem.join(', ') : String(crackElem);
  
  const mockLocations = [];
  const mockOrientations = [];
  Object.keys(actualResponses).forEach(k => {
    if (k.endsWith('_locations') || k.endsWith('_location')) {
      if (actualResponses[k] && actualResponses[k] !== '') mockLocations.push(Array.isArray(actualResponses[k]) ? actualResponses[k].join(', ') : String(actualResponses[k]));
    }
    if (k.endsWith('_orientations') || k.endsWith('_orientation')) {
      if (actualResponses[k] && actualResponses[k] !== '') mockOrientations.push(Array.isArray(actualResponses[k]) ? actualResponses[k].join(', ') : String(actualResponses[k]));
    }
  });

  const crackLoc = mockLocations.length > 0 ? Array.from(new Set(mockLocations)).join('; ') : 'At the middle section of the roof';
  const crackOrient = mockOrientations.length > 0 ? Array.from(new Set(mockOrientations)).join('; ') : 'Vertical';
  
  // Extract ground & soil details
  const soilType = pick(actualResponses, 'q11_soil_types', 'q13_steel_soil_types', 'q12_lb_soil_types', 'q11_heritage_soil_types', 'q13_composite_soil_types') || 'Hard soil';
  const soilTypeText = Array.isArray(soilType) ? soilType.join(', ') : String(soilType);
  const groundIssueHas = pick(actualResponses, 'q11_ground_issues_has', 'q13_steel_ground_issues_has', 'q12_lb_ground_issues_has', 'q11_heritage_ground_issues_has', 'q13_composite_ground_issues_has') === 'Yes';
  const groundIssueDetails = pick(actualResponses, 'q11_ground_issues', 'q13_steel_ground_issues', 'q12_lb_ground_issues', 'q11_heritage_ground_issues', 'q13_composite_ground_issues') || 'Soil erosion or washout near plinth/foundation';
  const groundIssueText = Array.isArray(groundIssueDetails) ? groundIssueDetails.join(', ') : String(groundIssueDetails);

  // Extract disaster details
  const disasterHas = pick(actualResponses, 'q12_disaster_has', 'q14_steel_disaster_has', 'q13_lb_disaster_has', 'q12_heritage_disaster_has', 'q14_composite_disaster_has') === 'Yes';
  const disasterDetails = pick(actualResponses, 'q12_disaster_types', 'q14_steel_disaster_types', 'q13_lb_disaster_types', 'q12_heritage_disaster_types', 'q14_composite_disaster_types') || 'Fire';
  const disasterText = Array.isArray(disasterDetails) ? disasterDetails.join(', ') : String(disasterDetails);

  return `PRELIMINARY BUILDING ASSESSMENT REPORT
Generated: ${new Date().toLocaleDateString('en-IN')}
Assessed by: Licensed Structural Engineer

1. OVERVIEW
Overall Health Rating: ${severity}
This ${buildingAge}-year-old ${usageString} building with ${structuralSystem} structural system located in ${location} has been assessed through a preliminary visual inspection and questionnaire-based assessment. The building shows signs of age-related deterioration typical for structures in this environment. Overall structural health is rated as ${severity}, with several critical observations requiring attention. Immediate professional detailed investigation is recommended as per IS 13935:2009 guidelines.

2. KEY OBSERVATIONS
The following specific conditions have been identified during the preliminary assessment:

• Structural Cracks & Distress: ${crackElemText} shows ${crackOrient} orientation cracks observed specifically at ${crackLoc}. This structural cracking requires immediate engineering evaluation for load distribution and capacity impairment.

• Geotechnical & Foundation Conditions: Site soil classification is identified as ${soilTypeText}.${groundIssueHas ? ` Critical foundation/ground issue observed: ${groundIssueText}. Soil erosion near the foundation poses severe settlement and structural instability risks.` : ''}

• Disaster & Hazard History:${disasterHas ? ` The structure has a documented history of hazardous event exposure (${disasterText}). Past exposure to ${disasterText} requires micro-structural evaluation for thermal or shock-induced micro-fractures.` : ' No major natural disaster history reported.'}

• Material Deterioration: Concrete surfaces show age-related degradation. Core strength and carbonation testing recommended.

• Environmental Exposure: Building exposed to ${actualResponses.q3_exposure_type || 'normal'} environmental conditions, which affects deterioration rate and maintenance requirements.

3. RISK SUMMARY

CRITICAL/HIGH RISK (Immediate Attention - 0-1 month):
${groundIssueHas ? `• Ground/Foundation Issue: ${groundIssueText} requires urgent geotechnical intervention\n` : ''}${disasterHas ? `• Structural impact from past ${disasterText} event requires micro-structural verification\n` : ''}${actualResponses.q6_rcc_has_cracks === 'Yes' ? `• ${crackOrient} cracks on ${crackElemText} at ${crackLoc} require structural audit\n` : ''}• Detailed Structural Audit as per IS 13935:2009 must be commissioned immediately

MEDIUM RISK (Prompt Attention - 1-6 months):
• Non-Destructive Testing (NDT) to assess concrete strength and reinforcement condition
• Repair of identified ${crackOrient} cracks on ${crackElemText} with proper structural epoxy resin
${groundIssueHas ? '• Plinth and foundation protection works to arrest soil erosion\n' : ''}

LOW RISK (Monitoring/Maintenance - 6-24 months):
• Establish periodic inspection schedule (6-monthly intervals)
• Preventive maintenance program for building protection
• Regular cleaning and minor maintenance works
• Documentation of building condition over time

4. TECHNICAL ASSESSMENT

Structural Integrity: The ${buildingAge}-year-old ${usageString} building with ${structuralSystem} shows age-appropriate deterioration. Based on observed indicators including ${crackOrient} cracks on ${crackElemText} at ${crackLoc}, the structure requires comprehensive engineering evaluation. Load-bearing capacity assessment through NDT methods (Rebound Hammer, Ultrasonic Pulse Velocity, Core Testing) is essential as per IS 456:2000 to determine residual safety factors.

Geotechnical Stability: The foundation rests on ${soilTypeText}.${groundIssueHas ? ` Observed ${groundIssueText} compromises lateral soil support around plinth level and can cause differential settlement.` : ''} Borehole testing and SPT are recommended per IS 6403.

Hazard & Disaster Impact: ${disasterHas ? `The documented exposure to ${disasterText} can induce residual thermal stresses, concrete micro-cracking, and reduction in steel yield strength.` : 'No historical disaster damage noted.'}

5. RECOMMENDATIONS

IMMEDIATE ACTIONS (0-3 months):
• Commission Detailed Structural Audit as per IS 13935:2009 by Licensed Structural Engineer
• Conduct targeted Non-Destructive Testing (NDT) on ${crackElemText}:
  - Rebound Hammer & UPV test at ${crackLoc}
  - Half-Cell Potential Test for reinforcement corrosion mapping
  - Cover meter survey for reinforcement location and cover adequacy
  ${disasterHas ? '- Concrete core extraction for residual compressive strength and petrographic analysis after ' + disasterText : ''}
${groundIssueHas ? '• Execute immediate geotechnical propping and plinth repair for soil erosion area' : ''}

SHORT-TERM ACTIONS (3-12 months):
• Execute structural repairs based on detailed audit findings:
  - Epoxy injection for ${crackOrient} cracks on ${crackElemText} at ${crackLoc}
  - Grouting and soil stabilization for ${groundIssueText}
  - Protective anti-carbonation coatings

LONG-TERM ACTIONS (1-5 years):
• Establish Preventive Maintenance Schedule
• Review and update structural assessment every 3-5 years

6. CONCLUSION

Based on this preliminary assessment, the building is rated as being in ${severity} structural condition due to observed ${crackOrient} cracks on ${crackElemText} at ${crackLoc}${groundIssueHas ? `, soil erosion near foundation` : ''}${disasterHas ? `, and historical ${disasterText} exposure` : ''}.

Most Critical Requirement: Immediate commissioning of Detailed Structural Assessment as per IS 13935:2009 by a Licensed Structural Engineer.

Disclaimer: This preliminary assessment is based on questionnaire responses and visible observations. Final decisions on repairs must be based on a detailed engineering investigation per IS 13935:2009 standards.`;
}

// Endpoint to generate building health report
app.post('/api/generate-building-report', reportLimiter, async (req, res) => {
  try {
    console.log('Incoming /api/generate-building-report body keys:', Object.keys(req.body || {}));
    const user_details = req.body.user_details || req.body.userDetails || {};
    const assessment_responses = req.body.assessment_responses || req.body.assessmentResponses;

    if (!assessment_responses) {
      return res.status(400).json({ error: 'Missing assessment responses' });
    }

    // Unwrap the raw responses if they are wrapped
    const actualResponses = assessment_responses.raw_responses || assessment_responses;

    let report;
    let usedMock = false;
    let groqDebug = null;

    // Use GROQ API if key is available, otherwise use mock
    if (GROQ_API_KEY) {
      console.log('Using GROQ API for report generation...');
      console.log('📊 Unwrapped Data Sample:');
      console.log('  - Age:', actualResponses.q1_age);
      console.log('  - City:', actualResponses.q1_city);
      console.log('  - Cracks:', actualResponses.q6_rcc_has_cracks);
      console.log('  - Crack Elements:', actualResponses.q6_rcc_crack_elements);
      console.log('  - Vibration:', actualResponses.q13_rcc_vibration);
      console.log('  - Vibration Sources:', actualResponses.q13_rcc_vibration_sources);
      
      // Build concise data summary for the AI
      // Normalize keys: prefer Load-Bearing (`_lb_`) when present, otherwise use RCC keys
      const pick = (obj, ...keys) => {
        for (const k of keys) {
          if (typeof obj[k] !== 'undefined' && obj[k] !== null && obj[k] !== '') return obj[k];
        }
        return undefined;
      };

      // Collect crack elements, specific locations, and specific orientations across all systems
      const collectAllCrackDetails = (res) => {
        const elementsArr = pick(res, 'q6_rcc_crack_elements', 'q7_steel_crack_elements', 'q6_lb_crack_elements', 'q6_heritage_crack_elements', 'q7_composite_cracks_elements') || [];
        const elementsText = Array.isArray(elementsArr) ? elementsArr.join(', ') : String(elementsArr);

        const locations = [];
        const orientations = [];

        [
          'q6_rcc_roof_locations', 'q6_rcc_beam_locations', 'q6_rcc_column_locations', 'q6_rcc_slab_locations', 'q6_rcc_wall_locations', 'q6_rcc_crack_location',
          'q7_steel_beam_locations', 'q7_steel_column_locations', 'q7_steel_truss_locations', 'q7_steel_joint_locations',
          'q6_lb_wall_locations', 'q6_lb_lintel_locations', 'q6_lb_junction_locations',
          'q6_heritage_primary_masonry_locations', 'q6_heritage_arch_locations'
        ].forEach(k => {
          if (res[k] && res[k] !== '') {
            locations.push(Array.isArray(res[k]) ? res[k].join(', ') : String(res[k]));
          }
        });

        [
          'q6_rcc_roof_orientations', 'q6_rcc_beam_orientations', 'q6_rcc_column_orientations', 'q6_rcc_slab_orientations', 'q6_rcc_wall_orientations', 'q6_rcc_crack_orientation',
          'q7_steel_beam_orientations', 'q7_steel_column_orientations', 'q7_steel_truss_orientations', 'q7_steel_joint_orientations',
          'q6_lb_wall_orientations', 'q6_lb_lintel_orientations', 'q6_lb_junction_orientations',
          'q6_heritage_primary_masonry_orientations', 'q6_heritage_arch_orientations'
        ].forEach(k => {
          if (res[k] && res[k] !== '') {
            orientations.push(Array.isArray(res[k]) ? res[k].join(', ') : String(res[k]));
          }
        });

        return {
          elements: elementsText || 'Not specified',
          locations: locations.length > 0 ? Array.from(new Set(locations)).join('; ') : 'Not specified',
          orientations: orientations.length > 0 ? Array.from(new Set(orientations)).join('; ') : 'Not specified'
        };
      };

      const crackInfo = collectAllCrackDetails(actualResponses);

      const q = {
        age: pick(actualResponses, 'q1_age', 'q1_steel_age', 'q1_lb_age', 'q1_heritage_age'),
        city: pick(actualResponses, 'q1_city', 'q1_city_other', 'q1_steel_city', 'q1_steel_city_other', 'q1_lb_city', 'q1_lb_city_other', 'q1_heritage_city', 'q1_heritage_city_other'),
        country: pick(actualResponses, 'q1_country', 'q1_steel_country', 'q1_lb_country', 'q1_heritage_country'),
        usage: pick(actualResponses, 'q2_usage', 'q2_usage_other', 'q2_steel_usage', 'q2_steel_usage_other', 'q2_lb_usage', 'q2_lb_usage_other', 'q2_heritage_usage', 'q2_heritage_usage_other'),
        system: pick(actualResponses, 'q5_structural_system', 'q5_steel_structural_system', 'q5_lb_structural_system', 'q5_heritage_structural_system'),
        storeysAbove: pick(actualResponses, 'q1_storeys_above', 'q1_steel_storeys_above', 'q1_lb_storeys_above', 'q1_heritage_storeys_above'),
        storeysBelow: pick(actualResponses, 'q1_storeys_below', 'q1_steel_storeys_below', 'q1_lb_storeys_below', 'q1_heritage_storeys_below'),
        exposure: pick(actualResponses, 'q3_exposure_type', 'q3_steel_exposure_type', 'q3_lb_exposure_type', 'q3_heritage_exposure_type'),

        // Cracks
        q6_has_cracks: pick(actualResponses, 'q6_rcc_has_cracks', 'q7_steel_has_cracks', 'q6_lb_has_cracks', 'q6_heritage_has_cracks', 'q7_composite_cracks_has'),
        q6_crack_elements: crackInfo.elements,
        q6_crack_orientation: crackInfo.orientations,
        q6_crack_location: crackInfo.locations,
        q6_deformation: pick(actualResponses, 'q6_rcc_deformation', 'q8_steel_deformation_has', 'q6_lb_deformation', 'q7_heritage_deformation_has', 'q8_composite_deformation_has'),
        q6_deformation_elements: pick(actualResponses, 'q6_rcc_deformation_elements', 'q8_steel_deformation_types', 'q6_lb_deformation_elements', 'q7_heritage_deformation_elements'),

        // Spalling / Deterioration
        q7_spalling_has: pick(actualResponses, 'q7_rcc_spalling_has', 'q7_steel_spalling_has', 'q7_lb_spalling_has', 'q8_heritage_deterioration_has', 'q9_composite_spalling_has'),
        q7_spalling: pick(actualResponses, 'q7_rcc_spalling', 'q7_steel_spalling', 'q7_lb_spalling', 'q8_heritage_deterioration_types', 'q9_composite_spalling_elements'),

        // Moisture / patches
        q8a_damp_has: pick(actualResponses, 'q8a_damp_has', 'q8a_steel_damp_has', 'q9a_lb_damp_has', 'q9a_damp_has', 'q10a_composite_damp_has'),
        q8a_damp_elements: pick(actualResponses, 'q8a_damp_elements', 'q8a_steel_damp_elements', 'q9a_lb_damp_elements', 'q9a_damp_elements', 'q10a_composite_damp_elements'),
        q8b_white_has: pick(actualResponses, 'q8b_white_has', 'q8b_steel_white_has', 'q9b_lb_white_has', 'q9b_white_elements', 'q10b_composite_white_has'),
        q8b_white_elements: pick(actualResponses, 'q8b_white_elements', 'q8b_steel_white_elements', 'q9b_lb_white_elements', 'q9b_white_elements', 'q10b_composite_white_elements'),
        q8c_green_has: pick(actualResponses, 'q8c_green_has', 'q8c_steel_green_has', 'q9c_lb_green_has', 'q9c_green_has', 'q10c_composite_green_has'),
        q8c_green_elements: pick(actualResponses, 'q8c_green_elements', 'q8c_steel_green_elements', 'q9c_lb_green_elements', 'q9c_green_elements', 'q10c_composite_green_elements'),
        q8d_brown_has: pick(actualResponses, 'q9d_lb_brown_has', 'q9d_brown_has'),

        // Corrosion
        q9_corrosion_has: pick(actualResponses, 'q9_rcc_corrosion_has', 'q10_steel_corrosion_has', 'q10_lb_corrosion_has', 'q11a_composite_corrosion_has'),
        q9_corrosion_elements: pick(actualResponses, 'q9_rcc_corrosion_elements', 'q10_steel_corrosion_changes', 'q10_lb_corrosion_elements', 'q11a_composite_corrosion_elements'),

        // Vibration
        q13_vibration: pick(actualResponses, 'q13_rcc_vibration', 'q12_steel_vibration', 'q11_lb_vibration_has', 'q10_heritage_vibration', 'q12a_composite_vibration_has'),
        q13_vibration_sources: pick(actualResponses, 'q13_rcc_vibration_sources', 'q12_steel_vibration_sources', 'q11_lb_vibration_sources', 'q10_heritage_vibration_sources', 'q12a_composite_vibration_sources'),

        // Floors/ground/disaster
        q4_floors_added: pick(actualResponses, 'q4_floors_added', 'q4_steel_floors_added', 'q4_lb_floors_added', 'q4_heritage_alterations_has'),
        q4_floors_details: pick(actualResponses, 'q4_floors_details', 'q4_steel_floors_details', 'q4_lb_floors_details', 'q4_heritage_alterations_types'),
        q11_ground_issues_has: pick(actualResponses, 'q11_ground_issues_has', 'q13_steel_ground_issues_has', 'q12_lb_ground_issues_has', 'q11_ground_issues_has', 'q13_composite_ground_issues_has'),
        q11_ground_issues: pick(actualResponses, 'q11_ground_issues', 'q13_steel_ground_issues', 'q12_lb_ground_issues', 'q11_ground_issues', 'q13_composite_ground_issues'),
        q11_soil_types: pick(actualResponses, 'q11_soil_types', 'q13_steel_soil_types', 'q12_lb_soil_types', 'q11_soil_types', 'q13_composite_soil_types'),
        q12_disaster_has: pick(actualResponses, 'q12_disaster_has', 'q14_steel_disaster_has', 'q13_lb_disaster_has', 'q12_disaster_has', 'q14_composite_disaster_has'),
        q12_disaster_types: pick(actualResponses, 'q12_disaster_types', 'q14_steel_disaster_types', 'q13_lb_disaster_types', 'q12_disaster_types', 'q14_composite_disaster_types'),
        q13_expert_intervention_has: pick(actualResponses, 'q13_expert_intervention_has', 'q15_steel_expert_intervention_has', 'q14_lb_expert_intervention_has', 'q13_expert_intervention_has', 'q15_composite_expert_intervention_has'),
        q13_expert_intervention_types: pick(actualResponses, 'q13_expert_intervention_types', 'q15_steel_expert_intervention_types', 'q14_lb_expert_intervention_types', 'q13_expert_intervention_types', 'q15_composite_expert_intervention_types')
      };

      const buildingSummary = `Age: ${q.age || 'N/A'}y | Location: ${q.city || 'N/A'}, ${q.country || 'N/A'} | Type: ${Array.isArray(q.usage) ? q.usage.join(', ') : q.usage || 'N/A'} | System: ${q.system || 'N/A'} | Storeys: ${q.storeysAbove || ''}+${q.storeysBelow || ''} | Exposure: ${q.exposure || 'N/A'}`;
      
      const issuesList = [];
      if (q.q6_has_cracks === 'Yes') {
        issuesList.push(`CRACKS in ${(Array.isArray(q.q6_crack_elements) ? q.q6_crack_elements.join(', ') : q.q6_crack_elements || '')} - ${(Array.isArray(q.q6_crack_orientation) ? q.q6_crack_orientation.join(', ') : q.q6_crack_orientation || '')} at ${(Array.isArray(q.q6_crack_location) ? q.q6_crack_location.join(', ') : q.q6_crack_location || '')}`);
      }
      if (q.q7_spalling_has === 'Yes') {
        issuesList.push(`SPALLING in ${(Array.isArray(q.q7_spalling) ? q.q7_spalling.join(', ') : q.q7_spalling || '')}`);
      }
      if (q.q8a_damp_has === 'Yes') {
        issuesList.push(`DAMP in ${(Array.isArray(q.q8a_damp_elements) ? q.q8a_damp_elements.join(', ') : q.q8a_damp_elements || '')}`);
      }
      if (q.q8b_white_has === 'Yes') {
        issuesList.push(`EFFLORESCENCE in ${(Array.isArray(q.q8b_white_elements) ? q.q8b_white_elements.join(', ') : q.q8b_white_elements || '')}`);
      }
      if (q.q9_corrosion_has === 'Yes') {
        issuesList.push(`CORROSION in ${(Array.isArray(q.q9_corrosion_elements) ? q.q9_corrosion_elements.join(', ') : q.q9_corrosion_elements || '')}`);
      }
      if (q.q13_vibration === 'Yes') {
        issuesList.push(`VIBRATION from ${(Array.isArray(q.q13_vibration_sources) ? q.q13_vibration_sources.join(', ') : q.q13_vibration_sources || '')}`);
      }
      if (q.q4_floors_added === 'Yes') {
        issuesList.push(`ADDED FLOORS: ${q.q4_floors_details || 'floors added after construction'}`);
      }
      if (q.q11_ground_issues_has === 'Yes') {
        issuesList.push(`GROUND ISSUES: ${(Array.isArray(q.q11_ground_issues) ? q.q11_ground_issues.join(', ') : q.q11_ground_issues || '')}`);
      }
      if (q.q12_disaster_has === 'Yes') {
        issuesList.push(`DISASTER HISTORY: ${(Array.isArray(q.q12_disaster_types) ? q.q12_disaster_types.join(', ') : q.q12_disaster_types || '')}`);
      }
      
      const issuesText = issuesList.length > 0 ? issuesList.join(' | ') : 'No major issues reported';
      
      // BUILD COMPREHENSIVE DETAILED DATA STRING - SEND ONLY RELEVANT RESPONSES BASED ON USER'S STRUCTURAL SYSTEM SELECTION
      const formatValue = (val) => {
        if (val === null || val === undefined || val === '') return 'Not specified';
        if (Array.isArray(val)) return val.length > 0 ? val.join(', ') : 'Not specified';
        return String(val);
      };

      const assessmentType = req.body.assessmentType || req.body.assessment_type || actualResponses.assessmentType || 'Building';
      const isDemoMode = assessmentType === 'Demo';

      // Determine which structural system was selected by the user
      const structuralSystem = pick(actualResponses, 'q5_structural_system', 'q5_steel_structural_system', 'q5_lb_structural_system', 'q5_heritage_structural_system', 'q5_composite_structural_system', 'q2_structural_system') || 'RCC Structure';
      const isLoadBearing = structuralSystem.toLowerCase().includes('load bearing');
      const isRCC = structuralSystem.toLowerCase().includes('rcc') || structuralSystem.toLowerCase().includes('frame');
      const isSteel = structuralSystem.toLowerCase().includes('steel');
      const isComposite = structuralSystem.toLowerCase().includes('composite');
      const isHeritage = structuralSystem.toLowerCase().includes('heritage');

      console.log('🔍 Assessment Type:', assessmentType, '| Is Demo:', isDemoMode);
      console.log('🔍 Structural System Selected:', structuralSystem);

      // Filter response keys based on structural system selection
      const allKeys = Object.keys(actualResponses).sort();
      const relevantKeys = allKeys.filter(key => {
        if (isDemoMode) return true;
        // Always include generic fields (q1, q2, q3, q4, q5, etc.)
        if (!key.includes('_rcc_') && !key.includes('_lb_') && !key.includes('_steel_') && !key.includes('_composite_') && !key.includes('_heritage_')) return true;
        
        if (isLoadBearing && key.includes('_lb_')) return true;
        if (isSteel && key.includes('_steel_')) return true;
        if (isComposite && key.includes('_composite_')) return true;
        if (isHeritage && key.includes('_heritage_')) return true;
        if (isRCC && (key.includes('_rcc_') || (!key.includes('_lb_') && !key.includes('_steel_') && !key.includes('_composite_') && !key.includes('_heritage_') && (key.startsWith('q6_') || key.startsWith('q7_') || key.startsWith('q8') || key.startsWith('q9_') || key.startsWith('q1'))))) return true;
        
        return false;
      });

      const relevantResponsesFormatted = relevantKeys.map(key => {
        const value = actualResponses[key];
        if (value === null || value === undefined || value === '') return null;
        return `${key}: ${formatValue(value)}`;
      }).filter(Boolean).join('\n');

      console.log('📊 Total response keys:', allKeys.length);
      console.log('📊 Relevant response keys sent to AI:', relevantKeys.length);

      const comprehensiveBuildingData = `
=== USER SELECTED RESPONSES (RELEVANT TO ${structuralSystem.toUpperCase()}) ===
${relevantResponsesFormatted}

=== BUILDING BASELINE DATA ===
Age: ${formatValue(actualResponses.q1_age)} years (Range: ${formatValue(actualResponses.q1_ageRange)})
Location: ${formatValue(actualResponses.q1_city)}${actualResponses.q1_city_other ? ` (Custom: ${actualResponses.q1_city_other})` : ''}, ${formatValue(actualResponses.q1_country)}${actualResponses.q1_country_other ? ` (Custom: ${actualResponses.q1_country_other})` : ''}
Building Height: ${formatValue(actualResponses.q1_storeys_above)} storeys above ground, ${formatValue(actualResponses.q1_storeys_below)} storeys below ground
Building Type/Usage: ${formatValue(actualResponses.q2_usage)}${actualResponses.q2_usage_other ? ` (Custom: ${actualResponses.q2_usage_other})` : ''}
Structural System: ${formatValue(actualResponses.q5_structural_system)}
Environmental Exposure: ${formatValue(actualResponses.q3_exposure_type)}${actualResponses.q3_exposure_other ? ` (Custom: ${actualResponses.q3_exposure_other})` : ''}

=== STRUCTURAL MODIFICATIONS ===
Additional Floors Added: ${formatValue(actualResponses.q4_floors_added)}${actualResponses.q4_floors_added === 'Yes' ? ` - Details: ${formatValue(actualResponses.q4_floors_details)}` : ''}
Floors Added After Construction: ${formatValue(actualResponses.q4_floors_added_after)}
Heavy Machinery Installed: ${formatValue(actualResponses.q4_heavy_machinery)}

=== DETAILED STRUCTURAL OBSERVATIONS (Q6-Q13) - ${isLoadBearing ? 'LOAD BEARING MASONRY' : isRCC ? 'RCC FRAME' : 'GENERAL'} ===

${isLoadBearing ? `
Q6 - STRUCTURAL DISTRESS (CRACKS & DEFORMATION - LOAD BEARING MASONRY):
Has Cracks: ${formatValue(actualResponses.q6_lb_has_cracks)}
${actualResponses.q6_lb_has_cracks === 'Yes' ? `Crack Elements: ${formatValue(actualResponses.q6_lb_crack_elements)}${actualResponses.q6_lb_crack_elements_other ? ` | Custom: ${actualResponses.q6_lb_crack_elements_other}` : ''}
Wall Crack Locations: ${formatValue(actualResponses.q6_lb_wall_locations)}${actualResponses.q6_lb_wall_locations_other ? ` | Custom: ${actualResponses.q6_lb_wall_locations_other}` : ''}
Wall Crack Orientations: ${formatValue(actualResponses.q6_lb_wall_orientations)}${actualResponses.q6_lb_wall_orientations_other ? ` | Custom: ${actualResponses.q6_lb_wall_orientations_other}` : ''}
Lintel Crack Locations: ${formatValue(actualResponses.q6_lb_lintel_locations)}${actualResponses.q6_lb_lintel_locations_other ? ` | Custom: ${actualResponses.q6_lb_lintel_locations_other}` : ''}
Lintel Crack Orientations: ${formatValue(actualResponses.q6_lb_lintel_orientations)}${actualResponses.q6_lb_lintel_orientations_other ? ` | Custom: ${actualResponses.q6_lb_lintel_orientations_other}` : ''}
Junction Crack Locations: ${formatValue(actualResponses.q6_lb_junction_locations)}${actualResponses.q6_lb_junction_locations_other ? ` | Custom: ${actualResponses.q6_lb_junction_locations_other}` : ''}
Junction Crack Orientations: ${formatValue(actualResponses.q6_lb_junction_orientations)}${actualResponses.q6_lb_junction_orientations_other ? ` | Custom: ${actualResponses.q6_lb_junction_orientations_other}` : ''}` : ''}
Has Deformation/Instability: ${formatValue(actualResponses.q6_lb_deformation)}
${actualResponses.q6_lb_deformation === 'Yes' ? `Deformation Type: ${formatValue(actualResponses.q6_lb_deformation_type)}${actualResponses.q6_lb_deformation_type_other ? ` | Custom: ${actualResponses.q6_lb_deformation_type_other}` : ''}
Bulging Locations: ${formatValue(actualResponses.q6_lb_deform_bulging_locations)}${actualResponses.q6_lb_deform_bulging_locations_other ? ` | Custom: ${actualResponses.q6_lb_deform_bulging_locations_other}` : ''}
Tilting/Leaning Locations: ${formatValue(actualResponses.q6_lb_deform_tilting_locations)}${actualResponses.q6_lb_deform_tilting_locations_other ? ` | Custom: ${actualResponses.q6_lb_deform_tilting_locations_other}` : ''}
Sagging Locations: ${formatValue(actualResponses.q6_lb_deform_sagging_locations)}${actualResponses.q6_lb_deform_sagging_locations_other ? ` | Custom: ${actualResponses.q6_lb_deform_sagging_locations_other}` : ''}` : ''}

Q7 - MATERIAL DETERIORATION (SPALLING - LOAD BEARING MASONRY):
Has Spalling: ${formatValue(actualResponses.q7_lb_spalling_has)}
${actualResponses.q7_lb_spalling_has === 'Yes' ? `Spalling Locations: ${formatValue(actualResponses.q7_lb_spalling)}${actualResponses.q7_lb_spalling_other ? ` | Custom: ${actualResponses.q7_lb_spalling_other}` : ''}` : ''}

Q8 - MOISTURE & SURFACE OBSERVATIONS (LOAD BEARING MASONRY):
a) Damp/Wet Patches: ${actualResponses.q8a_lb_damp_has === 'Yes' ? 'YES - Elements: ' + formatValue(actualResponses.q8a_lb_damp_elements) + (actualResponses.q8a_lb_damp_elements_other ? ` | Custom: ${actualResponses.q8a_lb_damp_elements_other}` : '') : 'No'}
b) White Patches/Efflorescence: ${actualResponses.q8b_lb_white_has === 'Yes' ? 'YES - Elements: ' + formatValue(actualResponses.q8b_lb_white_elements) + (actualResponses.q8b_lb_white_elements_other ? ` | Custom: ${actualResponses.q8b_lb_white_elements_other}` : '') : 'No'}
c) Green Patches/Algae/Moss: ${actualResponses.q8c_lb_green_has === 'Yes' ? 'YES - Elements: ' + formatValue(actualResponses.q8c_lb_green_elements) + (actualResponses.q8c_lb_green_elements_other ? ` | Custom: ${actualResponses.q8c_lb_green_elements_other}` : '') : 'No'}
d) Brown Patches/Water Stains: ${actualResponses.q8d_lb_brown_has === 'Yes' ? 'YES - Elements: ' + formatValue(actualResponses.q8d_lb_brown_elements) + (actualResponses.q8d_lb_brown_elements_other ? ` | Custom: ${actualResponses.q8d_lb_brown_elements_other}` : '') : 'No'}

Q9 - CORROSION (LOAD BEARING MASONRY):
Has Corrosion: ${formatValue(actualResponses.q9_lb_corrosion_has)}
${actualResponses.q9_lb_corrosion_has === 'Yes' ? `Corrosion Elements: ${formatValue(actualResponses.q9_lb_corrosion_elements)}${actualResponses.q9_lb_corrosion_elements_other ? ` | Custom: ${actualResponses.q9_lb_corrosion_elements_other}` : ''}` : ''}

Q10 - VIBRATION & DYNAMIC LOADING (LOAD BEARING MASONRY):
User Feels Vibration: ${formatValue(actualResponses.q10_lb_vibration_has)}
${actualResponses.q10_lb_vibration_has === 'Yes' ? `Vibration Sources: ${formatValue(actualResponses.q10_lb_vibration_sources)}${actualResponses.q10_lb_vibration_sources_other ? ` | Custom: ${actualResponses.q10_lb_vibration_sources_other}` : ''}` : ''}

Q11 - Soil foundation & ground conditionS (LOAD BEARING MASONRY):
Soil Types: ${formatValue(actualResponses.q11_lb_soil_types)}${actualResponses.q11_lb_soil_types_other ? ` | Custom: ${actualResponses.q11_lb_soil_types_other}` : ''}
Ground Issues Present: ${formatValue(actualResponses.q11_lb_ground_issues_has)}
${actualResponses.q11_lb_ground_issues_has === 'Yes' ? `Ground Issues: ${formatValue(actualResponses.q11_lb_ground_issues)}${actualResponses.q11_lb_ground_issues_other ? ` | Custom: ${actualResponses.q11_lb_ground_issues_other}` : ''}` : ''}

Q12 - NATURAL DISASTERS & HAZARDOUS EVENTS (LOAD BEARING MASONRY):
Disaster Experienced: ${formatValue(actualResponses.q12_lb_disaster_has)}
${actualResponses.q12_lb_disaster_has === 'Yes' ? `Disaster Types: ${formatValue(actualResponses.q12_lb_disaster_types)}${actualResponses.q12_lb_disaster_types_other ? ` | Custom: ${actualResponses.q12_lb_disaster_types_other}` : ''}` : ''}

Q13 - REMEDIAL MEASURES & EXPERT INTERVENTION (LOAD BEARING MASONRY):
Expert Intervention Requested: ${formatValue(actualResponses.q13_lb_expert_intervention_has)}
${actualResponses.q13_lb_expert_intervention_has === 'Yes' ? `Services Requested: ${formatValue(actualResponses.q13_lb_expert_intervention_types)}${actualResponses.q13_lb_expert_intervention_types_other ? ` | Custom: ${actualResponses.q13_lb_expert_intervention_types_other}` : ''}` : ''}
Subscribed for Detailed Assessment: ${actualResponses.q13_subscribe_details ? 'Yes' : 'No'}
` : ''}

${isRCC ? `
Q6 - STRUCTURAL DISTRESS (CRACKS & DEFORMATION - RCC FRAME):
Has Cracks: ${formatValue(actualResponses.q6_rcc_has_cracks)}
${actualResponses.q6_rcc_has_cracks === 'Yes' ? `Crack Elements: ${formatValue(actualResponses.q6_rcc_crack_elements)}${actualResponses.q6_rcc_crack_elements_other ? ` | Custom: ${actualResponses.q6_rcc_crack_elements_other}` : ''}
Crack Orientations: ${formatValue(actualResponses.q6_rcc_crack_orientation)}${actualResponses.q6_rcc_crack_orientation_other ? ` | Custom: ${actualResponses.q6_rcc_crack_orientation_other}` : ''}
Crack Locations: ${formatValue(actualResponses.q6_rcc_crack_location)}${actualResponses.q6_rcc_crack_location_other ? ` | Custom: ${actualResponses.q6_rcc_crack_location_other}` : ''}` : ''}
Has Deformation/Instability: ${formatValue(actualResponses.q6_rcc_deformation)}
${actualResponses.q6_rcc_deformation === 'Yes' ? `Deformation Elements: ${formatValue(actualResponses.q6_rcc_deformation_elements)}${actualResponses.q6_rcc_deformation_elements_other ? ` | Custom: ${actualResponses.q6_rcc_deformation_elements_other}` : ''}` : ''}

Q7 - MATERIAL DETERIORATION (SPALLING - RCC FRAME):
Has Spalling: ${formatValue(actualResponses.q7_rcc_spalling_has)}
${actualResponses.q7_rcc_spalling_has === 'Yes' ? `Spalling Locations: ${formatValue(actualResponses.q7_rcc_spalling)}${actualResponses.q7_rcc_spalling_other ? ` | Custom: ${actualResponses.q7_rcc_spalling_other}` : ''}` : ''}

Q8 - MOISTURE & SURFACE OBSERVATIONS (RCC FRAME):
a) Damp/Wet Patches: ${actualResponses.q8a_damp_has === 'Yes' ? 'YES - Elements: ' + formatValue(actualResponses.q8a_damp_elements) + (actualResponses.q8a_damp_elements_other ? ` | Custom: ${actualResponses.q8a_damp_elements_other}` : '') : 'No'}
b) White Patches/Efflorescence: ${actualResponses.q8b_white_has === 'Yes' ? 'YES - Elements: ' + formatValue(actualResponses.q8b_white_elements) + (actualResponses.q8b_white_elements_other ? ` | Custom: ${actualResponses.q8b_white_elements_other}` : '') : 'No'}
c) Green Patches/Algae/Moss: ${actualResponses.q8c_green_has === 'Yes' ? 'YES - Elements: ' + formatValue(actualResponses.q8c_green_elements) + (actualResponses.q8c_green_elements_other ? ` | Custom: ${actualResponses.q8c_green_elements_other}` : '') : 'No'}

Q9 - CORROSION (RCC FRAME):
Has Corrosion: ${formatValue(actualResponses.q9_rcc_corrosion_has)}
${actualResponses.q9_rcc_corrosion_has === 'Yes' ? `Corrosion Elements: ${formatValue(actualResponses.q9_rcc_corrosion_elements)}${actualResponses.q9_rcc_corrosion_elements_other ? ` | Custom: ${actualResponses.q9_rcc_corrosion_elements_other}` : ''}` : ''}

Q10 - VIBRATION & DYNAMIC LOADING (RCC FRAME):
User Feels Vibration: ${formatValue(actualResponses.q13_rcc_vibration)}
${actualResponses.q13_rcc_vibration === 'Yes' ? `Vibration Sources: ${formatValue(actualResponses.q13_rcc_vibration_sources)}${actualResponses.q13_rcc_vibration_sources_other ? ` | Custom: ${actualResponses.q13_rcc_vibration_sources_other}` : ''}` : ''}

Q11 - Soil foundation & ground conditionS (RCC FRAME):
Soil Types: ${formatValue(actualResponses.q11_soil_types)}${actualResponses.q11_soil_types_other ? ` | Custom: ${actualResponses.q11_soil_types_other}` : ''}
Ground Issues Present: ${formatValue(actualResponses.q11_ground_issues_has)}
${actualResponses.q11_ground_issues_has === 'Yes' ? `Ground Issues: ${formatValue(actualResponses.q11_ground_issues)}${actualResponses.q11_ground_issues_other ? ` | Custom: ${actualResponses.q11_ground_issues_other}` : ''}` : ''}

Q12 - NATURAL DISASTERS & HAZARDOUS EVENTS (RCC FRAME):
Disaster Experienced: ${formatValue(actualResponses.q12_disaster_has)}
${actualResponses.q12_disaster_has === 'Yes' ? `Disaster Types: ${formatValue(actualResponses.q12_disaster_types)}${actualResponses.q12_disaster_types_other ? ` | Custom: ${actualResponses.q12_disaster_types_other}` : ''}` : ''}

Q13 - REMEDIAL MEASURES & EXPERT INTERVENTION (RCC FRAME):
Expert Intervention Requested: ${formatValue(actualResponses.q13_expert_intervention_has)}
${actualResponses.q13_expert_intervention_has === 'Yes' ? `Services Requested: ${formatValue(actualResponses.q13_expert_intervention_types)}${actualResponses.q13_expert_intervention_types_other ? ` | Custom: ${actualResponses.q13_expert_intervention_types_other}` : ''}` : ''}
Subscribed for Detailed Assessment: ${actualResponses.q13_subscribe_details ? 'Yes' : 'No'}
` : ''}
`;

      let prompt = '';
      if (isDemoMode) {
        const usageClean = String(q.usage || 'Residential').replace(/\s*building\s*/gi, '').trim();
        prompt = `You are a Licensed Professional Structural Engineer evaluating a DEMO Building Assessment submission.

=== MANDATORY DEMO PRELIMINARY DATA (ALL MUST BE EXPLICITLY MENTIONED IN YOUR REPORT) ===
1. BASELINE BUILDING DATA:
   - Building Age: ${formatValue(q.age)} years
   - Location: ${formatValue(q.city)}, ${formatValue(q.country)}
   - Storeys: ${formatValue(q.storeysAbove)} storeys above ground, ${formatValue(q.storeysBelow)} storeys below ground
   - Building Usage: ${usageClean}
   - Structural System: ${formatValue(q.system || structuralSystem)}

2. OBSERVED STRUCTURAL DISTRESS (CRACKS):
   - Has Structural Cracks: ${formatValue(q.q6_has_cracks)}
   - Affected Structural Elements: ${q.q6_crack_elements}
   - Specific Crack Locations: ${q.q6_crack_location}
   - Crack Orientations: ${q.q6_crack_orientation}

3. GEOTECHNICAL & FOUNDATION CONDITIONS:
   - Soil Classification: ${formatValue(q.q11_soil_types)}
   - Ground/Foundation Issues Present: ${formatValue(q.q11_ground_issues_has)}
   - Specific Ground/Foundation Details: ${q.q11_ground_issues_has === 'Yes' ? formatValue(q.q11_ground_issues) : 'No ground issues reported'}

4. HAZARDOUS EVENT & DISASTER EXPOSURE HISTORY:
   - Disaster/Hazard Exposure Experienced: ${formatValue(q.q12_disaster_has)}
   - Specific Disaster/Hazard Types: ${q.q12_disaster_has === 'Yes' ? formatValue(q.q12_disaster_types) : 'No disaster history reported'}

=== COMPLETE RECORDED RAW RESPONSES ===
${relevantResponsesFormatted}

CRITICAL RULES FOR GENERATING THIS DEMO REPORT:
1. STRICT MANDATORY INCLUSION RULE:
   - You MUST explicitly state in Section 1 and Section 2: "${usageClean} building" (DO NOT write "building building").
   - You MUST explicitly name the affected element ("${q.q6_crack_elements}"), specific location ("${q.q6_crack_location}"), and crack orientation ("${q.q6_crack_orientation}").
   - You MUST explicitly name the soil type ("${formatValue(q.q11_soil_types)}") and ground issue ("${q.q11_ground_issues_has === 'Yes' ? formatValue(q.q11_ground_issues) : 'None'}").
   - You MUST explicitly mention the disaster exposure history ("${q.q12_disaster_has === 'Yes' ? formatValue(q.q12_disaster_types) : 'None'}").

2. FORENSIC DIAGNOSTIC TERMINOLOGY (NO GENERIC PLACEHOLDERS):
   - DO NOT say "various elements showing distress" or "normal soil".
   - Explicitly cite: "${q.q6_crack_elements} affected by ${q.q6_crack_orientation} cracks at ${q.q6_crack_location}", analyzing diagonal tension, flexural capacity, and moment continuity.
   - Explicitly cite: "${q.q11_ground_issues_has === 'Yes' ? formatValue(q.q11_ground_issues) : 'No ground issues'} on ${formatValue(q.q11_soil_types)}", analyzing soil-structure interaction (SSI), ultimate bearing capacity per IS 6403, and differential settlement kinetics.
   - Explicitly cite: "Exposure to ${q.q12_disaster_has === 'Yes' ? formatValue(q.q12_disaster_types) : 'no historical hazards'}", analyzing concrete pore pressure spalling, rebar temper loss above 300°C, and residual seismic capacity.

3. Use EXACTLY these 5 section headings (with numbers):
   1. OVERVIEW & PRELIMINARY SCREENING
   2. STRUCTURAL SYSTEM & DISTRESS EVALUATION
   3. GEOTECHNICAL & HAZARD EVALUATION
   4. PRELIMINARY RISK RATING
   5. RECOMMENDATIONS & ACTION PLAN

4. Write a detailed preliminary report (2500-3500 words). Add TWO blank lines before each main section heading. Use **text** for headings.

5. In Section 5, include this exact advisory note:
   "This demo report provides a 5-parameter preliminary screening evaluation. For a complete structural health score, Non-Destructive Testing (NDT), chemical ingress analysis, core compressive testing, and comprehensive structural calculations, you are strongly advised to complete the Basic and Advanced Questionnaire."`;
      } else {
        prompt = `You are a Licensed Professional Structural Engineer conducting a comprehensive building assessment.

${comprehensiveBuildingData}

CRITICAL INSTRUCTIONS:
1. Use EXACTLY these 6 section headings (with numbers): 1. OVERVIEW, 2. KEY OBSERVATIONS, 3. RISK SUMMARY, 4. TECHNICAL ASSESSMENT, 5. RECOMMENDATIONS, 6. CONCLUSION
2. Write a COMPREHENSIVE, DETAILED report (5000-7000 words minimum)
3. **IMPORTANT: USE ALL THE BUILDING DATA PROVIDED ABOVE** - Every single field from Q1 to Q13, including all custom text entered by the user in "Other" fields. Reference specific ages, locations, elements, observations, custom responses throughout your report.
4. Add proper spacing: TWO blank lines before each main section, ONE blank line between paragraphs
5. Use **text** for bold headings and subsections
6. Include bullet points (•) for lists with proper indentation
7. For Load-Bearing Masonry assessments, focus on masonry-specific issues (wall cracks, lintels, junctions, bulging, tilting, etc.)
8. Include every custom user input (marked as "Custom:" in the data) in your analysis

Write each section as follows:

**1. OVERVIEW**
Write 5-6 detailed paragraphs (each 6-8 sentences) covering:
- Building description: ${actualResponses.q1_age}-year-old ${actualResponses.q2_usage} building in ${actualResponses.q1_city}, ${actualResponses.q1_country}
- Structural system: ${actualResponses.q5_structural_system} with ${actualResponses.q1_storeys_above} storeys above + ${actualResponses.q1_storeys_below} below
- Environmental exposure: ${actualResponses.q3_exposure_type}
- Overall health rating (Excellent/Good/Fair/Poor/Critical) with detailed justification
- Urgency level (High/Medium/Low) based on findings
- Summary of all key findings including vibration${actualResponses.q13_rcc_vibration === 'Yes' ? ' from ' + (Array.isArray(actualResponses.q13_rcc_vibration_sources) ? actualResponses.q13_rcc_vibration_sources.join(', ') : 'sources') : ''}, soil conditions, disaster history${actualResponses.q12_disaster_has === 'Yes' ? ' (' + (Array.isArray(actualResponses.q12_disaster_types) ? actualResponses.q12_disaster_types.join(', ') : 'disasters') + ')' : ''}

**2. KEY OBSERVATIONS**
Create detailed subsections for EACH observation category. Use format "**Subsection:**" followed by detailed bullet analysis:

**Structural Cracks:**
${actualResponses.q6_rcc_has_cracks === 'Yes' ? '• Detailed analysis of cracks in ' + (Array.isArray(actualResponses.q6_rcc_crack_elements) ? actualResponses.q6_rcc_crack_elements.join(', ') : 'elements') + '\n• Crack orientations: ' + (Array.isArray(actualResponses.q6_rcc_crack_orientation) ? actualResponses.q6_rcc_crack_orientation.join(', ') : 'patterns') + '\n• Locations: ' + (Array.isArray(actualResponses.q6_rcc_crack_location) ? actualResponses.q6_rcc_crack_location.join(', ') : 'areas') + '\n• Severity assessment and structural implications\n• Load path disruption and capacity concerns' : '• No cracks observed - good structural integrity maintained'}

**Concrete Spalling & Cover Loss:**
${actualResponses.q7_rcc_spalling_has === 'Yes' ? '• Spalling observed in ' + (Array.isArray(actualResponses.q7_rcc_spalling) ? actualResponses.q7_rcc_spalling.join(', ') : 'areas') + '\n• Reinforcement exposure and protection loss\n• Concrete deterioration mechanisms\n• Durability concerns and repair urgency' : '• No spalling observed - concrete cover intact'}

**Moisture Infiltration & Water Damage:**
• Damp patches: ${actualResponses.q8a_damp_has === 'Yes' ? 'YES in ' + (Array.isArray(actualResponses.q8a_damp_elements) ? actualResponses.q8a_damp_elements.join(', ') : 'elements') + ' - analyze water ingress paths' : 'None observed'}
• Efflorescence (white deposits): ${actualResponses.q8b_white_has === 'Yes' ? 'YES in ' + (Array.isArray(actualResponses.q8b_white_elements) ? actualResponses.q8b_white_elements.join(', ') : 'elements') + ' - indicates moisture movement' : 'None observed'}
• Algae/moss growth: ${actualResponses.q8c_green_has === 'Yes' ? 'YES on ' + (Array.isArray(actualResponses.q8c_green_elements) ? actualResponses.q8c_green_elements.join(', ') : 'surfaces') + ' - persistent dampness' : 'None observed'}

**Reinforcement Corrosion:**
${actualResponses.q9_rcc_corrosion_has === 'Yes' ? '• Corrosion evidence in ' + (Array.isArray(actualResponses.q9_rcc_corrosion_elements) ? actualResponses.q9_rcc_corrosion_elements.join(', ') : 'elements') + '\n• Chloride ingress and carbonation effects\n• Section loss and capacity reduction\n• Aggressive environmental exposure (' + (actualResponses.q3_exposure_type || 'conditions') + ')' : '• No visible corrosion - protective measures effective'}

**Structural Deformations:**
${actualResponses.q6_rcc_deformation === 'Yes' ? '• Deformation observed in ' + (Array.isArray(actualResponses.q6_rcc_deformation_elements) ? actualResponses.q6_rcc_deformation_elements.join(', ') : 'elements') + '\n• Deflection patterns and serviceability concerns\n• Potential foundation or load-related issues' : '• No abnormal deformations detected'}

**Vibration & Dynamic Loading:**
${actualResponses.q13_rcc_vibration === 'Yes' ? '• Vibration sources: ' + (Array.isArray(actualResponses.q13_rcc_vibration_sources) ? actualResponses.q13_rcc_vibration_sources.join(', ') : 'identified') + '\n• Frequency and amplitude analysis needed\n• Fatigue and cumulative damage assessment\n• Impact on structural integrity and occupant comfort\n• Crack propagation risk from cyclic loading\n• Mitigation measures required' : '• No significant vibration reported - static loading only'}

**Foundation & Geotechnical Conditions:**
• Soil types: ${Array.isArray(actualResponses.q11_soil_types) ? actualResponses.q11_soil_types.join(', ') : 'not specified'}
${actualResponses.q11_ground_issues_has === 'Yes' ? '• Ground issues present: ' + (Array.isArray(actualResponses.q11_ground_issues) ? actualResponses.q11_ground_issues.join(', ') : 'concerns') + '\n• Bearing capacity concerns\n• Settlement and differential movement\n• Foundation investigation required' : '• No ground stability issues reported'}

**Natural Disaster Exposure:**
${actualResponses.q12_disaster_has === 'Yes' ? '• Building experienced: ' + (Array.isArray(actualResponses.q12_disaster_types) ? actualResponses.q12_disaster_types.join(', ') : 'disasters') + '\n• Post-disaster structural assessment critical\n• Residual capacity and hidden damage concerns\n• Strengthening and retrofitting needs' : '• No disaster history - assess preparedness for future events'}

${actualResponses.q4_floors_added === 'Yes' ? '**Structural Modifications:**\n• Additional floors: ' + (actualResponses.q4_floors_details || 'added after original construction') + '\n• Increased dead and live loads on existing structure\n• Original design capacity may be exceeded\n• Structural adequacy verification required' : ''}

**3. RISK SUMMARY**
Categorize ALL findings by urgency. Use clear formatting:

**CRITICAL/HIGH RISK (Immediate Action - 0-1 month):**
• [List all urgent safety issues]
${actualResponses.q12_disaster_has === 'Yes' ? '• Post-disaster structural damage requiring immediate assessment' : ''}
${actualResponses.q11_ground_issues_has === 'Yes' ? '• Foundation and ground stability concerns' : ''}
${actualResponses.q13_rcc_vibration === 'Yes' ? '• Severe vibration affecting structural integrity' : ''}
• [Exposed reinforcement, active corrosion, capacity concerns]

**MEDIUM RISK (Prompt Action - 1-6 months):**
• [List important deterioration issues]
• [Progressive spalling, corrosion, serviceability concerns]
• [Water ingress requiring waterproofing]

**LOW RISK (Monitoring & Maintenance - 6-24 months):**
• [List maintenance items and preventive measures]
• [Minor cosmetic issues, periodic inspections]

**4. TECHNICAL ASSESSMENT**
Write 6-7 comprehensive technical paragraphs (each 7-9 sentences):

Paragraph 1 - Structural Integrity Analysis: Discuss load-carrying capacity of ${actualResponses.q1_age}-year-old ${actualResponses.q5_structural_system} system, safety factors per IS 456:2000, deterioration impact on strength and stiffness, reserve capacity analysis, member adequacy for current and future loads${actualResponses.q4_floors_added === 'Yes' ? ', critical impact of added floors exceeding original design capacity' : ''}, structural redundancy.

Paragraph 2 - Seismic Vulnerability Assessment: IS 1893 compliance for ${actualResponses.q1_city} seismic zone, ductility and detailing per IS 13920, lateral load resisting system adequacy, potential weak zones and soft storeys${actualResponses.q4_floors_added === 'Yes' ? ', modified mass and stiffness distribution from vertical extension, increased seismic demand' : ''}, need for seismic evaluation and retrofitting.

Paragraph 3 - Vibration & Fatigue Analysis: ${actualResponses.q13_rcc_vibration === 'Yes' ? 'Comprehensive analysis of vibration from ' + (Array.isArray(actualResponses.q13_rcc_vibration_sources) ? actualResponses.q13_rcc_vibration_sources.join(' and ') : 'sources') + '. Discuss resonance frequencies, acceleration limits per IS 2911, fatigue stress ranges, cumulative damage from cyclic loading, crack initiation and propagation, long-term durability implications, structural health monitoring needs, mitigation strategies.' : 'No significant vibration sources identified. Discuss importance of monitoring for future dynamic loads from traffic, construction or machinery. Address serviceability limits and occupant comfort per IS 800 for static loads only.'}

Paragraph 4 - Geotechnical & Foundation Assessment: Foundation system type and adequacy for identified soil conditions (${Array.isArray(actualResponses.q11_soil_types) ? actualResponses.q11_soil_types.join(', ') : 'soil type'}), bearing capacity per IS 6403, settlement analysis for ${actualResponses.q1_age} years of service${actualResponses.q11_ground_issues_has === 'Yes' ? ', detailed investigation of observed ' + (Array.isArray(actualResponses.q11_ground_issues) ? actualResponses.q11_ground_issues.join(', ') : 'ground issues') + ' with bore holes and SPT' : ''}, groundwater table effects, liquefaction potential in seismic zones, soil-structure interaction.

Paragraph 5 - Post-Disaster Structural Evaluation: ${actualResponses.q12_disaster_has === 'Yes' ? 'Comprehensive assessment of structural condition after experiencing ' + (Array.isArray(actualResponses.q12_disaster_types) ? actualResponses.q12_disaster_types.join(', ') : 'disasters') + '. Discuss visible and hidden damage patterns, residual load-carrying capacity, plastic hinge formation, member damage states per IS 13935:2009, need for detailed investigation using NDT, strengthening and retrofitting requirements per IS 13827, safety certification process.' : 'Building has no disaster exposure history. Discuss preparedness assessment for potential future events per IS 1893, seismic deficiency evaluation, need for vulnerability assessment, importance of disaster mitigation measures, retrofitting strategy for enhanced resilience.'}

Paragraph 6 - Material Deterioration Mechanisms: Concrete carbonation depth estimation for ${actualResponses.q1_age} years exposure, chloride ingress rates for ${actualResponses.q3_exposure_type || 'environmental'} conditions per IS 456 exposure classifications, corrosion initiation threshold, propagation phase kinetics, environmental attack mechanisms (sulfate, acid, alkali-aggregate reaction), durability provisions compliance, remaining service life prediction using Tuutti model.

Paragraph 7 - Environmental Exposure Effects: Detailed analysis of ${actualResponses.q3_exposure_type || 'environmental'} exposure classification per IS 456 Table 3, degradation acceleration factors, cover adequacy for exposure class, concrete grade suitability, protective measures effectiveness, micro-climate effects, future deterioration projection.

**5. RECOMMENDATIONS**
Organize chronologically with detailed subsections:

**IMMEDIATE ACTIONS (0-3 months):**
• **Non-Destructive Testing:** Rebound Hammer (IS 13311 Part 2), Ultrasonic Pulse Velocity (IS 13311 Part 1), Half-Cell Potential (ASTM C876), Cover meter survey, Core extraction and compressive strength testing
• **Safety Measures:** Temporary propping/shoring if capacity concerns, load restrictions, access control for unsafe areas
${actualResponses.q13_expert_intervention_has === 'Yes' ? '• **CLIENT REQUESTED SERVICES:** ' + (Array.isArray(actualResponses.q13_expert_intervention_types) ? actualResponses.q13_expert_intervention_types.join(', ') + ' - Initiate immediately as per client requirements' : 'Expert intervention services') : '• **Detailed Structural Assessment:** Comprehensive evaluation per IS 13935:2009 by licensed structural engineer'}
${actualResponses.q13_rcc_vibration === 'Yes' ? '• **Vibration Monitoring Program:** Install tri-axial accelerometers, conduct frequency analysis, measure peak particle velocity, implement source isolation, assess structural response' : ''}
${actualResponses.q11_ground_issues_has === 'Yes' ? '• **Ground Investigation:** Bore holes with SPT, foundation excavation and inspection, settlement monitoring with precise leveling' : ''}
${actualResponses.q12_disaster_has === 'Yes' ? '• **Post-Disaster Safety Assessment:** Rapid visual screening, detailed damage documentation, tagging (Green/Yellow/Red), safety certification' : ''}

**SHORT-TERM ACTIONS (3-12 months):**
• **Crack Repair:** Epoxy injection per IS 15477 for structural cracks, polymer-modified mortar for non-structural cracks, route and seal for dormant cracks
• **Spalling Repair:** Remove loose concrete, clean reinforcement, apply rust converter, rebuild with polymer-modified repair mortar, apply protective coating
• **Corrosion Protection:** Cathodic protection systems, re-alkalisation treatment, corrosion inhibitors, sacrificial anodes for ongoing protection
• **Waterproofing:** External waterproofing membrane, crystalline waterproofing for internal surfaces, improve drainage, seal joints
• **Strengthening:** FRP wrapping for shear/flexural enhancement, concrete jacketing for columns, steel plate bonding, external post-tensioning if required
${actualResponses.q4_floors_added === 'Yes' ? '• **Capacity Enhancement:** Structural strengthening to address increased loads from added floors, column jacketing, beam strengthening, foundation augmentation if needed' : ''}
${actualResponses.q12_disaster_has === 'Yes' ? '• **Seismic Retrofitting:** Shear wall addition, steel bracing systems, base isolation feasibility, connection strengthening per IS 13827 and IS 13920' : ''}

**LONG-TERM ACTIONS (1-5 years):**
• **Preventive Maintenance:** Anti-carbonation coating application, regular facade cleaning, drainage system maintenance, joint sealing, protective treatments
${actualResponses.q13_expert_intervention_types?.includes('Structural Health Monitoring') ? '• **Implement SHMS (as requested by client):** Install sensor network (strain gauges, tiltmeters, accelerometers, crack meters), data acquisition system, automated alerts, periodic data analysis' : '• **Structural Health Monitoring System:** Continuous monitoring of critical parameters, sensor network for crack widths, deflections, strains, accelerations'}
• **Periodic Re-assessment:** Detailed inspections every 6-12 months initially, comprehensive assessment per IS 13935 annually, adjust frequency based on deterioration rate
• **Documentation:** Maintain structural health records, repair and maintenance logs, testing reports, as-built drawings with modifications, assessment history

**6. CONCLUSION**
Write 5 comprehensive concluding paragraphs (each 6-7 sentences):

Paragraph 1: Final structural health status - provide definitive overall rating (Excellent/Good/Fair/Poor/Critical) for this ${actualResponses.q1_age}-year-old ${actualResponses.q2_usage} building in ${actualResponses.q1_city}. State confidence level in assessment (High/Medium/Low) and basis (visual inspection, provided data, professional experience). Summarize overall structural adequacy and safety.

Paragraph 2: Most critical findings requiring immediate attention - prioritize top 3-5 issues by safety impact, describe potential consequences if unaddressed (collapse risk, safety hazards, progressive deterioration, liability), justify urgency classification, state recommended timeline for action (days/weeks/months).

Paragraph 3: Service life prognosis - WITH timely intervention: expected remaining service life (years), achievable performance level, cost-benefit analysis; WITHOUT intervention: deterioration timeline, critical failure scenarios, liability and safety risks, economic implications of delayed action.

Paragraph 4: Professional recommendations - strongly recommend comprehensive detailed structural assessment per IS 13935:2009 by licensed structural engineer ${actualResponses.q13_expert_intervention_has === 'Yes' ? ', specifically addressing client request for ' + (Array.isArray(actualResponses.q13_expert_intervention_types) ? actualResponses.q13_expert_intervention_types[0] : 'expert services') + ' as priority action, suggested next steps include engaging qualified consultant within 30 days, scope of work for detailed investigation, expected deliverables and timeline' : ', scope to include NDT investigation, structural analysis, capacity evaluation, detailed recommendations'}. Emphasize importance of specialized testing and material investigation beyond visual assessment.

Paragraph 5: Disclaimer - this is preliminary assessment based on visual inspection data and questionnaire responses provided, not a substitute for detailed structural investigation per IS 13935, limitations include no access to hidden elements, no material testing performed, no structural calculations conducted, recommendations are general guidance, final decisions require detailed engineering analysis by qualified professional, engineer liability limitations, owner's responsibility for implementation and safety.

CRITICAL FORMATTING FOR PDF GENERATION:
• Add TWO blank lines (\\n\\n) before each main section
• Add ONE blank line between paragraphs within sections  
• Use **text** for all headings and subheadings
• Use bullet points (•) with consistent indentation
• Write paragraphs of 6-9 sentences each for comprehensive coverage
• Target 6000-8000 words total for detailed technical report
• Base EVERYTHING on the actual building data provided above
• Mention specific numbers, locations, elements, observations throughout`;
      }

      try {
        const response = await axios.post(
          GROQ_API_URL,
          {
            model: GROQ_MODEL,
            messages: [
              {
                role: 'system',
                content: `You are a Senior Forensic Structural Engineer & BIS Standard Specialist (IS 456:2000, IS 1893:2016, IS 13935:2009, IS 800:2007, IS 1905:1987, IS 13827:1993).
Your job is to generate authoritative, forensic structural assessment reports.

KEYWORD & ACCURACY MANDATES:
1. ALWAYS weave exact user inputs (element names, crack locations, crack orientations, soil types, foundation issues, disaster history) directly into the diagnostic narrative. Never replace specific inputs with generic placeholders.
2. Use precise forensic structural terminology:
   - Flexural vs shear crack mechanics, diagonal tension stress, load-bearing capacity reduction, moment frame adequacy.
   - Soil-structure interaction (SSI), ultimate bearing capacity, differential settlement kinetics, plinth erosion/washout mechanics.
   - Thermal kinetics & fire damage evaluation: spalling due to pore water pressure, rebar yield strength degradation, residual load capacity, petrographic analysis.
3. Strictly follow section numbers and formatting guidelines provided in the user prompt.`
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.7,
            max_tokens: 8000,
            top_p: 0.95
          },
          {
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        report = response.data.choices?.[0]?.message?.content;

        if (!report) {
          // Unexpected response structure — fall back to mock
          groqDebug = response.data;
          console.warn('GROQ returned an unexpected response, falling back to mock.');
          report = generateMockReport(user_details, assessment_responses);
          usedMock = true;
        }
      } catch (groqError) {
        // Log detailed GROQ error then fall back to mock generator
        console.error('GROQ API call failed:', groqError.message);
        groqDebug = groqError.response?.data || groqError.message;
        report = generateMockReport(user_details, assessment_responses);
        usedMock = true;
      }
    } else {
      console.log('GROQ API key not configured. Using mock report generator...');
      report = generateMockReport(user_details, assessment_responses);
    }

    const source = usedMock ? 'Mock (fallback)' : (GROQ_API_KEY ? 'GROQ API' : 'Mock Generator');
    const resp = {
      success: true,
      report: report,
      timestamp: new Date().toISOString(),
      source
    };

    if (usedMock && groqDebug) {
      resp.groq_debug = groqDebug;
    }

    // Notify admins via email (office@spplindia.org & raj-it@spplindia.org)
    notifyAdminOnAssessmentSubmission(
      user_details,
      user_details?.structureType || 'Building Assessment',
      report,
      null,
      req.body.assessmentId || ('ASSESS_' + Date.now())
    );

    res.json(resp);

  } catch (error) {
    console.error('Error generating report:', error.message);
    console.error('Error status:', error.response?.status);
    console.error('Error data:', error.response?.data);
    
    let errorMessage = 'Error generating report';
    if (error.response?.status === 400) {
      errorMessage = 'Bad request - invalid API key or request format';
    } else if (error.response?.status === 401) {
      errorMessage = 'API authentication failed - invalid GROQ API key';
    } else if (error.response?.status === 429) {
      errorMessage = 'Rate limited - please try again later';
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMessage = 'Connection failed - GROQ service unavailable';
    }

    res.status(500).json({
      error: errorMessage,
      details: error.message
    });
  }
});

// Legacy alias for older clients/tests: proxy to /api/generate-building-report
app.post('/api/generate-report', async (req, res) => {
  try {
    const target = `http://localhost:${process.env.PORT || 5000}/api/generate-building-report`;
    const resp = await axios.post(target, req.body, { timeout: 120000 });
    return res.status(resp.status).json(resp.data);
  } catch (err) {
    console.error('Proxy to /api/generate-building-report failed:', err.message);
    if (err.response) {
      return res.status(err.response.status).send(err.response.data);
    }
    return res.status(500).json({ error: 'Internal proxy error', details: err.message });
  }
});

// Legacy alias: proxy /api/generate-pdf to /api/generate-building-report-pdf
app.post('/api/generate-pdf', async (req, res) => {
  try {
    const target = `http://localhost:${process.env.PORT || 5000}/api/generate-building-report-pdf`;
    const resp = await axios.post(target, req.body, { responseType: 'arraybuffer', timeout: 120000 });
    // Avoid copying transfer-encoding/content-length to prevent header conflicts
    const safeHeaders = { 'content-type': resp.headers['content-type'] };
    if (resp.headers['content-disposition']) safeHeaders['content-disposition'] = resp.headers['content-disposition'];
    res.status(resp.status).set(safeHeaders).send(resp.data);
  } catch (err) {
    console.error('Proxy to /api/generate-building-report-pdf failed:', err.message);
    if (err.response) {
      return res.status(err.response.status).send(err.response.data);
    }
    return res.status(500).json({ error: 'Internal proxy error', details: err.message });
  }
});

// PDF generation endpoint using PDFKit
app.post('/api/generate-building-report-pdf', async (req, res) => {
  try {
    const user_details = req.body.user_details || req.body.userDetails || {};
    const assessment_responses = req.body.assessment_responses || req.body.assessmentResponses;
    let reportText = req.body.reportText || req.body.report_text || undefined;

    if (!assessment_responses && !reportText) {
      return res.status(400).json({ error: 'Missing assessment responses or reportText' });
    }

    // Unwrap the raw responses if they are wrapped (may be undefined when reportText provided)
    const actualResponses = (assessment_responses && (assessment_responses.raw_responses || assessment_responses)) || {};

    console.log('📄 Generating AI report and/or PDF...');
    console.log('  - User:', user_details?.name || 'Unknown');
    console.log('  - Using reportText provided:', !!reportText);
    console.log('  - Total fields from responses:', Object.keys(actualResponses).length);
    let usedMock = false;

    if (reportText) {
      console.log('Using provided reportText for PDF generation.');
    } else if (GROQ_API_KEY) {
      console.log('🤖 Using GROQ API to generate comprehensive report...');
      
      // Build comprehensive prompt from ACTUAL assessment responses
      const buildingInfo = `
Building Age: ${actualResponses.q1_age} years (Range: ${actualResponses.q1_ageRange || 'N/A'})
Location: ${actualResponses.q1_city}${actualResponses.q1_city_other ? ` (${actualResponses.q1_city_other})` : ''}, ${actualResponses.q1_country}${actualResponses.q1_country_other ? ` (${actualResponses.q1_country_other})` : ''}
Storeys: ${actualResponses.q1_storeys_above} above ground, ${actualResponses.q1_storeys_below} below ground
Building Type: ${actualResponses.q2_usage}${actualResponses.q2_usage_other ? ` (${actualResponses.q2_usage_other})` : ''}
Structural System: ${actualResponses.q5_structural_system}
Environmental Exposure: ${actualResponses.q3_exposure_type}${actualResponses.q3_exposure_other ? ` (${actualResponses.q3_exposure_other})` : ''}
Additional Floors: ${actualResponses.q4_floors_added}${actualResponses.q4_floors_added === 'Yes' ? ` - ${actualResponses.q4_floors_details || 'details not provided'}` : ''}
Floor Added After Construction: ${actualResponses.q4_floors_added_after || 'Not specified'}
Heavy Machinery: ${actualResponses.q4_heavy_machinery || 'Not specified'}

=== STRUCTURAL OBSERVATIONS ===

Q6 - RCC CRACKS:
Has Cracks: ${actualResponses.q6_rcc_has_cracks || 'Not specified'}
Crack Elements: ${Array.isArray(actualResponses.q6_rcc_crack_elements) ? actualResponses.q6_rcc_crack_elements.join(', ') : 'None'}${actualResponses.q6_rcc_crack_elements_other ? ` (${actualResponses.q6_rcc_crack_elements_other})` : ''}
Crack Orientation: ${Array.isArray(actualResponses.q6_rcc_crack_orientation) ? actualResponses.q6_rcc_crack_orientation.join(', ') : 'None'}${actualResponses.q6_rcc_crack_orientation_other ? ` (${actualResponses.q6_rcc_crack_orientation_other})` : ''}
Crack Location: ${Array.isArray(actualResponses.q6_rcc_crack_location) ? actualResponses.q6_rcc_crack_location.join(', ') : 'None'}${actualResponses.q6_rcc_crack_location_other ? ` (${actualResponses.q6_rcc_crack_location_other})` : ''}
Has Deformation: ${actualResponses.q6_rcc_deformation || 'Not specified'}
Deformation Elements: ${Array.isArray(actualResponses.q6_rcc_deformation_elements) ? actualResponses.q6_rcc_deformation_elements.join(', ') : 'None'}${actualResponses.q6_rcc_deformation_elements_other ? ` (${actualResponses.q6_rcc_deformation_elements_other})` : ''}

Q7 - RCC SPALLING:
Has Spalling: ${actualResponses.q7_rcc_spalling_has || 'Not specified'}
Spalling Locations: ${Array.isArray(actualResponses.q7_rcc_spalling) ? actualResponses.q7_rcc_spalling.join(', ') : 'None'}${actualResponses.q7_rcc_spalling_other ? ` (${actualResponses.q7_rcc_spalling_other})` : ''}

Q8 - SURFACE OBSERVATIONS:
Damp Patches: ${actualResponses.q8a_damp_has === 'Yes' ? 'YES - ' + (Array.isArray(actualResponses.q8a_damp_elements) ? actualResponses.q8a_damp_elements.join(', ') : 'locations') : 'No'}${actualResponses.q8a_damp_elements_other ? ` (${actualResponses.q8a_damp_elements_other})` : ''}
White Patches (Efflorescence): ${actualResponses.q8b_white_has === 'Yes' ? 'YES - ' + (Array.isArray(actualResponses.q8b_white_elements) ? actualResponses.q8b_white_elements.join(', ') : 'locations') : 'No'}${actualResponses.q8b_white_elements_other ? ` (${actualResponses.q8b_white_elements_other})` : ''}
Green Patches (Algae/Moss): ${actualResponses.q8c_green_has === 'Yes' ? 'YES - ' + (Array.isArray(actualResponses.q8c_green_elements) ? actualResponses.q8c_green_elements.join(', ') : 'locations') : 'No'}${actualResponses.q8c_green_elements_other ? ` (${actualResponses.q8c_green_elements_other})` : ''}

Q9 - CORROSION:
Has Corrosion: ${actualResponses.q9_rcc_corrosion_has || 'Not specified'}
Corrosion Elements: ${Array.isArray(actualResponses.q9_rcc_corrosion_elements) ? actualResponses.q9_rcc_corrosion_elements.join(', ') : 'None'}${actualResponses.q9_rcc_corrosion_elements_other ? ` (${actualResponses.q9_rcc_corrosion_elements_other})` : ''}

Q10 - VIBRATION & DYNAMIC LOADING:
User Feels Vibration: ${actualResponses.q13_rcc_vibration || 'Not specified'}
Vibration Sources: ${Array.isArray(actualResponses.q13_rcc_vibration_sources) ? actualResponses.q13_rcc_vibration_sources.join(', ') : 'None'}${actualResponses.q13_rcc_vibration_sources_other ? ` (${actualResponses.q13_rcc_vibration_sources_other})` : ''}

Q11 - Soil foundation & ground conditionS:
Soil Types: ${Array.isArray(actualResponses.q11_soil_types) ? actualResponses.q11_soil_types.join(' | ') : 'Not specified'}${actualResponses.q11_soil_types_other ? ` (${actualResponses.q11_soil_types_other})` : ''}
Ground Issues Present: ${actualResponses.q11_ground_issues_has || 'Not specified'}
Ground Issues: ${Array.isArray(actualResponses.q11_ground_issues) ? actualResponses.q11_ground_issues.join(', ') : 'None'}${actualResponses.q11_ground_issues_other ? ` (${actualResponses.q11_ground_issues_other})` : ''}

Q12 - NATURAL DISASTERS & HAZARDOUS EVENTS:
Disaster Experienced: ${actualResponses.q12_disaster_has || 'Not specified'}
Disaster Types: ${Array.isArray(actualResponses.q12_disaster_types) ? actualResponses.q12_disaster_types.join(', ') : 'None'}${actualResponses.q12_disaster_types_other ? ` (${actualResponses.q12_disaster_types_other})` : ''}

Q13 - REMEDIAL MEASURES & EXPERT INTERVENTION:
Expert Intervention Requested: ${actualResponses.q13_expert_intervention_has || 'Not specified'}
Services Requested: ${Array.isArray(actualResponses.q13_expert_intervention_types) ? actualResponses.q13_expert_intervention_types.join(', ') : 'None'}${actualResponses.q13_expert_intervention_types_other ? ` (${actualResponses.q13_expert_intervention_types_other})` : ''}
Subscribed for Detailed Assessment: ${actualResponses.q13_subscribe_details ? 'Yes' : 'No'}
`;

      const observationsText = Object.entries(actualResponses)
        .filter(([key, value]) => {
          // Exclude arrays and already included fields
          if (key.startsWith('q11_') || key.startsWith('q12_') || key.startsWith('q13_rcc_vibration')) return false;
          return value && typeof value === 'string' && value.length > 10;
        })
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');

      const prompt = `You are a Licensed Professional Structural Engineer conducting a building assessment.

CRITICAL REQUIREMENT - USE THESE EXACT 6 SECTION HEADINGS ONLY:
1. OVERVIEW
2. KEY OBSERVATIONS  
3. RISK SUMMARY
4. TECHNICAL ASSESSMENT
5. RECOMMENDATIONS
6. CONCLUSION

BUILDING DATA:
${buildingInfo}

OBSERVATIONS:
${observationsText}

Generate a comprehensive structural assessment report. Each section must start with its number and title exactly as shown above. Use proper spacing between sections and paragraphs.

CRITICAL: In your analysis, you MUST address these newly collected parameters:
- Vibration sources and dynamic loading effects (Q10)
- Foundation soil types and ground stability issues (Q11)
- Natural disaster history and post-event structural status (Q12)
- Expert intervention needs and remedial measure requirements (Q13)

Write detailed, technical content under each heading:

1. OVERVIEW
[Write 4-5 detailed paragraphs about: building details (${actualResponses.q1_age || 'N/A'} years old, located in ${actualResponses.q1_city || 'N/A'}, ${actualResponses.q5_structural_system || 'N/A'} system), assessment scope, overall health rating with justification, key findings summary INCLUDING VIBRATION SOURCES, SOIL CONDITIONS, DISASTER HISTORY and  EXPERT INTERVENTION NEEDS, environmental exposure (${actualResponses.q3_exposure_type || 'N/A'}), methodology. 

Each paragraph should be 5-7 sentences long. Add blank line between paragraphs.]

2. KEY OBSERVATIONS  
[Create clear subsections with detailed findings. Use format "**Subsection Name:**" followed by bullet points (• or -). Cover: 

**Structural Cracks:** ${actualResponses.q6_rcc_has_cracks === 'Yes' ? (Array.isArray(actualResponses.q6_rcc_crack_elements) ? actualResponses.q6_rcc_crack_elements.join(', ') : 'elements') : 'None observed'}
• Detail the crack patterns orientations, locations, severity
• Discuss structural implications and load path disruption

**Material Degradation:** ${actualResponses.q7_rcc_spalling_has === 'Yes' ? (Array.isArray(actualResponses.q7_rcc_spalling) ? actualResponses.q7_rcc_spalling.join(', ') : 'spalling') : 'None observed'}
• Spalling extent and reinforcement exposure
• Concrete cover loss and durability concerns

**Moisture Infiltration:** (damp: ${actualResponses.q8a_damp_has || 'No'}, efflorescence: ${actualResponses.q8b_white_has || 'No'}, algae: ${actualResponses.q8c_green_has || 'No'})
• Water ingress paths and affected areas
• Dampness patterns and severity

**Reinforcement Corrosion:** ${actualResponses.q9_rcc_corrosion_has === 'Yes' ? (Array.isArray(actualResponses.q9_rcc_corrosion_elements) ? actualResponses.q9_rcc_corrosion_elements.join(', ') : 'elements') : 'None observed'}
• Corrosion indicators and extent
• Chloride ingress and carbonation effects

**Structural Deformations:** ${actualResponses.q6_rcc_deformation === 'Yes' ? (Array.isArray(actualResponses.q6_rcc_deformation_elements) ? actualResponses.q6_rcc_deformation_elements.join(', ') : 'elements') : 'None observed'}
• Deflection, tilting, settlement patterns
• Serviceability and safety implications

**Vibration & Dynamic Loading:** ${actualResponses.q13_rcc_vibration === 'Yes' ? 'YES - Sources: ' + (Array.isArray(actualResponses.q13_rcc_vibration_sources) ? actualResponses.q13_rcc_vibration_sources.join(', ') : 'identified sources') : 'No vibration reported'}
${actualResponses.q13_rcc_vibration === 'Yes' ? '• Analyze vibration frequencies and amplitudes\n• Discuss fatigue and cumulative damage effects\n• Assess impact on structural integrity' : ''}

**Foundation & Soil Conditions:** Soil types: ${Array.isArray(actualResponses.q11_soil_types) ? actualResponses.q11_soil_types.join(', ') : 'not specified'} | Ground stability: ${actualResponses.q11_ground_issues_has === 'Yes' ? 'ISSUES PRESENT - ' + (Array.isArray(actualResponses.q11_ground_issues) ? actualResponses.q11_ground_issues.join(', ') : 'concerns') : 'Stable'}
• Foundation bearing capacity adequacy
• Settlement, subsidence or differential movement
• Geotechnical risk factors

**Disaster Exposure History:** ${actualResponses.q12_disaster_has === 'Yes' ? 'EXPERIENCED - ' + (Array.isArray(actualResponses.q12_disaster_types) ? actualResponses.q12_disaster_types.join(', ') : 'disasters') : 'No disaster history'}
${actualResponses.q12_disaster_has === 'Yes' ? '• Post-disaster structural damage assessment\n• Residual capacity and safety concerns\n• Need for strengthening or retrofitting' : ''}

Add blank lines between subsections.]

3. RISK SUMMARY
[Categorize ALL findings into three risk levels with clear bullet points. INCLUDE VIBRATION, SOIL and  DISASTER RISKS:

**CRITICAL/HIGH RISK (Immediate Action - 0-1 month):**
• List urgent safety issues including disaster damage
• Severe vibration affecting structural integrity
• Foundation settlement or bearing failure
• Exposed reinforcement with active corrosion
• Structural capacity concerns
• Major cracks threatening stability

**MEDIUM RISK (Prompt Action - 1-6 months):**
• List important deterioration including moderate vibration
• Soil settlement requiring monitoring
• Progressive spalling and corrosion
• Serviceability issues
• Water ingress and moisture problems
• Durability degradation

**LOW RISK (Monitoring & Maintenance - 6-24 months):**
• List maintenance items
• Minor cosmetic issues
• Preventive treatments
• Periodic inspections

Add blank line between risk categories.]

4. TECHNICAL ASSESSMENT
[Write 5-6 detailed technical paragraphs (each 6-8 sentences) analyzing: 

Paragraph 1 - Structural Integrity: Load-carrying capacity, safety factors per IS 456:2000, deterioration impact on strength, reserve capacity analysis, member adequacy for current and future loads${actualResponses.q4_floors_added === 'Yes' ? ', impact of added floors on original design capacity' : ''}.

Paragraph 2 - Seismic Vulnerability: IS 1893 compliance for ${actualResponses.q1_city || 'location'} seismic zone, ductility and detailing adequacy, potential weak zones, lateral load resistance${actualResponses.q4_floors_added === 'Yes' ? ', modified mass and stiffness distribution due to added floors' : ''}.

Paragraph 3 - Vibration Analysis: ${actualResponses.q13_rcc_vibration === 'Yes' ? 'Detailed analysis of ' + (Array.isArray(actualResponses.q13_rcc_vibration_sources) ? actualResponses.q13_rcc_vibration_sources.join(' and ') : 'vibration') + ' on structural health. Discuss resonance risks, fatigue accumulation, crack propagation due to cyclic loading, acceleration limits per IS 2911 and  long-term durability implications.' : 'No significant vibration sources identified. Discuss importance of monitoring for future dynamic loads.'}

Paragraph 4 - Geotechnical Considerations: Foundation system adequacy for soil type (${Array.isArray(actualResponses.q11_soil_types) ? actualResponses.q11_soil_types[0] : 'soil'}), bearing capacity per IS 6403, settlement analysis${actualResponses.q11_ground_issues_has === 'Yes' ? ', investigation of observed ' + (Array.isArray(actualResponses.q11_ground_issues) ? actualResponses.q11_ground_issues.join(', ') : 'ground issues') : ''}, groundwater effects, liquefaction potential.

Paragraph 5 - Post-Disaster Assessment: ${actualResponses.q12_disaster_has === 'Yes' ? 'Comprehensive evaluation of structural condition after experiencing ' + (Array.isArray(actualResponses.q12_disaster_types) ? actualResponses.q12_disaster_types.join(', ') : 'disasters') + '. Discuss residual capacity, hidden damage, need for detailed investigation per IS 13935:2009 and  retrofitting requirements.' : 'Building has not experienced major disasters. Discuss preparedness for potential future events and importance of seismic retrofitting if applicable.'}

Paragraph 6 - Material Deterioration Mechanisms: Carbonation depth, chloride ingress rates for ${actualResponses.q3_exposure_type || 'exposure'} condition, corrosion initiation and propagation, environmental attack mechanisms, durability per IS 456 provisions, remaining service life estimation.

Add blank line between paragraphs.]

5. RECOMMENDATIONS  
[Organize by timeline with detailed subsections. ADDRESS EXPERT INTERVENTION REQUESTS (Q13):

**IMMEDIATE ACTIONS (0-3 months):**
• NDT Investigation: Rebound Hammer (IS 13311 Part 2), UPV testing (IS 13311 Part 1), Half-Cell potential mapping (ASTM C876), Cover meter survey, Core extraction and testing
• Safety Measures: Temporary propping if needed, load restrictions, access control
${actualResponses.q13_expert_intervention_has === 'Yes' ? '• **CLIENT REQUESTED SERVICES:** ' + (Array.isArray(actualResponses.q13_expert_intervention_types) ? actualResponses.q13_expert_intervention_types.join(', ') : 'Expert intervention') : '• Detailed Structural Assessment per IS 13935:2009'}
${actualResponses.q13_rcc_vibration === 'Yes' ? '• **Vibration Monitoring:** Install accelerometers, conduct frequency analysis, implement source isolation measures' : ''}
${actualResponses.q11_ground_issues_has === 'Yes' ? '• **Ground Investigation:** Bore holes, SPT, foundation inspection, settlement monitoring' : ''}
${actualResponses.q12_disaster_has === 'Yes' ? '• **Post-Disaster Assessment:** Detailed damage mapping, capacity evaluation, safety certification' : ''}

**SHORT-TERM ACTIONS (3-12 months):**
• Structural Repairs: Epoxy injection for cracks (IS 15477), spalling repair with polymer-modified mortar, corrosion protection (cathodic protection or re-alkalisation)
• Waterproofing: External waterproofing membrane, drainage improvement, damp-proofing treatments
• Strengthening: FRP wrapping if needed, concrete jacketing, steel plate bonding
${actualResponses.q4_floors_added === 'Yes' ? '• Capacity Enhancement: Address load increase from added floors, strengthen existing members if required' : ''}
${actualResponses.q12_disaster_has === 'Yes' ? '• Seismic Retrofitting: Shear walls, bracing systems, base isolation considerations' : ''}

**LONG-TERM ACTIONS (1-5 years):**
• Preventive Maintenance: Anti-carbonation coating, regular cleaning, drainage maintenance
${actualResponses.q13_expert_intervention_types?.includes('Structural Health Monitoring') ? '• **Implement SHMS (as requested):** Install sensors, continuous monitoring, automated alerts' : '• SHMS Installation: Sensor network for crack widths, deflections, strains, accelerations'}
• Periodic Re-assessment: Biannual inspections initially, annual detailed assessment per IS 13935
• Documentation: Maintain structural health records, repair logs, testing reports

Add blank line between timeline sections.]

6. CONCLUSION
[Write 4-5 conclusive paragraphs (each 5-6 sentences):

Paragraph 1: Final structural health status summary with overall rating (Good/Fair/Poor), confidence level, basis for assessment.

Paragraph 2: Most critical findings requiring immediate attention, safety implications if unaddressed, urgency justification.

Paragraph 3: Service life prognosis - with timely intervention (expected lifespan), without intervention (risks and timeline), cost-benefit of proactive measures.

Paragraph 4: Professional recommendation for comprehensive IS 13935:2009 detailed assessment by licensed structural engineer, importance of specialized testing${actualResponses.q13_expert_intervention_has === 'Yes' ? ', acknowledgment of client request for ' + (Array.isArray(actualResponses.q13_expert_intervention_types) ? actualResponses.q13_expert_intervention_types[0] : 'expert services') + ' and suggested next steps' : ''}.

Paragraph 5: Disclaimer - preliminary assessment based on visual inspection and provided data, limitations, need for detailed investigation, engineer liability limitations.

Add blank line between paragraphs.]

FORMATTING REQUIREMENTS FOR READABILITY:
• Start each main section with its number and name on a new line: "1. OVERVIEW"
• Add TWO blank lines before each main section (except the first)
• Use subsection headers with ** formatting: **Header Name:**
• Add ONE blank line before each subsection
• Use bullet points (• or -) for lists with proper indentation
• Write paragraphs with 5-8 sentences each
• Add ONE blank line between paragraphs
• Add ONE blank line between different risk categories
• Total report should be 5000-7000 words for comprehensive coverage
• Base everything on the actual building data provided above`;



      try {
        const response = await axios.post(
          GROQ_API_URL,
          {
            model: GROQ_MODEL,
            messages: [
              {
                role: 'system',
                content: 'You are a Licensed Professional Structural Engineer. Generate detailed building assessment reports using EXACTLY these 6 section headings in order: 1. OVERVIEW, 2. KEY OBSERVATIONS, 3. RISK SUMMARY, 4. TECHNICAL ASSESSMENT, 5. RECOMMENDATIONS, 6. CONCLUSION. Each section must start with its number and name. Write comprehensive, technical content with subsections, bullet points and  detailed paragraphs. Include IS code references and specific recommendations.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.7,
            max_tokens: 8000,
            top_p: 0.9
          },
          {
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 60000
          }
        );
        reportText = response.data.choices?.[0]?.message?.content;
        console.log('✅ GROQ API generated report successfully');
        console.log('  - Report length:', reportText?.length || 0, 'characters');
      } catch (error) {
        console.error('❌ GROQ API failed:', error.message);
        reportText = generateMockReport(user_details, assessment_responses);
        usedMock = true;
      }
    } else {
      console.log('⚠️ No GROQ API key, using mock report');
      reportText = generateMockReport(user_details, assessment_responses);
      usedMock = true;
    }

    if (!reportText || reportText.length < 100) {
      throw new Error('Failed to generate valid report text');
    }

    // Create PDF using PDFKit
    const doc = new PDFDocument({ 
      size: 'A4', 
      margins: { top: 50, bottom: 70, left: 60, right: 60 },
      bufferPages: true,
      autoFirstPage: false
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Building_Assessment_Report.pdf"');
    doc.pipe(res);

    // Ensure a page exists before reading dimensions (autoFirstPage is false)
    doc.addPage();

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const leftMargin = 60;
    const rightMargin = pageWidth - 60;
    const centerX = pageWidth / 2;

    // Try to load logo from multiple possible locations
    let logoPath = path.join(__dirname, '..', 'frontend', 'public', 'Made with insMind-sppl-logo.png');
    if (!fs.existsSync(logoPath)) {
      logoPath = path.join(__dirname, 'public', 'Made with insMind-sppl-logo.png');
    }
    if (!fs.existsSync(logoPath)) {
      logoPath = path.join(__dirname, 'public', 'img', 'sppl-logo.png');
    }
    if (!fs.existsSync(logoPath)) {
      logoPath = path.join(__dirname, 'public', 'logo', 'sppl-logo.png');
    }
    const logoExists = fs.existsSync(logoPath);

    // Draw logo at the top center with proper sizing and positioning
    let currentY = 60;
    if (logoExists) {
      try {
        // Get image dimensions and scale proportionally
        const logoWidth = 140;
        const logoHeight = 48;
        const logoX = (pageWidth - logoWidth) / 2;
        doc.image(logoPath, logoX, currentY, { 
          fit: [logoWidth, logoHeight],
          align: 'center',
          valign: 'top'
        });
        currentY += logoHeight + 25;
      } catch (e) {
        console.error('Logo load failed:', e.message);
        currentY += 20;
      }
    } else {
      console.log('Logo not found, skipping');
      currentY += 20;
    }

    // Company name centered
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#000000');
    doc.text('Sanrachna Prahari Pvt Ltd', leftMargin, currentY, { width: rightMargin - leftMargin, align: 'center' });
    currentY += 28;
    
    doc.font('Helvetica').fontSize(11).fillColor('#666666');
    doc.text('(An IIT Delhi Incubated Company)', leftMargin, currentY, { width: rightMargin - leftMargin, align: 'center' });
    currentY += 35;

    // Separator line
    doc.strokeColor('#003366').lineWidth(2.5);
    doc.moveTo(leftMargin, currentY).lineTo(rightMargin, currentY).stroke();
    currentY += 35;

    // Report Title
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#003366');
    doc.text('PRELIMINARY ASSESSMENT REPORT', leftMargin, currentY, { width: rightMargin - leftMargin, align: 'center' });
    currentY += 60;

    // Clean markdown from report
    const cleaned = String(reportText || '')
      .replace(/\r/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/_(.+?)_/g, '$1');

    const lines = cleaned.split(/\n/);
    let inList = false;
    doc.y = currentY;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = String(raw || '').trim();
      
      if (!line) {
        if (inList) { 
          doc.moveDown(0.5); 
          inList = false; 
        }
        continue;
      }

      // Check for page overflow
      if (doc.y > pageHeight - 100) {
        doc.addPage();
        doc.y = 80;
      }

      // Section header
      const sectionMatch = line.match(/^(\d+)\.\s+(.+)$/);
      if (sectionMatch) {
        if (inList) { doc.moveDown(0.4); inList = false; }
        
        // Ensure enough space for section header
        if (doc.y > pageHeight - 200) {
          doc.addPage();
          doc.y = 80;
        } else {
          doc.moveDown(1.5);
        }
        
        const sectionY = doc.y;
        const sectionHeight = 32;
        
        // Draw modern section header with dark blue background
        doc.rect(leftMargin - 10, sectionY - 8, rightMargin - leftMargin + 20, sectionHeight)
           .fillAndStroke('#003366', '#003366');
        
        // White section number box
        doc.save();
        doc.rect(leftMargin - 7, sectionY - 5, 32, sectionHeight - 6).fill('#ffffff');
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#003366');
        doc.text(sectionMatch[1], leftMargin - 7, sectionY, { width: 32, align: 'center' });
        doc.restore();
        
        // Section title in white
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff');
        doc.text(sectionMatch[2].toUpperCase(), leftMargin + 30, sectionY + 3);
        
        doc.y = sectionY + sectionHeight + 8;
        continue;
      }

      // Subsection header (ends with colon)
      if (line.endsWith(':') && line.length < 120 && !line.startsWith('-') && !line.startsWith('•')) {
        if (inList) { doc.moveDown(0.4); inList = false; }
        
        if (doc.y > pageHeight - 100) {
          doc.addPage();
          doc.y = 80;
        }
        
        doc.moveDown(0.5);
        const subY = doc.y;
        
        // Draw accent bar
        doc.save();
        doc.fillColor('#003366');
        doc.rect(leftMargin - 18, subY, 10, 18).fill();
        doc.restore();
        
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#003366');
        doc.text(line, leftMargin, subY, { width: rightMargin - leftMargin, align: 'left', lineGap: 4 });
        doc.moveDown(0.6);
        continue;
      }

      // Bullet point
      if (/^[-•]/.test(line)) {
        const bulletText = line.replace(/^[-•]\s*/, '');
        
        if (doc.y > pageHeight - 100) {
          doc.addPage();
          doc.y = 80;
        }
        
        const startY = doc.y;
        const bulletX = leftMargin + 6;
        const textX = leftMargin + 22;
        const availableWidth = rightMargin - textX;
        
        // Draw bullet
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#003366');
        doc.text('•', bulletX, startY);
        
        // Parse markdown bold in bullet text
        const boldPattern = /\*\*([^*]+)\*\*/g;
        if (boldPattern.test(bulletText)) {
          boldPattern.lastIndex = 0;
          let lastIndex = 0;
          let match;
          
          doc.x = textX;
          doc.y = startY;
          
          while ((match = boldPattern.exec(bulletText)) !== null) {
            // Regular text before bold
            if (match.index > lastIndex) {
              const regularText = bulletText.substring(lastIndex, match.index);
              doc.font('Helvetica').fontSize(10.5).fillColor('#333333');
              doc.text(regularText, { continued: true, width: availableWidth, lineGap: 5 });
            }
            
            // Bold text
            doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#1a1a1a');
            doc.text(match[1], { continued: true });
            
            lastIndex = match.index + match[0].length;
          }
          
          // Remaining text
          if (lastIndex < bulletText.length) {
            const remainingText = bulletText.substring(lastIndex);
            doc.font('Helvetica').fontSize(10.5).fillColor('#333333');
            doc.text(remainingText, { width: availableWidth, lineGap: 5 });
          } else {
            doc.text('');
          }
        } else {
          // Original logic for text with colon
          const colonIndex = bulletText.indexOf(':');
          if (colonIndex > 0 && colonIndex < 80) {
            const boldPart = bulletText.substring(0, colonIndex + 1);
            const restPart = bulletText.substring(colonIndex + 1).trim();
            doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#1a1a1a');
            doc.text(boldPart, textX, startY, { continued: true });
            doc.font('Helvetica').fontSize(10.5).fillColor('#333333');
            doc.text(' ' + restPart, { width: availableWidth, lineGap: 5 });
          } else {
            doc.font('Helvetica').fontSize(10.5).fillColor('#333333');
            doc.text(bulletText, textX, startY, { width: availableWidth, lineGap: 5 });
          }
        }
        
        inList = true;
        doc.moveDown(0.4);
        continue;
      }

      // Regular paragraph
      if (inList) { doc.moveDown(0.4); inList = false; }
      
      if (doc.y > pageHeight - 100) {
        doc.addPage();
        doc.y = 80;
      }
      
      // Parse markdown bold text (**text**)
      const boldPattern = /\*\*([^*]+)\*\*/g;
      if (boldPattern.test(line)) {
        // Reset regex
        boldPattern.lastIndex = 0;
        
        const startY = doc.y;
        let lastIndex = 0;
        let match;
        
        while ((match = boldPattern.exec(line)) !== null) {
          // Regular text before bold
          if (match.index > lastIndex) {
            const regularText = line.substring(lastIndex, match.index);
            doc.font('Helvetica').fontSize(10.5).fillColor('#2a2a2a');
            doc.text(regularText, { continued: true, width: rightMargin - leftMargin, lineGap: 6 });
          }
          
          // Bold text
          doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#1a1a1a');
          doc.text(match[1], { continued: true });
          
          lastIndex = match.index + match[0].length;
        }
        
        // Remaining regular text after last bold
        if (lastIndex < line.length) {
          const remainingText = line.substring(lastIndex);
          doc.font('Helvetica').fontSize(10.5).fillColor('#2a2a2a');
          doc.text(remainingText, { width: rightMargin - leftMargin, lineGap: 6 });
        } else {
          // End the text flow
          doc.text('');
        }
        
        doc.moveDown(0.5);
      } else {
        // No bold formatting
        doc.font('Helvetica').fontSize(10.5).fillColor('#2a2a2a');
        doc.text(line, leftMargin, doc.y, { 
          width: rightMargin - leftMargin, 
          align: 'justify', 
          lineGap: 6 
        });
        doc.moveDown(0.5);
      }
    }

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error && error.stack ? error.stack : error);
    res.status(500).json({ error: 'Failed to generate PDF', details: error && error.stack ? error.stack : error.message });
  }
});

// ========================================
// TUNNEL ASSESSMENT ENDPOINTS
// ========================================

// Generate tunnel health report using GROQ API
app.post('/api/generate-tunnel-report', async (req, res) => {
  try {
    console.log('Incoming /api/generate-tunnel-report body keys:', Object.keys(req.body || {}));
    const user_details = req.body.user_details || req.body.userDetails || {};
    const assessment_responses = req.body.assessment_responses || req.body.assessmentResponses;

    if (!assessment_responses) {
      return res.status(400).json({ error: 'Missing assessment responses' });
    }

    // Unwrap the raw responses if they are wrapped
    const actualResponses = assessment_responses.raw_responses || assessment_responses;

    let report;
    let usedMock = false;
    let groqDebug = null;

    // Use GROQ API if key is available
    if (GROQ_API_KEY) {
      console.log('Using GROQ API for tunnel report generation...');
      console.log('📊 Tunnel Data Sample:');
      console.log('  - Age Range:', actualResponses.q1_ageRange);
      console.log('  - Location:', actualResponses.q1_city, actualResponses.q1_state);
      console.log('  - Tunnel Length:', actualResponses.q1_tunnel_length);
      console.log('  - Construction Method:', actualResponses.q2a_construction_method);
      console.log('  - Lining System:', actualResponses.q2c_lining_system);
      
      // Build comprehensive tunnel data string
      const formatValue = (val) => {
        if (val === null || val === undefined || val === '') return 'Not specified';
        if (Array.isArray(val)) return val.length > 0 ? val.join(', ') : 'Not specified';
        return String(val);
      };

      // Get all tunnel response keys
      const allKeys = Object.keys(actualResponses).sort();
      const relevantResponsesFormatted = allKeys.map(key => {
        const value = actualResponses[key];
        if (value === null || value === undefined || value === '') return null;
        return `${key}: ${formatValue(value)}`;
      }).filter(Boolean).join('\n');

      console.log('📊 Total tunnel response keys sent to AI:', allKeys.length);

      // Build simpler, focused tunnel data for faster API response
      const tunnelSummary = `
TUNNEL BASIC INFORMATION:
- Age: ${formatValue(actualResponses.q1_ageRange)}
- Start Location: ${formatValue(actualResponses.q1_city)}, ${formatValue(actualResponses.q1_state)}
- End Location: ${formatValue(actualResponses.q1_end_city)}, ${formatValue(actualResponses.q1_end_state)}
- Passes Through: ${formatValue(actualResponses.q1_passes)}
- Tunnel Length: ${formatValue(actualResponses.q1_tunnel_length)} km
- Construction Method: ${formatValue(actualResponses.q2a_construction_method)}
- Cross-Section: ${formatValue(actualResponses.q2b_cross_section)}
- Lining System: ${formatValue(actualResponses.q2c_lining_system)}
- Primary Usage: ${formatValue(actualResponses.q3_usage)}
- Modifications Done: ${actualResponses.q4_additions_has === 'Yes' ? 'YES - ' + formatValue(actualResponses.q4_additions_types) : 'None'}
- Heavy Machinery: ${formatValue(actualResponses.q4_heavy_machinery)}

GEOLOGICAL & ENVIRONMENTAL CONDITIONS:
- Ground Condition: ${formatValue(actualResponses.q5_ground_condition)}
- Elevation: ${formatValue(actualResponses.q5_elevation)}
- Environmental Exposure: ${formatValue(actualResponses.q6_environmental_exposure)}

STRUCTURAL DISTRESS & DETERIORATION:
- Cracks in Lining: ${actualResponses.q7_has_cracks === 'Yes' ? 'YES - Elements: ' + formatValue(actualResponses.q7_crack_elements) + ', Orientations: ' + formatValue(actualResponses.q7_crack_orientations) + ', Criticality: ' + formatValue(actualResponses.q7_criticality) : 'None observed'}
- Deformation/Instability: ${actualResponses.q7b_has_deformation === 'Yes' ? 'YES - ' + formatValue(actualResponses.q7b_deformation_types) : 'None observed'}
- Segment Joint Issues: ${actualResponses.q7c_has_joint_issues === 'Yes' ? 'YES - ' + formatValue(actualResponses.q7c_joint_issues) : 'None observed'}
- Connection Bolts: ${actualResponses.q7d_bolts_visible === 'Yes' ? 'Visible - Condition: ' + formatValue(actualResponses.q7d_bolts_condition) + ', Severity: ' + formatValue(actualResponses.q7d_bolts_severity) : 'Not visible'}
- Material Deterioration: ${actualResponses.q8_has_deterioration === 'Yes' ? 'YES - Locations: ' + formatValue(actualResponses.q8_deterioration_locations) + ', Types: ' + formatValue(actualResponses.q8_deterioration_types) + ', Severity: ' + formatValue(actualResponses.q8_deterioration_severity) : 'None observed'}

WATER INGRESS & SEEPAGE:
- Water Seepage: ${actualResponses.q9_has_seepage === 'Yes' ? 'YES - Locations: ' + formatValue(actualResponses.q9_seepage_locations) + ', Conditions: ' + formatValue(actualResponses.q9_seepage_conditions) + ', Paths: ' + formatValue(actualResponses.q9_seepage_paths) + ', Indicators: ' + formatValue(actualResponses.q9_visible_indicators) : 'None observed'}

REINFORCEMENT & CORROSION:
- Exposed Reinforcement: ${actualResponses.q10_has_reinf === 'Yes' ? 'YES - Locations: ' + formatValue(actualResponses.q10_reinf_locations) + ', Conditions: ' + formatValue(actualResponses.q10_reinf_conditions) : 'None observed'}

GASKET & JOINT DEFECTS:
- Gasket Defects: ${actualResponses.q11_has_gasket_defects === 'Yes' ? 'YES - Types: ' + formatValue(actualResponses.q11_defect_types) + ', Locations: ' + formatValue(actualResponses.q11_defect_locations) : 'None observed'}

ROCK BOLTS & ANCHORS:
- Rock Bolts Condition: ${actualResponses.q12_has_bolt_issues === 'Yes' ? 'Issues detected - ' + formatValue(actualResponses.q12_bolt_issues) : 'Good condition'}

GROUTING & VOIDS:
- Grouting Issues: ${actualResponses.q13_has_grout_issues === 'Yes' ? 'YES - ' + formatValue(actualResponses.q13_grout_observations) : 'None observed'}

FIRE DAMAGE:
- Fire Damage: ${actualResponses.q14_has_fire_damage === 'Yes' ? 'YES - Severity: ' + formatValue(actualResponses.q14_fire_severity) + ', Locations: ' + formatValue(actualResponses.q14_fire_locations) : 'None observed'}

VENTILATION & AIR QUALITY:
- Ventilation: ${actualResponses.q15_has_vent_issues === 'Yes' ? 'Issues present - ' + formatValue(actualResponses.q15_vent_observations) : 'Adequate'}

DRAINAGE SYSTEM:
- Drainage Issues: ${actualResponses.q16_has_drainage_issues === 'Yes' ? 'YES - ' + formatValue(actualResponses.q16_drainage_observations) : 'Functioning properly'}

NATURAL DISASTERS:
- Disaster History: ${actualResponses.q17_has_disaster === 'Yes' ? 'YES - ' + formatValue(actualResponses.q17_disaster_types) : 'None recorded'}

EXPERT INTERVENTION:
- Previous Interventions: ${actualResponses.q18_has_intervention === 'Yes' ? 'YES - ' + formatValue(actualResponses.q18_intervention_types) : 'None'}
`;

      const prompt = 'Generate a professional tunnel assessment report for this ' + (actualResponses.q1_ageRange || 'existing') + ' tunnel.\n\n' +
        tunnelSummary + '\n\n' +
        'Create a detailed technical report with these exact sections:\n\n' +
        '1. OVERVIEW\n' +
        'Summarize the tunnel (age ' + (actualResponses.q1_ageRange || 'unknown') + ', length ' + (actualResponses.q1_tunnel_length || 'unspecified') + 'km, location from ' + (actualResponses.q1_city || '') + ', ' + (actualResponses.q1_state || '') + ' to ' + (actualResponses.q1_end_city || '') + ', ' + (actualResponses.q1_end_state || '') + ', construction method ' + (actualResponses.q2a_construction_method || 'unspecified') + ', lining system ' + (actualResponses.q2c_lining_system || 'unspecified') + ', primary usage ' + (actualResponses.q3_usage || 'unspecified') + '), key findings and overall health rating.\n\n' +
        '2. KEY OBSERVATIONS\n' +
        'Detail ALL observed issues based on the data above:\n' +
        '- Structural distress (cracks, deformation, joint issues, bolt condition)\n' +
        '- Material deterioration (spalling, scaling, weathering)\n' +
        '- Water seepage (locations, conditions, severity)\n' +
        '- Reinforcement exposure and corrosion\n' +
        '- Gasket and joint defects\n' +
        '- Rock bolts and anchor condition\n' +
        '- Grouting issues and voids\n' +
        '- Fire damage (if any)\n' +
        '- Ventilation and drainage issues\n' +
        '- Impact of natural disasters (if any)\n' +
        'Be specific about locations, orientations and severity levels from the data.\n\n' +
        '3. RISK SUMMARY\n' +
        'Categorize ALL findings into:\n' +
        '- CRITICAL/HIGH RISK: Immediate safety issues requiring action within 0-1 month\n' +
        '- MEDIUM RISK: Progressive deterioration requiring attention within 1-6 months\n' +
        '- LOW RISK: Routine maintenance issues (6-24 months)\n' +
        'Base this entirely on the observations listed above.\n\n' +
        '4. TECHNICAL ASSESSMENT\n' +
        'Analyze:\n' +
        '- Structural integrity (lining, joints, connections, deformation)\n' +
        '- Lining performance (' + (actualResponses.q2c_lining_system || 'specified') + ' system condition)\n' +
        '- Water management (seepage patterns, drainage system)\n' +
        '- Geological conditions and ground stability\n' +
        '- Fire safety and ventilation\n' +
        '- Construction quality and modifications\n' +
        'Reference specific data points from the assessment.\n\n' +
        '5. RECOMMENDATIONS\n' +
        'Provide actionable recommendations by timeline based on observed issues:\n' +
        '- IMMEDIATE (0-3 months): Safety measures, urgent repairs for critical issues\n' +
        '- SHORT-TERM (3-12 months): Structural repairs, waterproofing, joint repairs\n' +
        '- LONG-TERM (1-5 years): Monitoring systems, preventive maintenance, upgrade plans\n' +
        'Be specific to THIS tunnel\'s observed conditions.\n\n' +
        '6. CONCLUSION\n' +
        'Final assessment, critical actions needed, service life prognosis and need for detailed investigation. Reference the ' + (actualResponses.q1_tunnel_length || 'specified') + 'km tunnel\'s specific issues.\n\n' +
        'Write detailed, technical content (4000-5000 words total). Use ONLY the data provided above. Be specific to this ' + (actualResponses.q1_ageRange || 'existing') + ' year old ' + (actualResponses.q2c_lining_system || 'tunnel') + ' tunnel.';

      try {
        console.log('🔄 Calling GROQ API...');
        console.log('📊 Request details:');
        console.log('  - Model:', GROQ_MODEL);
        console.log('  - Prompt length:', prompt.length, 'characters');
        console.log('  - Max tokens: 8000');
        console.log('  - Timeout: 60 seconds');
        
        const startTime = Date.now();
        
        const response = await axios.post(
          GROQ_API_URL,
          {
            model: GROQ_MODEL,
            messages: [
              {
                role: 'system',
                content: 'You are a Professional Tunnel Engineer. Generate comprehensive tunnel assessment reports with 6 sections: OVERVIEW, KEY OBSERVATIONS, RISK SUMMARY, TECHNICAL ASSESSMENT, RECOMMENDATIONS, CONCLUSION. Write 4000-5000 words with technical detail.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.7,
            max_tokens: 8000,
            top_p: 0.95
          },
          {
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 90000  // Increased to 90 seconds
          }
        );

        const elapsed = Date.now() - startTime;
        console.log('✅ GROQ API responded in', elapsed, 'ms');

        report = response.data.choices?.[0]?.message?.content;

        if (!report) {
          groqDebug = response.data;
          console.warn('⚠️ GROQ returned unexpected response for tunnel, using fallback');
          console.warn('Response data:', JSON.stringify(response.data).substring(0, 500));
          report = generateMockTunnelReport(user_details, assessment_responses);
          usedMock = true;
        } else {
          console.log('✅ GROQ generated report, length:', report.length, 'characters');
        }
      } catch (groqError) {
        console.error('❌ GROQ API call failed for tunnel:');
        console.error('  - Error type:', groqError.code || groqError.name || 'Unknown');
        console.error('  - Message:', groqError.message);
        if (groqError.code === 'ECONNABORTED') {
          console.error('  - Cause: Request timeout (90 seconds exceeded)');
          console.error('  - Solution: Try using smaller model or reduce prompt complexity');
        }
        if (groqError.response) {
          console.error('  - HTTP Status:', groqError.response.status);
          console.error('  - Response data:', JSON.stringify(groqError.response.data).substring(0, 500));
          groqDebug = groqError.response.data;
        } else {
          console.error('  - No HTTP response received');
          groqDebug = { error: groqError.message, code: groqError.code };
        }
        console.log('🔄 Falling back to mock tunnel report...');
        report = generateMockTunnelReport(user_details, assessment_responses);
        usedMock = true;
      }
    } else {
      console.log('GROQ API key not configured. Using mock tunnel report...');
      report = generateMockTunnelReport(user_details, assessment_responses);
      usedMock = true;
    }

    const source = usedMock ? 'Mock (fallback)' : (GROQ_API_KEY ? 'GROQ API' : 'Mock Generator');
    const resp = {
      success: true,
      report: report,
      timestamp: new Date().toISOString(),
      source
    };

    if (usedMock && groqDebug) {
      resp.groq_debug = groqDebug;
    }

    // Notify admins via email (office@spplindia.org & raj-it@spplindia.org)
    notifyAdminOnAssessmentSubmission(
      user_details,
      'Tunnel Assessment',
      report,
      null,
      req.body.assessmentId || ('TUNNEL_' + Date.now())
    );

    res.json(resp);
    console.log('✅ [generate-tunnel-report] Response sent successfully');

  } catch (error) {
    console.error('Error generating tunnel report:', error.message);
    res.status(500).json({
      error: 'Error generating tunnel report',
      details: error.message
    });
  }
});

// Generate mock tunnel report (fallback)
function generateMockTunnelReport(user_details, assessment_responses) {
  const actualResponses = assessment_responses.raw_responses || assessment_responses;
  
  const tunnelAge = actualResponses.q1_ageRange || 'Unknown';
  const tunnelLength = actualResponses.q1_tunnel_length || 'Not specified';
  const location = actualResponses.q1_city || 'Not specified';
  const liningSystem = actualResponses.q2c_lining_system || 'Not specified';
  const constructionMethod = actualResponses.q2a_construction_method || 'Not specified';
  
  return `PRELIMINARY TUNNEL ASSESSMENT REPORT
Generated: ${new Date().toLocaleDateString('en-IN')}
Assessed by: Licensed Tunnel Engineer

1. OVERVIEW
This ${tunnelAge}-year-old tunnel with ${tunnelLength} km length located in ${location} has been assessed through a preliminary questionnaire-based evaluation. The tunnel was constructed using ${constructionMethod} with ${liningSystem} lining system. Overall structural health requires detailed on-site investigation. Immediate professional detailed assessment is recommended as per relevant tunnel safety standards.

2. KEY OBSERVATIONS
The following conditions have been identified during the preliminary assessment:

• Lining Condition: ${liningSystem} showing signs of ${actualResponses.q6_rcc_has_cracks === 'Yes' ? 'cracking and structural distress' : 'age-related wear'}
• Water Ingress: ${actualResponses.q9_has_seepage === 'Yes' ? 'Seepage and water leakage observed requiring immediate drainage assessment' : 'No significant water ingress reported'}
• Material Deterioration: ${actualResponses.q8_has_deterioration === 'Yes' ? 'Concrete deterioration requiring repair' : 'Material condition requires monitoring'}
• Reinforcement: ${actualResponses.q10_has_reinf === 'Yes' ? 'Exposed reinforcement with corrosion signs' : 'No exposed reinforcement reported'}

3. RISK SUMMARY
Based on preliminary data, recommend immediate detailed investigation to establish actual tunnel condition, safety margins and repair requirements.

4. TECHNICAL ASSESSMENT
Comprehensive tunnel inspection with Ground Penetrating Radar, ultrasonic testing and structural analysis required to determine load-carrying capacity and safety factors.

5. RECOMMENDATIONS
• Immediate: Commission detailed tunnel investigation with NDT methods
• Short-term: Execute repairs based on detailed findings
• Long-term: Establish monitoring program and preventive maintenance schedule

6. CONCLUSION
Detailed professional assessment required to determine actual structural condition and safety. This preliminary report provides initial guidance only.

Disclaimer: This preliminary assessment is based on questionnaire responses. Actual tunnel condition must be determined through on-site investigation by qualified tunnel engineer.`;
}

// Tunnel PDF generation endpoint
app.post('/api/generate-tunnel-report-pdf', async (req, res) => {
  try {
    const user_details = req.body.user_details || req.body.userDetails || {};
    const assessment_responses = req.body.assessment_responses || req.body.assessmentResponses;
    let reportText = req.body.reportText || req.body.report_text || undefined;

    if (!assessment_responses && !reportText) {
      return res.status(400).json({ error: 'Missing assessment responses or reportText' });
    }

    const actualResponses = (assessment_responses && (assessment_responses.raw_responses || assessment_responses)) || {};

    console.log('📄 Generating tunnel AI report and/or PDF...');
    let usedMock = false;

    if (reportText) {
      console.log('Using provided reportText for tunnel PDF generation.');
    } else if (GROQ_API_KEY) {
      console.log('🤖 Using GROQ API to generate comprehensive tunnel report...');
      
      try {
        const response = await axios.post(
          `http://localhost:${process.env.PORT || 5000}/api/generate-tunnel-report`,
          {
            user_details,
            assessment_responses
          },
          { timeout: 60000 }
        );
        reportText = response.data.report;
        console.log('✅ GROQ API generated tunnel report successfully');
      } catch (error) {
        console.error('❌ GROQ API failed for tunnel:', error.message);
        reportText = generateMockTunnelReport(user_details, assessment_responses);
        usedMock = true;
      }
    } else {
      console.log('⚠️ No GROQ API key, using mock tunnel report');
      reportText = generateMockTunnelReport(user_details, assessment_responses);
      usedMock = true;
    }

    if (!reportText || reportText.length < 100) {
      throw new Error('Failed to generate valid tunnel report text');
    }

    // Generate PDF using same PDFKit logic as building assessment
    const pdfBuffer = await generatePdfBufferFromReport(reportText, user_details);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Tunnel_Assessment_Report.pdf"');
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Tunnel PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate tunnel PDF', details: error.message });
  }
});

// Submit tunnel assessment: generate AI report, PDF, upload to Cloudinary, save to DB
app.post('/api/submit-tunnel-assessment', async (req, res) => {
  try {
    console.log('🔵 [submit-tunnel-assessment] Starting tunnel submission...');
    
    const { userDetails, assessmentResponses } = req.body;

    if (!userDetails || !userDetails.email || !userDetails.name) {
      return res.status(400).json({ error: 'Missing required user details' });
    }

    if (!assessmentResponses) {
      return res.status(400).json({ error: 'Missing assessment responses' });
    }

    const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
    let reportText = '';

    // Generate comprehensive AI report on server
    try {
      console.log('⏳ [submit-tunnel-assessment] Generating comprehensive tunnel AI report...');
      const genRes = await axios.post(`${baseUrl}/api/generate-tunnel-report`, {
        user_details: userDetails,
        assessment_responses: assessmentResponses
      }, { timeout: 120000 });

      if (genRes && genRes.data && genRes.data.report) {
        reportText = genRes.data.report;
        console.log('✅ [submit-tunnel-assessment] Server generated report length:', reportText.length);
      } else {
        console.warn('⚠️ [submit-tunnel-assessment] generate-tunnel-report returned no report');
      }
    } catch (err) {
      console.error('❌ [submit-tunnel-assessment] GROQ tunnel report generation failed:', err.message);
    }

    // Generate PDF from report
    let pdfBuf = null;
    try {
      console.log('🔄 [submit-tunnel-assessment] Generating tunnel PDF...');
      console.log('  - Report text length:', reportText ? reportText.length : 0, 'characters');
      console.log('  - Calling /api/generate-tunnel-report-pdf endpoint...');
      
      const pdfRes = await axios.post(`${baseUrl}/api/generate-tunnel-report-pdf`, {
        user_details: userDetails,
        assessment_responses: assessmentResponses,
        reportText: reportText
      }, { responseType: 'arraybuffer', timeout: 60000 });

      console.log('📊 [submit-tunnel-assessment] PDF endpoint response:');
      console.log('  - Status:', pdfRes.status);
      console.log('  - Data type:', typeof pdfRes.data);
      console.log('  - Data length:', pdfRes.data ? pdfRes.data.length : 0);

      if (pdfRes && pdfRes.data) {
        pdfBuf = Buffer.from(pdfRes.data);
        console.log('✅ [submit-tunnel-assessment] PDF generated, size:', pdfBuf.length, 'bytes');
      } else {
        console.warn('⚠️ [submit-tunnel-assessment] PDF response empty');
      }
    } catch (err) {
      console.error('❌ [submit-tunnel-assessment] PDF generation failed:');
      console.error('  - Error message:', err.message);
      if (err.response) {
        console.error('  - HTTP Status:', err.response.status);
        console.error('  - Response data:', err.response.data);
      }
    }

    // Upload PDF to Cloudinary if available
    let cloudinaryUrl = null;
    let cloudinaryPublicId = null;
    
    console.log('🔍 [submit-tunnel-assessment] Cloudinary check:');
    console.log('  - CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME ? 'Set' : 'NOT SET');
    console.log('  - PDF Buffer:', pdfBuf ? `${pdfBuf.length} bytes` : 'NULL');
    
    if (process.env.CLOUDINARY_CLOUD_NAME && pdfBuf) {
      try {
        const publicId = `tunnel_report_${Date.now()}_${userDetails.name.replace(/\s+/g, '_')}`;
        console.log('⬆️ [submit-tunnel-assessment] Uploading PDF to Cloudinary...');
        console.log('  - Public ID:', publicId);
        console.log('  - PDF size:', pdfBuf.length, 'bytes');
        
        const uploadResult = await cloudinaryService.uploadPdfBuffer(pdfBuf, publicId);
        
        console.log('📊 [submit-tunnel-assessment] Cloudinary upload result:', uploadResult ? 'Received' : 'NULL');
        if (uploadResult) {
          console.log('  - secure_url:', uploadResult.secure_url);
          console.log('  - public_id:', uploadResult.public_id);
        }
        
        if (uploadResult && uploadResult.secure_url) {
          cloudinaryUrl = uploadResult.secure_url;
          cloudinaryPublicId = uploadResult.public_id;
          console.log('✅ [submit-tunnel-assessment] Uploaded to Cloudinary:', cloudinaryUrl);
        } else {
          console.warn('⚠️ [submit-tunnel-assessment] Upload succeeded but no secure_url in result');
        }
      } catch (uploadErr) {
        console.error('❌ [submit-tunnel-assessment] Cloudinary upload failed:');
        console.error('  - Error message:', uploadErr.message);
        console.error('  - Error stack:', uploadErr.stack);
      }
    } else {
      console.warn('⚠️ [submit-tunnel-assessment] Skipping Cloudinary upload:');
      if (!process.env.CLOUDINARY_CLOUD_NAME) {
        console.warn('  - Reason: CLOUDINARY_CLOUD_NAME not configured');
      }
      if (!pdfBuf) {
        console.warn('  - Reason: PDF buffer is null (PDF generation failed)');
      }
    }

    // Save to database
    const rawResponses = assessmentResponses.raw_responses || assessmentResponses;
    const assessmentDoc = {
      userDetails: {
        name: userDetails.name,
        email: userDetails.email,
        phoneCountryCode: userDetails.phoneCountryCode || '+91',
        phone: userDetails.phone || '',
        organization: userDetails.organization || '',
        structureType: 'Tunnel',
        yearOfConstruction: null,
        location: rawResponses.q1_city || ''
      },
      assessmentResponses: assessmentResponses,
      responses: rawResponses,
      pdfData: pdfBuf ? {
        filename: `Tunnel_Assessment_${userDetails.name.replace(/\s+/g, '_')}_${Date.now()}.pdf`,
        contentType: 'application/pdf',
        size: pdfBuf.length,
        data: pdfBuf,
        generatedAt: getISTTimestamp(),
        cloudinaryPublicId,
        cloudinaryUrl
      } : undefined,
      reportText: reportText,
      assessmentType: 'Tunnel',
      status: 'completed'
    };

    console.log('🔵 [submit-tunnel-assessment] Saving to MongoDB...');
    const assessment = new Assessment(assessmentDoc);
    const saved = await assessment.save();
    console.log('✅ [submit-tunnel-assessment] Assessment saved:', saved._id);

    // Send client email
    try {
      await sendAssessmentCompletionEmail(userDetails, 'Tunnel', pdfBuf);
      console.log('✅ [submit-tunnel-assessment] Client email sent');
      await Assessment.findByIdAndUpdate(saved._id, { emailSent: true, emailSentAt: getISTTimestamp() });
    } catch (err) {
      console.error('❌ [submit-tunnel-assessment] Failed to send client email:', err.message);
    }

    res.status(200).json({
      success: true,
      message: 'Tunnel assessment submitted successfully',
      assessmentId: saved._id,
      cloudinaryUrl: cloudinaryUrl
    });

  } catch (error) {
    console.error('❌ [submit-tunnel-assessment] Error:', error.message);
    res.status(500).json({ error: 'Failed to submit tunnel assessment', details: error.message });
  }
});

// ========================================
// BRIDGE ASSESSMENT ENDPOINTS
// ========================================

// Generate bridge health report using GROQ API
app.post('/api/generate-bridge-report', reportLimiter, async (req, res) => {
  try {
    console.log('Incoming /api/generate-bridge-report body keys:', Object.keys(req.body || {}));
    const user_details = req.body.user_details || req.body.userDetails || {};
    const assessment_responses = req.body.assessment_responses || req.body.assessmentResponses;

    if (!assessment_responses) {
      return res.status(400).json({ error: 'Missing assessment responses' });
    }

    // Unwrap the raw responses if they are wrapped
    const actualResponses = assessment_responses.raw_responses || assessment_responses;

    let report;
    let usedMock = false;
    let groqDebug = null;

    // Use GROQ API if key is available
    if (GROQ_API_KEY) {
      console.log('Using GROQ API for bridge report generation...');
      console.log('📊 Bridge Data Sample:');
      console.log('  - Age Range:', actualResponses.q1_ageRange);
      console.log('  - Location:', actualResponses.q1_city, actualResponses.q1_state);
      console.log('  - Structural System:', actualResponses.q1_structural_system);
      console.log('  - Bridge Type:', actualResponses.q1_bridge_type);
      console.log('  - Usage:', actualResponses.q1_usage);
      
      // Build comprehensive bridge data string
      const formatValue = (val) => {
        if (val === null || val === undefined || val === '') return 'Not specified';
        if (Array.isArray(val)) return val.length > 0 ? val.join(', ') : 'Not specified';
        return String(val);
      };

      // Get all bridge response keys
      const allKeys = Object.keys(actualResponses).sort();
      console.log('📊 Total bridge response keys:', allKeys.length);

      // Extract all bridge data comprehensively
      const bridgeSummary = `
BRIDGE BASIC INFORMATION:
- Age: ${formatValue(actualResponses.q1_ageRange)}
- Location: ${formatValue(actualResponses.q1_city)}, ${formatValue(actualResponses.q1_state)}, ${formatValue(actualResponses.q1_country)}
- Structural System: ${formatValue(actualResponses.q1_structural_system)}
- Bridge Type: ${formatValue(actualResponses.q1_bridge_type)}
- Primary Usage/Function: ${formatValue(actualResponses.q1_usage)}
- Exposure Condition: ${formatValue(actualResponses.q3_exposure_type)}

LOADING CONDITION:
- Major Alterations: ${actualResponses.q2_alterations_has === 'Yes' ? 'YES - ' + formatValue(actualResponses.q2_alterations_types) : 'No major alterations'}

DECK CONDITION:
- Deck Defects: ${actualResponses.q4_deck_defects_has === 'Yes' ? 'YES - ' + formatValue(actualResponses.q4_deck_defects_types) : 'No deck defects'}

BEARING CONDITION:
- Bearing Issues: ${actualResponses.q5_bearing_issues_has === 'Yes' ? 'YES - ' + formatValue(actualResponses.q5_bearing_issues_types) + ' at ' + formatValue(actualResponses.q5_bearing_location) : 'No bearing issues'}
- Components - Restricted Movement: ${formatValue(actualResponses.q5_bearing_components_restricted_no_movement)}
- Components - Cracked: ${formatValue(actualResponses.q5_bearing_components_cracked)}
- Components - Corroded: ${formatValue(actualResponses.q5_bearing_components_corrosion)}
- Components - Misaligned: ${formatValue(actualResponses.q5_bearing_components_misalignment)}
- Components - Displaced: ${formatValue(actualResponses.q5_bearing_components_displacement)}

EXPANSION JOINTS:
- Joint Issues: ${actualResponses.q6_expansion_issues_has === 'Yes' ? 'YES - ' + formatValue(actualResponses.q6_expansion_issues_types) : 'No expansion joint issues'}

COMPOSITE STRUCTURE ASSESSMENT (Q6-Q15):
- Connections/Anchorage Issues: ${actualResponses.q6_composite_connections_has === 'Yes' ? 'YES - ' + formatValue(actualResponses.q6_composite_connections_types) : 'No connection issues'}
  → Gaps: ${formatValue(actualResponses.q6_composite_gaps_conditions)} at ${formatValue(actualResponses.q6_composite_gaps_locations)}
  → Bent Plates: ${formatValue(actualResponses.q6_composite_bent_plates_locations)}
  → Anchor Bolts: ${formatValue(actualResponses.q6_composite_anchor_locations)}

- Cracks in Elements: ${actualResponses.q7_composite_cracks_has === 'Yes' ? 'YES - Affected: ' + formatValue(actualResponses.q7_composite_cracks_elements) : 'No cracks observed'}
  → Deck Slab: ${formatValue(actualResponses.q7_composite_loc_deck_slab)} (${formatValue(actualResponses.q7_composite_deck_slab_orientations)})
  → Girders: ${formatValue(actualResponses.q7_composite_loc_steel_composite_girder)} (${formatValue(actualResponses.q7_composite_girder_orientations)})
  → Shear Connectors: ${formatValue(actualResponses.q7_composite_loc_shear_connectors)}
  → Diaphragms: ${formatValue(actualResponses.q7_composite_loc_diaphragms)}
  → Piers: ${formatValue(actualResponses.q7_composite_loc_pier)} (${formatValue(actualResponses.q7_composite_pier_orientations)})
  → Pier Caps: ${formatValue(actualResponses.q7_composite_loc_pier_cap)}
  → Abutments: ${formatValue(actualResponses.q7_composite_loc_abutment)}

- Deformation: ${actualResponses.q8_composite_deformation_has === 'Yes' ? 'YES - Types: ' + formatValue(actualResponses.q8_composite_deformation_types) : 'No deformation'}
  → Excessive Deflection in: ${formatValue(actualResponses.q8_composite_excessive_deflection_elements)}
  → Local Distortion in: ${formatValue(actualResponses.q8_composite_local_distortion_elements)}
  → Differential Movement in: ${formatValue(actualResponses.q8_composite_differential_elements)}
  → Gaps at Interfaces in: ${formatValue(actualResponses.q8_composite_gaps_interfaces)}
  → Global Tilt in: ${formatValue(actualResponses.q8_composite_global_tilt_elements)}

- Spalling: ${actualResponses.q9_composite_spalling_has === 'Yes' ? 'YES in ' + formatValue(actualResponses.q9_composite_spalling_elements) : 'No spalling'}

- Moisture Distress: ${actualResponses.q10_composite_moisture_has === 'Yes' ? 'YES' : 'No moisture issues'}
  → Damp Patches: ${actualResponses.q10a_composite_damp_has === 'Yes' ? formatValue(actualResponses.q10a_composite_damp_elements) : 'None'}
  → Efflorescence: ${actualResponses.q10b_composite_white_has === 'Yes' ? formatValue(actualResponses.q10b_composite_white_elements) : 'None'}
  → Algae/Moss: ${actualResponses.q10c_composite_green_has === 'Yes' ? formatValue(actualResponses.q10c_composite_green_elements) : 'None'}

- Corrosion in Steel: ${actualResponses.q11_composite_corrosion_has === 'Yes' ? 'YES in ' + formatValue(actualResponses.q11_composite_corrosion_elements) : 'No corrosion'}
  → Girders: ${formatValue(actualResponses.q11_composite_girder_locations)} (${formatValue(actualResponses.q11_composite_girder_characteristics)})
  → Shear Connectors: ${formatValue(actualResponses.q11_composite_shear_locations)} (${formatValue(actualResponses.q11_composite_shear_characteristics)})
  → Diaphragms: ${formatValue(actualResponses.q11_composite_diaphragm_locations)} (${formatValue(actualResponses.q11_composite_diaphragm_characteristics)})
  → Reinforcement: ${formatValue(actualResponses.q11_composite_reinforcement_locations)} (${formatValue(actualResponses.q11_composite_reinforcement_characteristics)})
  → Plates: ${formatValue(actualResponses.q11_composite_plates_locations)} (${formatValue(actualResponses.q11_composite_plates_characteristics)})

- Vibration During Traffic: ${actualResponses.q12a_composite_vibration_has === 'Yes' ? 'YES - Modes: ' + formatValue(actualResponses.q12a_composite_vibration_sources) + ' at ' + formatValue(actualResponses.q12a_composite_vibration_locations) : 'No vibration'}
  → Damping Devices: ${actualResponses.q12b_composite_recurring_has === 'Yes' ? 'Issues - ' + formatValue(actualResponses.q12b_composite_recurring_observations) : 'Functioning properly'}

- Foundation/Hydraulics: ${actualResponses.q13_composite_ground_issues_has === 'Yes' ? 'YES - ' + formatValue(actualResponses.q13_composite_ground_issues) : 'No issues'}
  → Scour around Piers: ${formatValue(actualResponses.q13_composite_scour_piers)}
  → Scour around Abutments: ${formatValue(actualResponses.q13_composite_scour_abutments)}
  → Erosion: ${formatValue(actualResponses.q13_composite_erosion)}
  → Debris: ${formatValue(actualResponses.q13_composite_debris)}

- Natural Disasters: ${actualResponses.q14_composite_disaster_has === 'Yes' ? 'YES - ' + formatValue(actualResponses.q14_composite_disaster_types) + (actualResponses.q14_composite_earthquake_intensity ? ', Intensity: ' + formatValue(actualResponses.q14_composite_earthquake_intensity) : '') : 'No disaster history'}

- Remedial Measures: ${actualResponses.q15_composite_expert_intervention_has === 'Yes' ? 'YES - ' + formatValue(actualResponses.q15_composite_expert_intervention_types) : 'No previous expert intervention'}
`;

      const prompt = `You are an expert BRIDGE ENGINEER specializing in bridge health assessment, structural integrity evaluation and bridge maintenance. 

███████████████████████████████████████████████████████████████████████
█ THIS IS A BRIDGE ASSESSMENT - NOT A BUILDING ASSESSMENT █
███████████████████████████████████████████████████████████████████████

STRUCTURE TYPE: ${actualResponses.q1_bridge_type || 'COMPOSITE BRIDGE'} (${actualResponses.q1_structural_system || 'COMPOSITE'})
USER: ${user_details.name || 'Not provided'} (${user_details.email || 'Not provided'})

❌ PROHIBITED TERMS - NEVER USE:
- "building", "RCC building", "structure building"
- "beams", "columns", "floors", "walls", "storeys"
- Building codes (IS 456 for buildings)
- Building-specific terms

✅ REQUIRED TERMS - ALWAYS USE:
- "BRIDGE" or "${actualResponses.q1_bridge_type || 'composite bridge'}"
- "deck slab", "composite deck", "bridge deck"
- "main girders", "steel girders", "composite girders"
- "piers", "pier caps", "abutments", "wing walls"
- "bearings", "bearing pads", "expansion joints"
- "shear connectors", "diaphragms"
- "scour", "hydraulic conditions", "riverbed"
- IRC/AASHTO codes for BRIDGES

BRIDGE ASSESSMENT DATA:
${bridgeSummary}

Generate a comprehensive technical BRIDGE ASSESSMENT REPORT with these 6 sections:

1. OVERVIEW
Start: "The BRIDGE in question is a ${actualResponses.q1_ageRange || 'age unknown'} old structure located in ${actualResponses.q1_city || 'location'}, ${actualResponses.q1_state || 'state'}."
NEVER say "building" - ALWAYS say "BRIDGE"
- Overall bridge health rating
- Urgency level
- Key bridge component findings (deck, girders, bearings, piers)
- Bridge-specific concerns (scour, bearings, expansion joints)

2. KEY OBSERVATIONS
Organize by BRIDGE COMPONENTS:
• Deck Slab Condition (cracks, delamination)
• Main Girders (deflection, corrosion, shear connectors)
• Bearings & Expansion Joints (seizure, leakage)
• Piers & Abutments (cracks, settlement)
• Hydraulic & Foundation (scour, erosion)
• Traffic-Induced Effects (vibration)

3. RISK SUMMARY
Bridge-specific risks:
- Deck failure (cracking, overload)
- Girder buckling/fatigue
- Bearing seizure
- Pier settlement/scour
- Expansion joint failure

4. TECHNICAL ASSESSMENT
Bridge engineering analysis:
• Load-carrying capacity (IRC 6/IRC 112)
• Live load rating (IRC Class AA/A)
• Seismic assessment (IS 1893 for bridges)
• Hydraulic & scour (IRC 78)
• Fatigue & dynamics (traffic cycles)
• Durability (deck carbonation, steel corrosion)

5. RECOMMENDATIONS
• Immediate: Load posting, NDT (deck GPR, girder ultrasonic)
• Short-term: Deck repair, bearing replacement, scour protection
• Long-term: Bridge inspections (IRC SP-35), protective coatings

6. CONCLUSION
- Overall BRIDGE condition
- Load rating and service life
- IRC/AASHTO compliance
- Inspection frequency

Write 4000-5000 words with detailed technical BRIDGE content. Add blank lines between sections.`;

      try {
        const chatCompletion = await groq.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: GROQ_MODEL,
          temperature: 0.7,
          max_tokens: 8000
        });

        report = chatCompletion.choices[0]?.message?.content || '';
        console.log('✅ GROQ API response received, length:', report.length, 'characters');
        groqDebug = {
          model: GROQ_MODEL,
          temperature: 0.7,
          max_tokens: 8000,
          prompt_length: prompt.length,
          response_length: report.length
        };

      } catch (error) {
        console.error('GROQ API error:', error.message);
        report = `PRELIMINARY BRIDGE ASSESSMENT REPORT

Name: ${user_details.name || 'Not provided'}
Email: ${user_details.email || 'Not provided'}

1. OVERVIEW
The BRIDGE in question is a ${formatValue(actualResponses.q1_ageRange)} old ${formatValue(actualResponses.q1_bridge_type)} structure located in ${formatValue(actualResponses.q1_city)}, ${formatValue(actualResponses.q1_state)}.

Overall Health Rating: Professional detailed assessment required
Urgency: Detailed inspection recommended

2. KEY OBSERVATIONS
• Structural System: ${formatValue(actualResponses.q1_structural_system)}
• Deck Condition: ${actualResponses.q4_deck_defects_has === 'Yes' ? 'Defects observed - ' + formatValue(actualResponses.q4_deck_defects_types) : 'No defects reported'}
• Bearing Status: ${actualResponses.q5_bearing_issues_has === 'Yes' ? 'Issues present - ' + formatValue(actualResponses.q5_bearing_issues_types) : 'Functioning normally'}
• Expansion Joints: ${actualResponses.q6_expansion_issues_has === 'Yes' ? 'Issues present' : 'Functioning normally'}

3. RISK SUMMARY
Detailed professional bridge inspection required to assess actual risks and structural condition.

4. TECHNICAL ASSESSMENT
Comprehensive bridge engineering assessment required with NDT methods.

5. RECOMMENDATIONS
• Immediate: Commission detailed bridge inspection with NDT
• Short-term: Execute repairs based on findings
• Long-term: Establish monitoring and maintenance program

6. CONCLUSION
Professional bridge assessment required per IRC SP-35. This preliminary report provides initial guidance only.

Disclaimer: Based on questionnaire responses. Actual bridge condition must be determined through on-site investigation by qualified bridge engineer.`;
        usedMock = true;
      }
    } else {
      // Fallback mock report
      report = `PRELIMINARY BRIDGE ASSESSMENT REPORT

Name: ${user_details.name || 'Not provided'}
Email: ${user_details.email || 'Not provided'}

[Professional bridge assessment required - GROQ API not configured]`;
      usedMock = true;
    }

    res.status(200).json({
      success: true,
      report: report,
      usedMock: usedMock,
      groqDebug: groqDebug
    });

  } catch (error) {
    console.error('Error generating bridge report:', error.message);
    res.status(500).json({ error: 'Failed to generate bridge report', details: error.message });
  }
});

// ========================================
// GENERAL ASSESSMENT ENDPOINTS
// ========================================

// Save assessment to MongoDB
app.post('/api/save-assessment', async (req, res) => {
  try {
    console.log('🔵 /api/save-assessment endpoint called');
    console.log('🔵 Request body keys:', Object.keys(req.body));
    
    const { 
      userDetails, 
      assessmentResponses, 
      pdfBuffer, 
      reportText, 
      assessmentType 
    } = req.body;

    console.log('🔵 Received data:');
    console.log('  - userDetails:', userDetails);
    console.log('  - assessmentResponses type:', typeof assessmentResponses);
    console.log('  - assessmentResponses keys:', assessmentResponses ? Object.keys(assessmentResponses) : 'null');
    console.log('  - pdfBuffer length:', pdfBuffer ? pdfBuffer.length : 0);
    console.log('  - reportText length:', reportText ? reportText.length : 0);
    console.log('  - assessmentType:', assessmentType);

    // Validate required fields
    if (!userDetails || !userDetails.email || !userDetails.name) {
      console.error('❌ Validation failed: Missing user details');
      return res.status(400).json({ 
        error: 'Missing required user details (name, email)' 
      });
    }

    // Convert base64 PDF buffer to Buffer if needed
    let pdfData = null;
    if (pdfBuffer) {
      const buffer = Buffer.isBuffer(pdfBuffer) 
        ? pdfBuffer 
        : Buffer.from(pdfBuffer, 'base64');
      
      pdfData = {
        filename: `OSHAM_Assessment_${userDetails.name.replace(/\s+/g, '_')}_${Date.now()}.pdf`,
        contentType: 'application/pdf',
        size: buffer.length,
        data: buffer,
        generatedAt: getISTTimestamp()
      };
    }

    // Extract raw responses for flattened storage
    const rawResponses = assessmentResponses?.raw_responses || assessmentResponses || {};
    
    // Create assessment document
    const assessmentDoc = {
      userDetails: {
        name: userDetails.name,
        email: userDetails.email,
        phoneCountryCode: userDetails.phoneCountryCode || '+91',
        phone: userDetails.phone || '',
        organization: userDetails.organization || '',
        structureType: userDetails.structureType || assessmentType || 'Building',
        q1: userDetails.q1 || '',
        q1Other: userDetails.q1Other || '',
        yearOfConstruction: userDetails.yearOfConstruction || null,
        location: userDetails.location ||
                  rawResponses.q1_city || rawResponses.q1_city_other ||
                  rawResponses.q1_steel_city || rawResponses.q1_steel_city_other ||
                  rawResponses.q1_heritage_city || rawResponses.q1_heritage_city_other ||
                  rawResponses.q1_lb_city || rawResponses.q1_lb_city_other ||
                  ''
      },
      assessmentResponses: assessmentResponses || {},
      // Store flattened copy of raw responses at top level for easy Compass access
      responses: rawResponses,
      pdfData: pdfData,
      reportText: reportText || '',
      assessmentType: assessmentType || 'Building',
      status: 'completed'
    };

    console.log('🔵 Creating Assessment document...');
    console.log('🔵 Document structure:', JSON.stringify({
      userDetails: assessmentDoc.userDetails,
      assessmentResponses: assessmentDoc.assessmentResponses ? 'present' : 'missing',
      responses: assessmentDoc.responses ? `${Object.keys(assessmentDoc.responses).length} fields` : 'missing',
      pdfData: assessmentDoc.pdfData ? 'present' : 'missing',
      reportText: assessmentDoc.reportText ? assessmentDoc.reportText.substring(0, 100) + '...' : 'missing',
      assessmentType: assessmentDoc.assessmentType
    }, null, 2));

    const assessment = new Assessment(assessmentDoc);

    // Save to database
    console.log('🔵 Saving to MongoDB...');
    const savedAssessment = await assessment.save();
    console.log('✅ MongoDB save successful!');
    
    console.log(`✅ Assessment saved successfully: ${savedAssessment._id}`);
    
    // Notify admins via email (office@spplindia.org & raj-it@spplindia.org)
    notifyAdminOnAssessmentSubmission(
      userDetails,
      assessmentType || 'Building Assessment',
      reportText,
      pdfBuffer,
      savedAssessment._id
    );

    res.status(201).json({
      success: true,
      assessmentId: savedAssessment._id,
      savedAt: savedAssessment.createdAt,
      message: 'Assessment saved successfully'
    });

  } catch (error) {
    console.error('❌ Error saving assessment:', error);
    res.status(500).json({ 
      error: 'Failed to save assessment', 
      details: error.message 
    });
  }
});

// Send assessment completion email
app.post('/api/send-assessment-email', async (req, res) => {
  try {
    const { assessmentId, userDetails, assessmentType, pdfBuffer, reportText: reportTextFromBody } = req.body;

    // If assessmentId provided, fetch from database
    let user = userDetails;
    let type = assessmentType || 'Building';
    let pdf = pdfBuffer;

    let reportText = reportTextFromBody || '';
    let assessment = null;
    if (assessmentId) {
      assessment = await Assessment.findById(assessmentId);
      if (!assessment) {
        return res.status(404).json({ error: 'Assessment not found' });
      }

      user = assessment.userDetails || user;
      type = assessment.assessmentType || type;
      pdf = assessment.pdfData?.data || pdf;
      // Prefer server-stored reportText if available
      if (!reportText && assessment.reportText) {
        reportText = assessment.reportText;
      }
    }

    // Validate email details
    if (!user || !user.email || !user.name) {
      return res.status(400).json({ 
        error: 'Missing required user details (name, email)' 
      });
    }

    // Convert base64 to buffer if needed
    let pdfBuf = null;
    if (pdf) {
      pdfBuf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf, 'base64');
    }

    console.log('📧 Sending marketing email to user...');

    // Send client email (pure marketing template - no PDF, no report)
    const emailResult = await sendAssessmentCompletionEmail(user, type, pdfBuf);

    if (emailResult.success) {
      // Update database if assessmentId provided
      if (assessmentId) {
        await Assessment.findByIdAndUpdate(assessmentId, {
          emailSent: true,
          emailSentAt: getISTTimestamp()
        });
      }

      console.log(`✅ Client email sent to: ${user.email}`);
      
      // Ensure admin receives the final AI report text and PDF attachment (regenerate PDF if needed)
      try {
        // ALWAYS generate comprehensive server-side AI report for admin PDF
        // This ensures Cloudinary gets the full GROQ-generated report, not the client mock
        try {
          console.log('⏳ Generating comprehensive AI report on server (this may take a moment)...');
          const genRes = await axios.post(`http://localhost:${process.env.PORT || 5000}/api/generate-building-report`, {
            user_details: user,
            assessment_responses: assessment ? assessment.assessmentResponses : undefined
          }, { timeout: 120000 });

          if (genRes && genRes.data && genRes.data.report) {
            reportText = genRes.data.report;
            console.log('✅ Server-generated AI report received, length:', reportText.length);
            // Persist comprehensive report to DB
            if (assessmentId) {
              await Assessment.findByIdAndUpdate(assessmentId, { reportText, updatedAt: getISTTimestamp() });
            }
          } else {
            console.warn('⚠️ Server generate-building-report did not return a report; using existing text if available');
          }
        } catch (genErr) {
          console.error('❌ Failed to generate server-side AI report:', genErr.message);
          // Fall back to saved report text if generation fails
          if (!reportText && assessment && assessment.reportText) {
            reportText = assessment.reportText;
            console.log('⚠️ Using saved report text from DB, length:', reportText.length);
          }
        }

        // ALWAYS generate comprehensive server-side PDF for Cloudinary upload
        // This ensures the uploaded PDF has proper formatting and full AI report content
        let pdfBuf = null;
        try {
          console.log('🔄 Generating comprehensive server-side PDF for Cloudinary...');
          
          // Use the comprehensive PDF endpoint to get properly formatted PDF
          const pdfResponse = await axios.post(
            `http://localhost:${process.env.PORT || 5000}/api/generate-building-report-pdf`,
            {
              user_details: user,
              assessment_responses: assessment ? assessment.assessmentResponses : undefined,
              reportText: reportText
            },
            { 
              responseType: 'arraybuffer',
              timeout: 60000 
            }
          );
          
          if (pdfResponse && pdfResponse.data && pdfResponse.data.byteLength > 0) {
            pdfBuf = Buffer.from(pdfResponse.data);
            console.log('✅ Comprehensive server PDF generated, size:', pdfBuf.length, 'bytes');
            
            // Save comprehensive PDF to DB if assessment exists
            if (assessmentId) {
              await Assessment.findByIdAndUpdate(assessmentId, { 
                'pdfData.data': pdfBuf, 
                'pdfData.size': pdfBuf.length, 
                'pdfData.generatedAt': getISTTimestamp() 
              });
            }
          } else {
            console.warn('⚠️ PDF endpoint returned empty response');
          }
        } catch (regenErr) {
          console.error('❌ Failed to generate comprehensive server PDF:', regenErr.message);
          // Fallback: use client PDF if server generation fails
          if (pdf) {
            pdfBuf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf, 'base64');
            console.log('⚠️ Using client PDF as fallback, size:', pdfBuf.length);
          }
        }

        // Upload PDF to Cloudinary if configured
        let cloudinaryUrl = null;
        let cloudinaryPublicId = null;
        if (process.env.CLOUDINARY_CLOUD_NAME && pdfBuf) {
          try {
            const cloudinaryService = require('./services/cloudinaryService');
            const publicId = `report_${assessmentId || Date.now()}_${(user && user.name ? user.name.replace(/\s+/g, '_') : 'anon')}`;
            console.log('⬆️ Uploading PDF to Cloudinary with publicId:', publicId);
            const uploadResult = await cloudinaryService.uploadPdfBuffer(pdfBuf, publicId);
            if (uploadResult && uploadResult.secure_url) {
              cloudinaryUrl = uploadResult.secure_url;
              cloudinaryPublicId = uploadResult.public_id;
              console.log('✅ Uploaded PDF to Cloudinary:', cloudinaryUrl);
              // Persist Cloudinary metadata to DB if assessment exists
              if (assessmentId) {
                await Assessment.findByIdAndUpdate(assessmentId, {
                  'pdfData.cloudinaryPublicId': cloudinaryPublicId,
                  'pdfData.cloudinaryUrl': cloudinaryUrl,
                  'pdfData.size': pdfBuf.length,
                  'pdfData.generatedAt': getISTTimestamp()
                });
              }
              // Append Cloudinary link to report text for admin visibility
              reportText = (reportText || '') + `\n\nPDF stored at: ${cloudinaryUrl}`;
            }
          } catch (uploadErr) {
            console.error('❌ Cloudinary upload failed:', uploadErr && uploadErr.message ? uploadErr.message : uploadErr);
          }
        }

        // Admin notification email to office@spplindia.org & raj-it@spplindia.org
        const adminEmailResult = await sendAdminNotificationEmail(
          user,
          type || 'Assessment',
          reportText || 'No report text available',
          pdfBuf,
          assessmentId
        );
        if (adminEmailResult.success) {
          console.log(`✅ Admin notification email sent to office@spplindia.org & raj-it@spplindia.org with report text${pdfBuf ? ' and PDF attachment' : ''}`);
        } else {
          console.warn(`⚠️ Admin notification email warning: ${adminEmailResult.error}`);
        }
      } catch (adminError) {
        console.error('❌ Error sending admin notification:', adminError.message);
      }
      
      res.status(200).json({
        success: true,
        message: 'Email sent successfully',
        messageId: emailResult.messageId
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to send email',
        details: emailResult.error
      });
    }

  } catch (error) {
    console.error('❌ Error sending assessment email:', error);
    res.status(500).json({ 
      error: 'Failed to send email', 
      details: error.message 
    });
  }
});

// Submit assessment: generate AI report, PDF, upload to Cloudinary, save to DB and  send emails
app.post('/api/submit-assessment', async (req, res) => {
  try {
    const { userDetails, assessmentResponses, assessmentType = 'Building' } = req.body;

    if (!userDetails || !userDetails.email || !userDetails.name) {
      return res.status(400).json({ error: 'Missing required user details (name, email)' });
    }

    // Normalize and persist assessment to DB first, then process heavy tasks in background.
    // Ensure all raw responses are preserved and formatted responses are stored separately
    const originalResponses = assessmentResponses || {};
    const rawResponses = originalResponses.raw_responses || originalResponses;
    const formattedResponses = originalResponses.formatted_responses || originalResponses.formatted || null;
    
    console.log('📊 BACKEND RECEIVED - Response Analysis:');
    console.log('  originalResponses keys:', Object.keys(originalResponses));
    console.log('  rawResponses total keys:', Object.keys(rawResponses).length);
    console.log('  rawResponses Q1-Q14 keys:', Object.keys(rawResponses).filter(k => /^q(1[0-4]|[1-9])_/.test(k)).length);
    console.log('  Sample keys:', Object.keys(rawResponses).slice(0, 20));

    const assessmentDoc = new Assessment({
      userDetails: {
        name: userDetails.name,
        email: userDetails.email,
        phone: userDetails.phone || '',
        organization: userDetails.organization || '',
        structureType: userDetails.structureType || assessmentType,
        q1: userDetails.q1 || '',  // Nature of expertise
        q1Other: userDetails.q1Other || '',  // Custom expertise (when "Others" selected)
        yearOfConstruction: userDetails.yearOfConstruction || null,
        location: userDetails.location ||
                  rawResponses.q1_city || rawResponses.q1_city_other ||
                  rawResponses.q1_steel_city || rawResponses.q1_steel_city_other ||
                  rawResponses.q1_heritage_city || rawResponses.q1_heritage_city_other ||
                  rawResponses.q1_lb_city || rawResponses.q1_lb_city_other ||
                  ''
      },
      assessmentResponses: {
        raw_responses: rawResponses,
        formatted_responses: formattedResponses,
        _rawOriginal: originalResponses
      },
      // Also keep a flattened copy of raw responses for easy querying
      responses: rawResponses || {},
      reportText: '',
      assessmentType: assessmentType,
      status: 'completed',
      processingStatus: 'pending'
    });

    console.log('🔵 [submit-assessment] Saving assessment to MongoDB...');
    console.log('🔵 [submit-assessment] Responses field has:', Object.keys(assessmentDoc.responses || {}).length, 'fields');
    const saved = await assessmentDoc.save();
    console.log('✅ [submit-assessment] Assessment saved:', saved._id);

    // Return immediately after DB persistence so UI can show success quickly.
    res.status(201).json({
      success: true,
      assessmentId: saved._id,
      cloudinaryUrl: null,
      processingQueued: true,
      message: 'Assessment saved. Report/PDF/email processing is continuing in background.'
    });

    // Continue expensive operations asynchronously after response.
    setImmediate(async () => {
      const assessmentId = saved._id;
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
      let reportText = '';
      let pdfBuf = null;

      try {
        await Assessment.findByIdAndUpdate(assessmentId, {
          processingStatus: 'in_progress',
          processingStartedAt: getISTTimestamp()
        });

        console.log('⏳ [submit-assessment/bg] Generating comprehensive AI report...');
        console.log('📋 [submit-assessment/bg] Assessment Type:', assessmentType);

        let reportEndpoint = `${baseUrl}/api/generate-building-report`;
        if (assessmentType === 'Tunnel') {
          reportEndpoint = `${baseUrl}/api/generate-tunnel-report`;
        } else if (assessmentType === 'Bridge') {
          reportEndpoint = `${baseUrl}/api/generate-bridge-report`;
        }
        // Demo uses the same building report endpoint as Building assessments
        console.log('🔗 [submit-assessment/bg] Using report endpoint:', reportEndpoint);

        const genRes = await axios.post(reportEndpoint, {
          user_details: userDetails,
          assessment_responses: assessmentResponses,
          assessmentType: assessmentType
        }, { timeout: 120000 });

        if (genRes && genRes.data && genRes.data.report) {
          reportText = genRes.data.report;
          await Assessment.findByIdAndUpdate(assessmentId, { reportText: reportText || '' });
          console.log('✅ [submit-assessment/bg] Server generated report length:', reportText.length, 'characters');
        } else {
          throw new Error('Report generation returned no report');
        }

        console.log('🔄 [submit-assessment/bg] Generating PDF from reportText...');
        pdfBuf = await generatePdfBufferFromReport(reportText || '', userDetails);
        console.log('✅ [submit-assessment/bg] PDF generated, size:', pdfBuf.length);

        let cloudinaryUrl = null;
        let cloudinaryPublicId = null;

        if (process.env.CLOUDINARY_CLOUD_NAME && pdfBuf) {
          const cloudinaryService = require('./services/cloudinaryService');
          const publicId = `report_${Date.now()}_${(userDetails.name || 'anon').replace(/\s+/g, '_')}`;
          console.log('⬆️ [submit-assessment/bg] Uploading PDF to Cloudinary with publicId:', publicId);
          const uploadResult = await cloudinaryService.uploadPdfBuffer(pdfBuf, publicId);
          if (uploadResult && uploadResult.secure_url) {
            cloudinaryUrl = uploadResult.secure_url;
            cloudinaryPublicId = uploadResult.public_id;
            console.log('✅ [submit-assessment/bg] Uploaded PDF to Cloudinary:', cloudinaryUrl);
          }
        }

        const pdfData = pdfBuf ? {
          filename: `OSHAM_Assessment_${userDetails.name.replace(/\s+/g, '_')}_${Date.now()}.pdf`,
          contentType: 'application/pdf',
          size: pdfBuf.length,
          data: pdfBuf,
          cloudinaryPublicId: cloudinaryPublicId || '',
          cloudinaryUrl: cloudinaryUrl || '',
          generatedAt: getISTTimestamp()
        } : null;

        await Assessment.findByIdAndUpdate(assessmentId, {
          pdfData: pdfData,
          processingStatus: 'completed',
          processingCompletedAt: getISTTimestamp(),
          aiReportReady: true,
          pdfReady: !!pdfData
        });

        try {
          await sendAssessmentCompletionEmail(saved.userDetails, assessmentType, null);
          console.log('✅ [submit-assessment/bg] Client marketing email sent');
          await Assessment.findByIdAndUpdate(assessmentId, {
            emailSent: true,
            emailSentAt: getISTTimestamp()
          });
        } catch (emailErr) {
          console.error('❌ [submit-assessment/bg] Failed to send client email:', emailErr.message || emailErr);
        }
      } catch (bgErr) {
        console.error('❌ [submit-assessment/bg] Background processing failed:', bgErr && bgErr.stack ? bgErr.stack : bgErr.message || bgErr);
        try {
          await Assessment.findByIdAndUpdate(saved._id, {
            processingStatus: 'failed',
            processingError: bgErr && bgErr.message ? bgErr.message : String(bgErr),
            processingCompletedAt: getISTTimestamp()
          });
        } catch (updateErr) {
          console.error('❌ [submit-assessment/bg] Failed to persist processing failure state:', updateErr.message || updateErr);
        }
      }
    });

    return;

  } catch (error) {
    console.error('❌ [submit-assessment] Error:', error && error.stack ? error.stack : error.message || error);
    res.status(500).json({ error: 'Failed to submit assessment', details: error && error.message ? error.message : String(error) });
  }
});

// Get assessment by ID
app.get('/api/assessment/:id', async (req, res) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('-pdfData.data'); // Exclude large PDF data by default
    
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }
    
    res.json(assessment);
  } catch (error) {
    console.error('❌ Error fetching assessment:', error);
    res.status(500).json({ 
      error: 'Failed to fetch assessment', 
      details: error.message 
    });
  }
});

// Get assessment PDF
app.get('/api/assessment/:id/pdf', async (req, res) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }
    
    if (!assessment.pdfData || !assessment.pdfData.data) {
      return res.status(404).json({ error: 'PDF not found for this assessment' });
    }
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${assessment.pdfData.filename}"`);
    res.send(assessment.pdfData.data);
    
  } catch (error) {
    console.error('❌ Error fetching PDF:', error);
    res.status(500).json({ 
      error: 'Failed to fetch PDF', 
      details: error.message 
    });
  }
});

// List user assessments by email
app.get('/api/assessments/user/:email', async (req, res) => {
  try {
    // Allow caller to request inclusion of full responses via query param
    // e.g. /api/assessments/user/:email?includeResponses=true
    const includeResponses = String(req.query.includeResponses || '').toLowerCase() === 'true';

    let query = Assessment.find({ 'userDetails.email': req.params.email })
      .sort({ createdAt: -1 })
      .limit(50);

    if (includeResponses) {
      // exclude only the large PDF binary but keep assessmentResponses
      query = query.select('-pdfData.data');
    } else {
      // default: hide full responses to keep payload small
      query = query.select('-pdfData.data -assessmentResponses');
    }

    const assessments = await query.exec();

    res.json({
      count: assessments.length,
      assessments: assessments
    });
  } catch (error) {
    console.error('❌ Error fetching user assessments:', error);
    res.status(500).json({ 
      error: 'Failed to fetch assessments', 
      details: error.message 
    });
  }
});

// Contact form endpoint
app.post('/api/contact-form', async (req, res) => {
  try {
    const formData = req.body;
    
    // Accept both 'fullName' and 'name' from the frontend
    formData.fullName = formData.fullName || formData.name;

    if (!formData.email || !formData.fullName) {
      return res.status(400).json({ 
        error: 'Missing required fields (email, fullName)' 
      });
    }

    // Import contact email sender
    const { sendContactFormEmail } = require('./services/emailService');
    
    // Send email to admin
    const emailResult = await sendContactFormEmail(formData);
    
    if (emailResult.success) {
      console.log(`✅ Contact form email sent for: ${formData.fullName}`);
      
      res.status(200).json({
        success: true,
        message: 'Contact form submitted successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to send contact form email'
      });
    }
  } catch (error) {
    console.error('❌ Error processing contact form:', error);
    res.status(500).json({ 
      error: 'Failed to process contact form', 
      details: error.message 
    });
  }
});

// Mount auth routes with stricter rate limiting
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth', authRoutes);

// Mount admin routes
app.use('/api/admin', adminRoutes);

// Mount payment routes with payment-specific rate limiting
app.use('/api/payment/create-order', paymentLimiter);
app.use('/api/payment', paymentRoutes);

// User Reports - Get all assessments for logged-in user
app.get('/api/user/assessments', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    const assessments = await Assessment.find({ 'userDetails.email': userEmail })
      .select('assessmentType userDetails.structureType userDetails.location userDetails.name assessmentResponses.raw_responses.q5_structural_system responses.q5_structural_system responses.q1_city responses.q1_city_other responses.q1_steel_city responses.q1_steel_city_other responses.q1_heritage_city responses.q1_heritage_city_other responses.q1_lb_city responses.q1_lb_city_other createdAt submittedAt adminReport pdfData.cloudinaryUrl advancedResponses advancedAssessmentId advancedSubmittedAt')
      .sort({ createdAt: -1 });

    // Bulk-check which assessments have a FinalAssessment doc
    const assessmentIds = assessments.map(a => a._id);
    const finalDocs = await FinalAssessment.find({ basicAssessmentId: { $in: assessmentIds } })
      .select('basicAssessmentId completedAt');
    const finalMap = {};
    finalDocs.forEach(f => { finalMap[String(f.basicAssessmentId)] = f.completedAt; });

    const assessmentsWithReportStatus = assessments.map((assessment, index) => {
      // Derive location: prefer stored userDetails.location, fall back to raw response city fields
      const r = assessment.responses || {};
      const derivedLocation =
        assessment.userDetails?.location ||
        r.q1_city || r.q1_city_other ||
        r.q1_steel_city || r.q1_steel_city_other ||
        r.q1_heritage_city || r.q1_heritage_city_other ||
        r.q1_lb_city || r.q1_lb_city_other ||
        '';

      return {
        _id: assessment._id,
        assessmentNumber: assessments.length - index, // Assessment 1, 2, 3...
        assessmentType: assessment.assessmentType,
        structureType: assessment.assessmentResponses?.raw_responses?.q5_structural_system || assessment.responses?.q5_structural_system || assessment.userDetails?.structureType || 'N/A',
        location: derivedLocation,
        assessorName: assessment.userDetails?.name || '',
        createdAt: assessment.createdAt,
        submittedAt: assessment.submittedAt || assessment.createdAt,
        hasAdminReport: !!assessment.adminReport?.gridFsFileId,
        adminReportUrl: assessment.adminReport?.gridFsFileId ? `/api/proxy/pdf/${assessment._id}` : null,
        aiReportUrl: assessment.pdfData?.cloudinaryUrl,
        hasAdvancedResponses: !!(
          assessment.advancedAssessmentId ||
          assessment.advancedSubmittedAt ||
          (assessment.advancedResponses && Object.keys(assessment.advancedResponses).length > 0)
        ),
        advancedAssessmentId: assessment.advancedAssessmentId || null,
        advancedSubmittedAt: assessment.advancedSubmittedAt || null,
        hasFinalAssessment: !!finalMap[String(assessment._id)],
        finalCompletedAt: finalMap[String(assessment._id)] || null
      };
    });
    
    res.json({ success: true, assessments: assessmentsWithReportStatus });
  } catch (error) {
    console.error('Error fetching user assessments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assessments' });
  }
});

// Save advanced questionnaire responses to an existing assessment
// ── Save / update advanced questionnaire responses ──────────────────────────
// Creates a document in the `advancedassessments` collection and stores a
// back-reference on the base Assessment document.
const sanitizeAdvancedPayload = (value) => {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(sanitizeAdvancedPayload);
  }
  if (typeof value !== 'object') {
    return value;
  }

  const clean = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (typeof v === 'undefined' || typeof v === 'function' || typeof v === 'symbol') continue;
    clean[k] = sanitizeAdvancedPayload(v);
  }
  return clean;
};

app.post('/api/assessment/:id/advanced', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { advancedResponses } = req.body;
    const userEmail = req.user.email;

    if (!advancedResponses || typeof advancedResponses !== 'object') {
      return res.status(400).json({ success: false, message: 'advancedResponses payload is required' });
    }

    // Verify base assessment exists and belongs to this user
    const baseAssessment = await Assessment.findById(id);
    if (!baseAssessment) {
      return res.status(404).json({ success: false, message: 'Base assessment not found' });
    }
    if (baseAssessment.userDetails.email !== userEmail) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const structureType =
      advancedResponses?._meta?.structureType ||
      baseAssessment.assessmentResponses?.raw_responses?.q5_structural_system ||
      baseAssessment.responses?.q5_structural_system ||
      baseAssessment.userDetails?.structureType ||
      'Building';

    const assessmentType = baseAssessment.assessmentType || 'Building';
    const formVersion = advancedResponses?._meta?.formVersion || '';

    // Strip the _meta helper key from stored responses — all real fields go in `responses`
    const { _meta, ...rawResponses } = advancedResponses;
    const cleanResponses = sanitizeAdvancedPayload(rawResponses);

    // ── Upsert into the dedicated AdvancedAssessment collection ──────────────
    // If the user re-submits we overwrite (one advanced doc per base assessment).
    let advancedDoc = await AdvancedAssessment.findOne({ baseAssessmentId: id });

    if (advancedDoc) {
      // Update existing document
      advancedDoc.responses    = cleanResponses;
      advancedDoc.structureType = structureType;
      advancedDoc.formVersion  = formVersion;
      advancedDoc.markModified('responses');
      await advancedDoc.save();
      console.log(`🔄 Advanced assessment updated  → ${advancedDoc._id}`);
    } else {
      // Create new document
      advancedDoc = await AdvancedAssessment.create({
        baseAssessmentId: id,
        userEmail,
        userName: baseAssessment.userDetails?.name || '',
        structureType,
        assessmentType,
        formVersion,
        responses: cleanResponses
      });
      console.log(`✅ Advanced assessment created  → ${advancedDoc._id}`);
    }

    // ── Keep back-reference + snapshot on the base Assessment ─────────────────
    baseAssessment.advancedAssessmentId = advancedDoc._id;
    baseAssessment.advancedResponses    = cleanResponses; // snapshot for quick access
    baseAssessment.advancedSubmittedAt  = advancedDoc.updatedAt || advancedDoc.createdAt;
    baseAssessment.updatedAt            = new Date();
    baseAssessment.markModified('advancedResponses');
    await baseAssessment.save();

    // Consume an unused advanced payment bound to this base assessment.
    // This enforces one advanced payment per assessment submission.
    try {
      const advancedPayment = await Payment.findOne({
        userId: new mongoose.Types.ObjectId(req.user.userId),
        assessmentId: new mongoose.Types.ObjectId(id),
        status: 'success',
        assessmentUsed: false,
        $or: [
          { 'metadata.assessmentLevel': 'advanced' },
          { 'metadata.assessmentLevel': { $exists: false } }
        ]
      }).sort({ paidAt: -1 });

      if (advancedPayment) {
        await advancedPayment.markAsUsed(id, assessmentType || 'Building');
        console.log(`✅ Advanced payment consumed for assessment ${id}: ${advancedPayment._id}`);
      } else {
        console.warn(`⚠️ No unused advanced payment found to consume for assessment ${id}`);
      }
    } catch (paymentConsumeError) {
      console.error('⚠️ Failed to consume advanced payment (non-fatal):', paymentConsumeError.message || paymentConsumeError);
    }

    // ── Auto-create / update FinalAssessment (both basic + advanced now complete) ─
    try {
      await FinalAssessment.findOneAndUpdate(
        { basicAssessmentId: id },
        {
          userEmail: baseAssessment.userDetails.email,
          userName: baseAssessment.userDetails.name || '',
          advancedAssessmentId: advancedDoc._id,
          structureType,
          assessmentType,
          location: baseAssessment.userDetails.location || '',
          basicData: baseAssessment.responses || {},
          advancedData: cleanResponses,
          basicReportText: baseAssessment.reportText || '',
          basicPdfUrl: baseAssessment.pdfData?.cloudinaryUrl || '',
          completedAt: new Date(),
          updatedAt: new Date()
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`✅ FinalAssessment upserted for base assessment ${id}`);
    } catch (finalErr) {
      console.error('⚠️ FinalAssessment upsert failed (non-fatal):', finalErr.message);
    }

    const fieldCount = Object.keys(cleanResponses).length;
    const sectionNames = Object.keys(cleanResponses).join(', ');
    console.log(`   Sections saved: ${fieldCount}  [${sectionNames}]  |  Structure: ${structureType}`);

    res.json({
      success: true,
      message: 'Advanced responses saved successfully',
      assessmentId: id,
      advancedAssessmentId: advancedDoc._id,
      fieldsSaved: fieldCount,
      savedAt: advancedDoc.updatedAt || advancedDoc.createdAt
    });
  } catch (error) {
    console.error('❌ Error saving advanced responses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save advanced responses',
      error: error.message
    });
  }
});

// ── Retrieve advanced assessment for a base assessment ────────────────────────
app.get('/api/assessment/:id/advanced', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user.email;

    const baseAssessment = await Assessment.findById(id).select('userDetails.email advancedAssessmentId');
    if (!baseAssessment) {
      return res.status(404).json({ success: false, message: 'Assessment not found' });
    }
    if (baseAssessment.userDetails.email !== userEmail) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const advancedDoc = await AdvancedAssessment.findOne({ baseAssessmentId: id });
    if (!advancedDoc) {
      return res.json({ success: true, exists: false, advancedResponses: null });
    }

    res.json({
      success: true,
      exists: true,
      advancedAssessmentId: advancedDoc._id,
      structureType: advancedDoc.structureType,
      submittedAt: advancedDoc.submittedAt,
      updatedAt: advancedDoc.updatedAt,
      advancedResponses: advancedDoc.responses
    });
  } catch (error) {
    console.error('❌ Error retrieving advanced responses:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve advanced responses', error: error.message });
  }
});

// ── Full report data for a single assessment (basic + advanced + final) ───────
app.get('/api/assessment/:id/report', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user.email;

    const basic = await Assessment.findById(id).select('-pdfData.data');
    if (!basic) return res.status(404).json({ success: false, message: 'Assessment not found' });
    if (basic.userDetails.email !== userEmail) return res.status(403).json({ success: false, message: 'Access denied' });

    const advanced = await AdvancedAssessment.findOne({ baseAssessmentId: id }) || null;
    const final = await FinalAssessment.findOne({ basicAssessmentId: id }) || null;

    res.json({ success: true, basic, advanced, final });
  } catch (error) {
    console.error('❌ Error fetching full report:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch report', error: error.message });
  }
});

// ── Full assessment list: basic + advanced/final flags per assessment ─────────
app.get('/api/user/full-assessments', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;

    const basics = await Assessment.find({ 'userDetails.email': userEmail })
      .select('-pdfData.data -assessmentResponses')
      .sort({ createdAt: -1 })
      .limit(50);

    const results = await Promise.all(basics.map(async (a) => {
      const adv = await AdvancedAssessment.findOne({ baseAssessmentId: a._id })
        .select('_id structureType submittedAt updatedAt').lean();
      const fin = await FinalAssessment.findOne({ basicAssessmentId: a._id })
        .select('_id completedAt').lean();

      const raw = a.responses || {};
      const structureType =
        raw.q5_structural_system ||
        a.userDetails?.structureType || '';
      const location =
        raw.q1_city || raw.q1_city_other ||
        raw.q1_steel_city || raw.q1_lb_city ||
        raw.q1_heritage_city ||
        a.userDetails?.location || '';

      return {
        _id: a._id,
        assessmentType: a.assessmentType,
        structureType,
        location,
        assessorName: a.userDetails?.name || '',
        createdAt: a.createdAt,
        pdfUrl: a.pdfData?.cloudinaryUrl || null,
        hasAdvanced: !!adv,
        advancedId: adv?._id || null,
        advancedAt: adv?.updatedAt || adv?.submittedAt || null,
        hasFinal: !!fin,
        finalId: fin?._id || null,
        finalAt: fin?.completedAt || null
      };
    }));

    res.json({ success: true, assessments: results });
  } catch (error) {
    console.error('❌ Error fetching full assessments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assessments', error: error.message });
  }
});
const _uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are accepted'), false);
  },
});

/**
 * POST /api/assessment/:id/upload-image
 * Upload one assessment photo to Cloudinary.
 * Allowed image size: 20 KB to 2 MB.
 * Returns { success, url, publicId, width, height }
 */
app.post('/api/assessment/:id/upload-image', authenticateToken, _uploadMemory.single('image'), async (req, res) => {
  try {
    const MIN_IMAGE_BYTES = 20 * 1024; // 20 KB
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
    const { id } = req.params;
    const userEmail = req.user.email;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided.' });
    }

    if (req.file.size < MIN_IMAGE_BYTES) {
      return res.status(400).json({
        success: false,
        message: 'Image is too small. Allowed image size is 20 KB to 2 MB.'
      });
    }

    if (req.file.size > MAX_IMAGE_BYTES) {
      return res.status(400).json({
        success: false,
        message: 'Image is too large. Allowed image size is 20 KB to 2 MB.'
      });
    }

    // Verify the assessment exists and belongs to this user
    const baseAssessment = await Assessment.findById(id).select('userDetails.email');
    if (!baseAssessment) {
      return res.status(404).json({ success: false, message: 'Assessment not found' });
    }
    if (baseAssessment.userDetails.email !== userEmail) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      return res.status(503).json({ success: false, message: 'Image storage is not configured on this server.' });
    }

    const folder = `osham-assessments/${id}`;
    const result = await cloudinaryService.uploadImageBuffer(req.file.buffer, req.file.originalname, folder);

    console.log(`📸 Image uploaded for assessment ${id}: ${result.secure_url}`);
    return res.json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    });
  } catch (error) {
    console.error('❌ Image upload error:', error);
    if (error && /Only image files are accepted/i.test(error.message || '')) {
      return res.status(400).json({
        success: false,
        message: 'Only image files are accepted.'
      });
    }
    if (error && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Image is too large. Allowed image size is 20 KB to 2 MB.'
      });
    }
    return res.status(500).json({ success: false, message: 'Image upload failed', error: error.message });
  }
});

// PDF Proxy endpoint - serves PDFs with proper headers for inline viewing
app.get('/api/proxy/pdf/:assessmentId', authenticateToken, async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const userEmail = req.user.email;
    
    // Find assessment and verify ownership
    const assessment = await Assessment.findById(assessmentId);
    
    if (!assessment) {
      return res.status(404).json({ success: false, message: 'Assessment not found' });
    }
    
    // Verify user owns this assessment
    if (assessment.userDetails.email !== userEmail) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    if (!assessment.adminReport?.gridFsFileId) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }
    
    // Stream PDF from GridFS
    const fileId = assessment.adminReport.gridFsFileId;
    console.log('📄 Streaming PDF from GridFS:', fileId);
    
    // Set proper headers for inline PDF viewing
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="assessment_report.pdf"');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    // Create download stream from GridFS
    const downloadStream = gridFSBucket.openDownloadStream(new mongoose.Types.ObjectId(fileId));
    
    downloadStream.on('error', (error) => {
      console.error('GridFS download error:', error);
      if (!res.headersSent) {
        res.status(404).json({ success: false, message: 'File not found in storage' });
      }
    });
    
    // Pipe the file stream directly to response
    downloadStream.pipe(res);
    
  } catch (error) {
    console.error('Error proxying PDF:', error);
    res.status(500).json({ success: false, message: 'Failed to load PDF' });
  }
});

// Uptime monitor endpoints
// - /api/health: compatibility endpoint (always 200, includes database state)
// - /api/live: process is alive
// - /api/ready: service is ready (returns 503 when DB is disconnected)
const logUptimeHit = (req, endpoint) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.ip || '').toString().split(',')[0].trim();
  console.log(`[UPTIME] ${new Date().toISOString()} ${endpoint} hit from ${ip || 'unknown-ip'}`);
};

app.get('/api/health', (req, res) => {
  logUptimeHit(req, '/api/health');
  const dbConnected = mongoose.connection.readyState === 1;
  const dbStatus = dbConnected ? 'connected' : 'disconnected';
  const memory = process.memoryUsage();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbStatus,
    mongodb: MONGODB_URI ? 'configured' : 'not configured',
    environment: process.env.NODE_ENV || 'development',
    memoryMb: {
      rss: Math.round(memory.rss / 1024 / 1024),
      heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memory.heapTotal / 1024 / 1024)
    }
  });
});

app.get('/api/live', (req, res) => {
  logUptimeHit(req, '/api/live');
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

app.get('/api/ready', (req, res) => {
  logUptimeHit(req, '/api/ready');
  const dbConnected = mongoose.connection.readyState === 1;
  const payload = {
    status: dbConnected ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbConnected ? 'pass' : 'fail'
    }
  };

  if (!dbConnected) {
    return res.status(503).json(payload);
  }

  return res.status(200).json(payload);
});

// Keep-alive endpoint for external uptime monitors
app.get('/ping', (req, res) => {
  logUptimeHit(req, '/ping');
  res.status(200).send('Server is alive');
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Building Assessment API server running on port ${PORT}`);
  console.log(`GROQ_API_KEY configured: ${GROQ_API_KEY ? 'Yes' : 'No'}`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the process using that port or set PORT env var to a free port.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
