const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // User Information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userEmail: {
    type: String,
    required: true
  },
  
  // Razorpay Details
  razorpayOrderId: {
    type: String,
    required: true,
    unique: true
  },
  razorpayPaymentId: {
    type: String,
    default: null
  },
  razorpaySignature: {
    type: String,
    default: null
  },
  
  // Payment Details
  amount: {
    type: Number,
    required: true // Amount in paise (250 rupees = 25000 paise)
  },
  currency: {
    type: String,
    default: 'INR'
  },
  
  // Payment Status
  status: {
    type: String,
    enum: ['created', 'pending', 'success', 'failed', 'used'],
    default: 'created'
  },
  
  // Assessment Usage Tracking
  assessmentUsed: {
    type: Boolean,
    default: false
  },
  assessmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assessment',
    default: null
  },
  assessmentType: {
    type: String,
    enum: ['Building', 'Load Bearing', 'Bridge', 'Tunnel', 'Tower', 'Other', null],
    default: null
  },
  usedAt: {
    type: Date,
    default: null
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  paidAt: {
    type: Date,
    default: null
  },
  
  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
});

// Indexes for faster queries
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ userEmail: 1, status: 1 });
// razorpayOrderId already has unique index from schema definition, so no need to duplicate
paymentSchema.index({ razorpayPaymentId: 1 });
paymentSchema.index({ status: 1, assessmentUsed: 1 });

// Method to check if payment can be used for assessment
paymentSchema.methods.canBeUsedForAssessment = function() {
  return this.status === 'success' && !this.assessmentUsed;
};

// Method to mark payment as used
paymentSchema.methods.markAsUsed = function(assessmentId, assessmentType) {
  this.assessmentUsed = true;
  this.assessmentId = assessmentId;
  this.assessmentType = assessmentType;
  this.usedAt = new Date();
  this.status = 'used';
  return this.save();
};

module.exports = mongoose.model('Payment', paymentSchema);
