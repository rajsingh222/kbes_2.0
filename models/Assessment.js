const mongoose = require('mongoose');

const assessmentSchema = new mongoose.Schema({
  // User Details
  userDetails: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phoneCountryCode: { type: String, default: '+91' }, // Country code for phone
    phone: { type: String, required: false }, // Made optional
    organization: String,
    structureType: String,
    q1: String, // Nature of expertise
    q1Other: String, // Custom expertise (when "Others" is selected)
    yearOfConstruction: String,
    location: String
  },
  
  // Assessment Responses
  assessmentResponses: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },

  // Flattened responses for easy querying (stores each raw response key at top-level under this object)
  responses: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  
  // Advanced Questionnaire Responses
  // Stores the complete flat key-value map of all advanced form fields.
  // Use assessment.markModified('advancedResponses') before save when mutating.
  advancedResponses: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },

  // Reference to the separate AdvancedAssessment document (own collection)
  advancedAssessmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdvancedAssessment',
    default: null
  },

  // Timestamp of when the advanced questionnaire was last submitted
  advancedSubmittedAt: {
    type: Date,
    default: null
  },
  
  // PDF Data
  pdfData: {
    filename: String,
    contentType: String,
    size: Number,
    data: Buffer, // Store PDF as binary data (optional - can be omitted if using Cloudinary)
    generatedAt: { type: Date },
    // Cloudinary storage metadata
    cloudinaryPublicId: String,
    cloudinaryUrl: String
  },
  
  // AI Report Text
  reportText: String,
  
  // Admin Uploaded Report
  adminReport: {
    cloudinaryPublicId: String,
    cloudinaryUrl: String,
    gridFsFileId: mongoose.Schema.Types.ObjectId, // GridFS file ID
    uploadedAt: Date,
    uploadedBy: String // admin email
  },
  
  // Payment Reference
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    default: null
  },
  
  // Metadata
  assessmentType: {
    type: String,
    enum: ['Bridge', 'Building', 'Load Bearing', 'Tower', 'Tunnel', 'Other'],
    required: true
  },
  
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'completed'
  },
  
  emailSent: {
    type: Boolean,
    default: false
  },
  
  emailSentAt: Date,
  
  submittedAt: {
    type: Date,
    default: Date.now
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
assessmentSchema.index({ 'userDetails.email': 1, createdAt: -1 });
assessmentSchema.index({ createdAt: -1 });

// Helper function to get IST timestamp (timezone-agnostic)
function getISTTimestamp() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  return new Date(utc + istOffset);
}

// Pre-save middleware to set IST timestamps
assessmentSchema.pre('save', async function() {
  const now = getISTTimestamp();
  if (this.isNew) {
    this.createdAt = now;
  }
  this.updatedAt = now;
  // If a PDF was attached, ensure generatedAt is stored in IST
  try {
    if (this.pdfData && this.pdfData.data && !this.pdfData.generatedAt) {
      this.pdfData.generatedAt = now;
    }
  } catch (err) {
    // ignore and continue save
  }
});

module.exports = mongoose.model('Assessment', assessmentSchema);
