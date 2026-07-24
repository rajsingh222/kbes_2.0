require('dotenv').config();
const axios = require('axios');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'office@spplindia.org';

async function sendTestEmail() {
  console.log('🔵 Testing Brevo HTTP API...');
  console.log('   API Key:', BREVO_API_KEY ? BREVO_API_KEY.substring(0, 20) + '...' : '❌ NOT SET');
  console.log('   From:', EMAIL_FROM);

  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'OSHAS Test', email: EMAIL_FROM },
        to: [{ email: EMAIL_FROM }], // sending to same address
        subject: '✅ OSHAS Email Test - Brevo is Working!',
        htmlContent: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:30px;border:2px solid #3b82f6;border-radius:12px;">
            <h2 style="color:#1e3a8a;">✅ Brevo Email Test Successful!</h2>
            <p style="color:#374151;">This confirms that:</p>
            <ul style="color:#374151;line-height:2;">
              <li>Brevo HTTP API is working correctly</li>
              <li>Sender <strong>${EMAIL_FROM}</strong> is verified</li>
              <li>Emails will work on Render deployment</li>
            </ul>
            <hr style="border:1px solid #e5e7eb;margin:20px 0;">
            <p style="color:#6b7280;font-size:13px;">Sent at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
            <p style="color:#6b7280;font-size:13px;">OSHAS - Sanrachna Prahari Pvt Ltd</p>
          </div>
        `
      },
      {
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('\n✅ SUCCESS! Email sent!');
    console.log('   Message ID:', response.data?.messageId);
    console.log('   Check inbox at:', EMAIL_FROM);

  } catch (err) {
    const errData = err?.response?.data;
    console.error('\n❌ FAILED!');
    console.error('   Status:', err?.response?.status);
    console.error('   Error:', errData?.message || err.message);
    if (errData?.code) console.error('   Code:', errData.code);
  }
}

sendTestEmail();
