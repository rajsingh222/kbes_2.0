const mongoose = require('mongoose');

/**
 * AdvancedAssessment Collection
 *
 * Stores the complete advanced questionnaire responses for every structure type
 * (RCC, Steel, Composite, Load Bearing, Heritage, Bridge, Tunnel).
 *
 * Each document links back to the base Assessment via `baseAssessmentId`.
 * The base Assessment document stores a back-reference in `advancedAssessmentId`.
 */

function getISTTimestamp() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + 5.5 * 60 * 60 * 1000); // UTC+5:30
}

const advancedAssessmentSchema = new mongoose.Schema({

  // ── Link to the base assessment ─────────────────────────────────────────────
  baseAssessmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assessment',
    required: true
  },

  // ── Who submitted ───────────────────────────────────────────────────────────
  userEmail: { type: String, required: true, index: true },
  userName:  { type: String, default: '' },

  // ── What kind of structure ───────────────────────────────────────────────────
  // e.g. "RCC Structure", "Steel structure", "Heritage structure", etc.
  structureType: { type: String, required: true, index: true },

  // e.g. "Building", "Bridge", "Tunnel"
  assessmentType: {
    type: String,
    enum: ['Building', 'Bridge', 'Load Bearing', 'Tunnel', 'Tower', 'Other'],
    required: true
  },

  // ── All form fields ──────────────────────────────────────────────────────────
  // Stored as a flat key-value Mixed object so every field from every
  // question (Q1-Q10) is preserved exactly as the user filled it.
  responses: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },

  // ── Version tag set by the frontend (e.g. "advanced-rcc-v1") ────────────────
  formVersion: { type: String, default: '' },

  // ── Timestamps ───────────────────────────────────────────────────────────────
  submittedAt: { type: Date, default: null },
  createdAt:   { type: Date, default: null },
  updatedAt:   { type: Date, default: null }

}, { strict: false }); // strict:false lets any extra top-level fields through

// ── Indexes for fast lookups ─────────────────────────────────────────────────
advancedAssessmentSchema.index({ userEmail: 1, createdAt: -1 });
advancedAssessmentSchema.index({ baseAssessmentId: 1 }, { unique: true }); // one advanced doc per base

// ── IST timestamps ────────────────────────────────────────────────────────────
advancedAssessmentSchema.pre('save', function () {
  const now = getISTTimestamp();
  if (this.isNew) {
    this.createdAt   = now;
    this.submittedAt = now;
  }
  this.updatedAt = now;
});

module.exports = mongoose.model('AdvancedAssessment', advancedAssessmentSchema);
