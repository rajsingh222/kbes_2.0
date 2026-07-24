const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sendAdminNotificationEmail } = require('../services/emailService');

async function testFullAdminNotification() {
  console.log('--- TESTING FULL ADMIN NOTIFICATION DELIVERY ---');
  console.log('EMAIL_SERVICE:', process.env.EMAIL_SERVICE);
  console.log('EMAIL_USER:', process.env.EMAIL_USER);

  const mockUserDetails = {
    name: 'SPPL Live Test User',
    email: 'singhraj.gop@gmail.com',
    phone: '+91 9999999991',
    organization: 'IIT Delhi Incubated Team',
    location: 'New Delhi, India',
    structureType: 'RCC Building Assessment (Basic)'
  };

  const mockReportText = `PRELIMINARY BUILDING ASSESSMENT REPORT
Generated: ${new Date().toLocaleDateString('en-IN')}

1. OVERVIEW
Overall Structural Health: Good
This is a test building assessment notification sent to confirm that admin notification email delivery to office@spplindia.org and raj-it@spplindia.org is working cleanly.

2. KEY OBSERVATIONS
• Visual inspection reveals normal age-related weathering.
• No critical structural tilt or active reinforcement corrosion observed.

3. RECOMMENDATIONS
• Routine annual maintenance recommended per IS 13935:2009.`;

  try {
    const res = await sendAdminNotificationEmail(
      mockUserDetails,
      'RCC Building Assessment (Basic)',
      mockReportText,
      null,
      'LIVE_TEST_' + Date.now()
    );
    console.log('🎉 RESULT:', res);
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

testFullAdminNotification();
