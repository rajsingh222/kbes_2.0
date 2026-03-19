const mongoose = require('mongoose');

const finalAssessmentSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, index: true },
  userName: { type: String, default: '' },
  basicAssessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true },
  advancedAssessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdvancedAssessment', required: true },
  structureType: { type: String, default: '' },
  assessmentType: { type: String, default: 'Building' },
  location: { type: String, default: '' },
  basicData: { type: mongoose.Schema.Types.Mixed, default: {} },
  advancedData: { type: mongoose.Schema.Types.Mixed, default: {} },
  basicReportText: { type: String, default: '' },
  basicPdfUrl: { type: String, default: '' },
  completedAt: { type: Date, default: Date.now },
  createdAt: { type: Date },
  updatedAt: { type: Date }
}, { strict: false });

finalAssessmentSchema.index({ basicAssessmentId: 1 }, { unique: true });
finalAssessmentSchema.index({ userEmail: 1, completedAt: -1 });

finalAssessmentSchema.pre('save', function (next) {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  if (this.isNew) {
    this.createdAt = istNow;
    this.completedAt = istNow;
  }
  this.updatedAt = istNow;
  next();
});

module.exports = mongoose.model('FinalAssessment', finalAssessmentSchema);
