const axios = require('axios');

// ─── Brevo HTTP API ───────────────────────────────────────────────────────────
// Uses HTTPS port 443 — works on Render (SMTP port 587 is blocked)
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL    = process.env.EMAIL_FROM || 'office@spplindia.org';
const FROM_NAME     = 'OSHAS - Sanrachna Prahari';

// ─── Notify raj-it when Basic, Advanced, or Demo assessment is submitted ──────
/**
 * Sends a notification email to raj-it@spplindia.org
 * when a Basic, Advanced, or Demo assessment is submitted.
 *
 * @param {Object} userDetails  - { name, email, phone, organization }
 * @param {string} assessmentType - 'Basic' | 'Advanced' | 'Demo' | structure type
 * @param {string} assessmentId  - MongoDB _id of the saved assessment
 */
async function notifyRajOnSubmission(userDetails, assessmentType, assessmentId) {
  const name  = userDetails?.name || userDetails?.userName || 'Unknown User';
  const email = userDetails?.email || userDetails?.userEmail || 'N/A';
  const phone = userDetails?.phone || userDetails?.contact || 'N/A';
  const org   = userDetails?.organisation || userDetails?.organization || userDetails?.company || 'N/A';
  const type  = assessmentType || 'Building Assessment';

  const submittedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; background: #f4f7fa; margin: 0; padding: 20px; color: #333; }
    .container { max-width: 580px; margin: 0 auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 30px; text-align: center; }
    .header h1 { margin: 0; color: #fff; font-size: 22px; }
    .header p  { margin: 8px 0 0; color: #bfdbfe; font-size: 14px; }
    .body { padding: 30px; }
    .badge { display: inline-block; padding: 5px 14px; border-radius: 20px; font-size: 13px; font-weight: bold; background: #dbeafe; color: #1e40af; margin-bottom: 20px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    .info-table td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
    .info-table td:first-child { font-weight: bold; color: #555; width: 140px; }
    .action-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 6px; margin-top: 20px; font-size: 14px; }
    .footer { background: #f8fafc; padding: 18px; text-align: center; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔔 New ${type} Submitted</h1>
      <p>OSHAS Portal — Action Required</p>
    </div>
    <div class="body">
      <span class="badge">${type} Submission</span>

      <table class="info-table">
        <tr><td>Client Name</td><td>${name}</td></tr>
        <tr><td>Email</td><td><a href="mailto:${email}">${email}</a></td></tr>
        <tr><td>Phone</td><td>${phone}</td></tr>
        <tr><td>Organization</td><td>${org}</td></tr>
        <tr><td>Assessment Type</td><td>${type}</td></tr>
        <tr><td>Assessment ID</td><td><code>${assessmentId || 'N/A'}</code></td></tr>
        <tr><td>Submitted At</td><td>${submittedAt} IST</td></tr>
      </table>

      <div class="action-box">
        ⚠️ <strong>Action Required:</strong> Please review this submission and take necessary action.
      </div>
    </div>
    <div class="footer">
      Sanrachna Prahari Pvt Ltd — OSHAS Portal &nbsp;|&nbsp; Automated Notification
    </div>
  </div>
</body>
</html>
  `;

  try {
    const response = await axios.post(BREVO_API_URL, {
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: 'raj-it@spplindia.org', name: 'Raj IT' }],
      subject: `🔔 New ${type} Submission — ${name}`,
      htmlContent: html
    }, {
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    console.log(`✅ Notification sent to raj-it@spplindia.org for ${type} by ${name} | ID: ${response.data?.messageId}`);
    return { success: true, messageId: response.data?.messageId };
  } catch (err) {
    const errMsg = err?.response?.data?.message || err.message;
    console.error('❌ Failed to notify raj-it:', errMsg);
    return { success: false, error: errMsg };
  }
}

// ─── Backwards-compatibility aliases for other routes ───────────────────────

async function sendVerificationEmail(email, firstName, verificationCode) {
  // Verification email disabled per user requirement
  return { success: true };
}

async function sendAssessmentCompletionEmail(userDetails, assessmentType, pdfBuffer) {
  // Direct client email disabled per user requirement
  return { success: true };
}

async function sendAdminNotificationEmail(userDetails, assessmentType, reportText, pdfBuffer, assessmentId) {
  return notifyRajOnSubmission(userDetails, assessmentType, assessmentId);
}

async function sendContactFormEmail(formData) {
  // Contact form email disabled per user requirement
  return { success: true };
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  notifyRajOnSubmission,
  sendVerificationEmail,
  sendAssessmentCompletionEmail,
  sendAdminNotificationEmail,
  sendContactFormEmail
};
