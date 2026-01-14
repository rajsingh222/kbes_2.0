const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');

// Initialize SendGrid HTTP API (fallback for when SMTP is blocked)
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Create Brevo transporter for verification emails ONLY
const createBrevoTransporter = () => {
  return nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER || '9ef20d001@smtp-brevo.com',
      pass: process.env.BREVO_SMTP_PASS || 'your_brevo_smtp_password_here'
    }
  });
};

// Create SendGrid transporter for assessment emails
const createTransporter = () => {
  // For SendGrid (for assessment completion emails)
  if (process.env.EMAIL_SERVICE === 'sendgrid') {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
      }
    });
  }

  // For Brevo (formerly Sendinblue) - 300 emails/day free
  if (process.env.EMAIL_SERVICE === 'brevo') {
    return nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.BREVO_SMTP_USER,
        pass: process.env.BREVO_SMTP_KEY
      }
    });
  }
  
  // For Gmail (local development)
  if (process.env.EMAIL_SERVICE === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD // Use App Password, not regular password
      }
    });
  }
  
  // For other SMTP services
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
};

/**
 * Send verification email for new user registration
 * Uses dedicated SendGrid API key for verification codes
 */
async function sendVerificationEmail(email, firstName, verificationCode) {
  const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .code-box { background: white; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
          .code { font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 5px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Email Verification</h1>
          </div>
          <div class="content">
            <p>Hi ${firstName},</p>
            <p>Thank you for signing up for OSHAS (Online Structural Health Assessment System)!</p>
            <p>Please use the verification code below to complete your registration:</p>
            
            <div class="code-box">
              <div class="code">${verificationCode}</div>
            </div>
            
            <p><strong>This code will expire in 10 minutes.</strong></p>
            <p>If you didn't request this code, please ignore this email.</p>
            
            <div class="footer">
              <p>SPPL India | IIT Delhi Incubated</p>
              <p>Structural Health Monitoring Excellence</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  
  try {
    // Use SendGrid HTTP API directly (SMTP ports blocked on Render)
    const msg = {
      to: email,
      from: {
        email: process.env.EMAIL_FROM || 'admin@spplindia.org',
        name: 'SPPL India - OSHAS'
      },
      subject: 'OSHAS - Email Verification Code',
      html: htmlContent
    };
    
    await sgMail.send(msg);
    console.log('✅ Verification email sent via HTTP API to:', email);
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending verification email:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send assessment completion email to user (Marketing focused - no PDF attachment)
 */
async function sendAssessmentCompletionEmail(userDetails, assessmentType, pdfBuffer) {
  try {
    // Use SendGrid HTTP API directly (SMTP ports blocked on Render)
    const msg = {
      to: userDetails.email,
      from: {
        email: process.env.EMAIL_FROM || 'admin@spplindia.org',
        name: 'Sanrachna Prahari Pvt Ltd - OSHAS'
      },
      subject: `🎉 Thank You for Completing Your ${assessmentType} Assessment | Sanrachna Prahari`,
      html: generateEmailHTML(userDetails, assessmentType)
    };
    
    await sgMail.send(msg);
    console.log('✅ Email sent via SendGrid HTTP API to:', userDetails.email);
    return { success: true };
    
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Generate professional HTML email template (Marketing focused, no report)
 */
function generateEmailHTML(userDetails, assessmentType) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa; }
    .container { max-width: 650px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 50px 30px 40px; text-align: center; position: relative; }
    .logo-container { margin-bottom: 30px; text-align: center; }
    .logo { max-width: 200px; height: auto; display: inline-block; }
    .header h1 { color: #ffffff; margin: 20px 0 10px 0; font-size: 32px; font-weight: 700; line-height: 1.3; }
    .header .subtitle { color: #e0e7ff; margin: 8px 0 0 0; font-size: 15px; font-style: italic; font-weight: 300; }
    .content { padding: 45px 40px; color: #333333; line-height: 1.8; }
    .greeting { font-size: 22px; font-weight: 600; color: #1e3a8a; margin-bottom: 25px; }
    .message { font-size: 16px; margin-bottom: 25px; color: #4b5563; line-height: 1.8; }
    .highlight-box { background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%); border-left: 6px solid #3b82f6; padding: 30px; margin: 35px 0; border-radius: 12px; box-shadow: 0 2px 10px rgba(59,130,246,0.1); }
    .highlight-box h3 { margin: 0 0 20px 0; color: #1e3a8a; font-size: 20px; font-weight: 700; }
    .highlight-box p { margin: 15px 0; line-height: 1.8; color: #374151; }
    .highlight-box strong { color: #1e3a8a; font-weight: 600; }
    .cta-container { text-align: center; margin: 45px 0; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%); color: #ffffff !important; padding: 18px 45px; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 16px; margin: 12px 8px; box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4); transition: all 0.3s; }
    .cta-button:hover { transform: translateY(-3px); box-shadow: 0 8px 25px rgba(59, 130, 246, 0.5); }
    .social-section { background: #f9fafb; padding: 35px 30px; border-radius: 12px; margin: 40px 0; text-align: center; }
    .social-section h4 { margin: 0 0 15px 0; color: #1e3a8a; font-size: 20px; font-weight: 700; }
    .social-section p { color: #6b7280; margin: 0 0 25px 0; font-size: 15px; line-height: 1.6; }
    .social-links { display: flex; justify-content: center; align-items: center; gap: 15px; flex-wrap: wrap; margin: 25px 0; }
    .social-link { display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 14px 28px; background: #ffffff; border: 2px solid #3b82f6; border-radius: 10px; text-decoration: none; color: #1e3a8a; font-weight: 600; font-size: 15px; transition: all 0.3s; }
    .social-link:hover { background: #3b82f6; color: #ffffff; transform: scale(1.05); border-color: #1e3a8a; }
    .contact-info { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 40px 35px; border-radius: 12px; margin: 40px 0; }
    .contact-info h4 { margin: 0 0 30px 0; color: #ffffff; font-size: 22px; font-weight: 700; text-align: center; }
    .contact-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .contact-item { background: rgba(255, 255, 255, 0.15); padding: 25px; border-radius: 10px; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); }
    .contact-item-title { font-weight: 700; color: #e0e7ff; font-size: 13px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .contact-item-content { font-size: 15px; line-height: 1.8; color: #ffffff; }
    .contact-item a { color: #ffffff; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,0.4); padding-bottom: 2px; transition: all 0.3s; }
    .contact-item a:hover { border-bottom-color: #ffffff; }
    .footer { background-color: #1e3a8a; color: #e0e7ff; padding: 40px 30px; text-align: center; font-size: 14px; }
    .footer-company { font-weight: 700; font-size: 18px; color: #ffffff; margin-bottom: 8px; }
    .footer-tagline { font-style: italic; margin-bottom: 20px; color: #bfdbfe; font-size: 14px; }
    .footer-links { margin: 20px 0; }
    .footer-links a { color: #60a5fa; text-decoration: none; margin: 0 10px; font-size: 13px; }
    .footer-links a:hover { color: #93c5fd; }
    .divider { height: 2px; background: linear-gradient(to right, transparent, #cbd5e1, transparent); margin: 40px 0; }
    .feature-list { background: #ffffff; padding: 25px; border-radius: 10px; margin: 30px 0; border: 2px solid #e5e7eb; }
    .feature-list p { display: flex; align-items: center; margin: 12px 0; font-size: 14px; color: #374151; }
    .feature-list p::before { content: "✓"; color: #10b981; font-weight: bold; margin-right: 12px; font-size: 18px; }
    @media (max-width: 600px) {
      .content { padding: 30px 25px; }
      .header { padding: 40px 20px 30px; }
      .header h1 { font-size: 26px; }
      .logo { max-width: 160px; }
      .cta-button { padding: 15px 30px; margin: 10px 5px; font-size: 15px; display: block; }
      .social-links { flex-direction: column; }
      .social-link { width: 100%; justify-content: center; }
      .contact-grid { grid-template-columns: 1fr; }
      .contact-info { padding: 30px 20px; }
      .highlight-box { padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Main Content -->
    <div class="content">
      <div class="greeting">Dear ${userDetails.name},</div>
      
      <div class="message" style="text-align: justify;">
        Thank you for completing your Building Assessment Questionnaire on the Sanrachna Prahari website. 
                Our team of subject matter experts, from IIT Delhi, is reviewing your submission and will share 
                a detailed report within the next 24–48 hours.
      </div>
      
      <!-- Logo Block -->
      <div style="text-align: center; margin: 30px 0; padding: 30px; background: linear-gradient(135deg, #f8fafc 0%, #e0e7ff 100%); border-radius: 12px;">
        <img src="https://www.spplindia.org/PhotoshopPreview_Image.png" alt="Sanrachna Prahari Pvt Ltd" style="max-width: 200px; height: auto; margin-bottom: 20px;">
        <p style="font-size: 18px; font-weight: 600; color: #1e3a8a; margin: 0;">Thank you for choosing our services.</p>
      </div>
      
      <!-- Nature of Expertise intentionally omitted from client email -->
      
      <!-- Highlight Box -->
      <div class="highlight-box">
        <h3>What's Next?</h3>
        <p style="text-align: justify;"><strong>📋 Expert Review:</strong> Our structural engineers from IIT Delhi are carefully analysing your building data to assess overall structural health and identify potential issues.</p>
        <p style="text-align: justify;"><strong>🔧 Possible Remedial Actions:</strong> Based on the assessment findings, we may recommend appropriate repair, strategy or preventive maintenance measures to ensure safety and longevity of Building Infrastructure.</p>
        <p style="text-align: justify;"><strong>💡 Free Consultation:</strong> Schedule a complimentary consultation call with our experts to discuss the report findings and next steps.</p>
      </div>
      
      <!-- Resources Section -->
      <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; text-align: center;">
        <h4 style="color: #1e3a8a; margin-bottom: 20px; font-size: 16px;">📚 Learn More About Our Services</h4>
        <div style="margin-bottom: 20px;">
          <a href="https://drive.google.com/file/d/1_1nh_rnukwkHG7hsWiZAIEnpNIs97Fbw/view?usp=sharing" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; display: inline-block; margin: 8px; min-width: 200px;">
            📄 Company Flyer
          </a>
          <a href="https://drive.google.com/file/d/1tRqBqFMRw0aUEEQEnubzC_3cfLNPt64J/view?usp=sharing" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; display: inline-block; margin: 8px; min-width: 200px;">
            📋 Company Profile
          </a>
        </div>
      </div>
      
      <!-- Call to Action Buttons -->
      <div class="cta-container">
        <a href="https://www.spplindia.org" class="cta-button" style="text-decoration: none; color: #ffffff;">
          Visit Website
        </a>
        <a href="https://www.spplindia.org/contact/client" class="cta-button" style="text-decoration: none; color: #ffffff;">
          Book Consultation
        </a>
      </div>
      
      <div class="divider"></div>
      
      <!-- Contact Information -->
      <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 25px; border-radius: 12px; margin: 30px 0;">
        <h4 style="margin: 0 0 20px 0; color: #ffffff; font-size: 18px; text-align: center;">📍 Contact Us</h4>
        <div style="font-size: 14px; line-height: 1.8; text-align: center;">
          <p style="margin: 10px 0;"><strong>Sanrachna Prahari Private Limited (SPPL India)</strong></p>
          <p style="margin: 10px 0;"><strong>Registered Office:</strong> A-403, Mapsko Mountville, Sector-79, Gurgaon (Haryana) – 122004</p>
          <p style="margin: 10px 0;"><strong>Head Office:</strong> 2-A-2A, Second Floor, R & I Park, IIT Delhi, New Delhi-110016</p>
          <p style="margin: 10px 0;">📞 <a href="tel:+919013933333" style="color: #ffffff; text-decoration: underline;">+91 9013933333</a> | 📧 <a href="mailto:office@spplindia.org" style="color: #ffffff; text-decoration: underline;">office@spplindia.org</a></p>
          <p style="margin: 10px 0;">🌐 <a href="https://www.spplindia.org" style="color: #ffffff; text-decoration: underline;">www.spplindia.org</a></p>
        </div>
      </div>
    </div>
    
    <!-- Signature -->
    <div style="padding: 30px 40px 40px; text-align: left;">
      <p style="margin: 0 0 5px 0; font-size: 16px; color: #1e3a8a; font-weight: 600;">Warm regards,</p>
      <p style="margin: 0; font-size: 16px; color: #1e3a8a; font-weight: 600;">SPPL India</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send contact form submission email to admin
 */
async function sendContactFormEmail(formData) {
  try {
    const transporter = createTransporter();
    
    const adminEmail = 'sanrachnaprahari@gmail.com';
    
    // Determine form type label
    const formTypeLabels = {
      client: 'Client Inquiry',
      partnership: 'Partnership Inquiry', 
      organisation: 'Organisation Inquiry'
    };
    const formTypeLabel = formTypeLabels[formData.formType] || 'General Inquiry';
    
    const mailOptions = {
      from: {
        name: 'SPPL Contact Form',
        address: process.env.EMAIL_USER || 'sanrachnaprahari@gmail.com'
      },
      to: adminEmail,
      replyTo: formData.email,
      subject: `📩 New ${formTypeLabel} from ${formData.fullName}`,
      html: generateContactFormEmailHTML(formData, formTypeLabel)
    };
    
    const info = await transporter.sendMail(mailOptions);
    console.log('Contact form email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('Error sending contact form email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate contact form email HTML
 */
function generateContactFormEmailHTML(formData, formTypeLabel) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f4f4; margin: 0; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 30px; }
    .info-row { display: flex; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; }
    .info-label { font-weight: bold; min-width: 180px; color: #555; }
    .info-value { color: #333; word-break: break-word; }
    .message-box { background: #f8fafc; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; }
    .footer { background: #f8fafc; padding: 20px; text-align: center; color: #666; font-size: 13px; }
    .badge { display: inline-block; padding: 5px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; background: #dbeafe; color: #1e40af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header" style="text-align:center;">
      <div style="margin-bottom:12px;">
        <img src="https://www.spplindia.org/PhotoshopPreview_Image.png" alt="SPPL" style="max-width:180px;height:auto;display:inline-block;" />
      </div>
      <h1>📩 ${formTypeLabel}</h1>
      <p style="margin: 10px 0 0 0; font-size: 14px;">SPPL Contact Form Submission</p>
    </div>
    
    <div class="content">
      <div style="margin-bottom: 20px;">
        <span class="badge">${formData.formType.toUpperCase()}</span>
        <span style="margin-left: 10px; color: #666;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
      </div>
      
      <h3 style="color: #1e3a8a; margin-bottom: 15px;">Contact Information</h3>
      
      ${formData.title ? `
      <div class="info-row">
        <div class="info-label">Title:</div>
        <div class="info-value">${formData.title}</div>
      </div>` : ''}
      
      <div class="info-row">
        <div class="info-label">Full Name:</div>
        <div class="info-value">${formData.fullName}</div>
      </div>
      
      ${formData.company ? `
      <div class="info-row">
        <div class="info-label">Company/Organisation:</div>
        <div class="info-value">${formData.company}</div>
      </div>` : ''}
      
      ${formData.position ? `
      <div class="info-row">
        <div class="info-label">Position:</div>
        <div class="info-value">${formData.position}</div>
      </div>` : ''}
      
      <div class="info-row">
        <div class="info-label">Email:</div>
        <div class="info-value"><a href="mailto:${formData.email}">${formData.email}</a></div>
      </div>
      
      ${formData.phone ? `
      <div class="info-row">
        <div class="info-label">Phone:</div>
        <div class="info-value"><a href="tel:${formData.phone}">${formData.phone}</a></div>
      </div>` : ''}
      
      ${formData.altEmail ? `
      <div class="info-row">
        <div class="info-label">Alternate Email:</div>
        <div class="info-value"><a href="mailto:${formData.altEmail}">${formData.altEmail}</a></div>
      </div>` : ''}
      
      ${formData.projectType ? `
      <div class="info-row">
        <div class="info-label">Project Type:</div>
        <div class="info-value">${formData.projectType}</div>
      </div>` : ''}
      
      ${formData.serviceInquiry ? `
      <div class="info-row">
        <div class="info-label">Service Inquiry:</div>
        <div class="info-value">${formData.serviceInquiry}</div>
      </div>` : ''}
      
      ${formData.projectLocation ? `
      <div class="info-row">
        <div class="info-label">Project Location:</div>
        <div class="info-value">${formData.projectLocation}</div>
      </div>` : ''}
      
      ${formData.budgetRange ? `
      <div class="info-row">
        <div class="info-label">Budget Range:</div>
        <div class="info-value">${formData.budgetRange}</div>
      </div>` : ''}
      
      ${formData.contactMethod ? `
      <div class="info-row">
        <div class="info-label">Preferred Contact Method:</div>
        <div class="info-value">${formData.contactMethod}</div>
      </div>` : ''}
      
      ${formData.partnershipType ? `
      <div class="info-row">
        <div class="info-label">Partnership Type:</div>
        <div class="info-value">${formData.partnershipType}</div>
      </div>` : ''}
      
      ${formData.organisationType ? `
      <div class="info-row">
        <div class="info-label">Organisation Type:</div>
        <div class="info-value">${formData.organisationType}</div>
      </div>` : ''}
      
      ${formData.query ? `
      <h3 style="color: #1e3a8a; margin: 25px 0 15px 0;">Message / Query</h3>
      <div class="message-box">
        ${formData.query.replace(/\n/g, '<br>')}
      </div>` : ''}
      
      <div style="margin-top: 30px; padding: 15px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
        <strong>⚠️ Action Required:</strong> Please respond to this inquiry at your earliest convenience.
      </div>
    </div>
    
    <div class="footer">
      <p style="margin: 0;"><strong>Sanrachna Prahari Pvt Ltd - Contact Form System</strong></p>
      <p style="margin: 5px 0 0 0;">Reply directly to this email to contact: ${formData.email}</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send admin notification email with assessment details and PDF attachment
 */
async function sendAdminNotificationEmail(userDetails, assessmentType, reportText, pdfBuffer, assessmentId) {
  try {
    // Try SMTP first
    const transporter = createTransporter();
    
    // Admin email address
    const adminEmail = 'sanrachnaprahari@gmail.com';
    
    // Create attachment from PDF buffer
    const attachments = [];
    if (pdfBuffer) {
      const buffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer, 'base64');
      attachments.push({
        filename: `Assessment_Report_${userDetails.name.replace(/\s+/g, '_')}_${Date.now()}.pdf`,
        content: buffer,
        contentType: 'application/pdf'
      });
    }
    
    const mailOptions = {
      from: {
        name: 'OSHAS Portal - Admin Notification',
        address: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'sanrachnaprahari@gmail.com'
      },
      to: adminEmail,
      subject: `🔔 New ${assessmentType} Assessment Submitted - ${userDetails.name}`,
      html: generateAdminEmailHTML(userDetails, assessmentType, reportText, assessmentId),
      attachments: attachments
    };
    
    const info = await transporter.sendMail(mailOptions);
    console.log('Admin notification email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('SMTP admin email failed, trying HTTP API fallback:', error.message);
    
    // Fallback to SendGrid HTTP API if SMTP fails
    try {
      const msg = {
        to: 'sanrachnaprahari@gmail.com',
        from: {
          email: process.env.EMAIL_FROM || 'admin@spplindia.org',
          name: 'OSHAS Portal - Admin Notification'
        },
        subject: `🔔 New ${assessmentType} Assessment Submitted - ${userDetails.name}`,
        html: generateAdminEmailHTML(userDetails, assessmentType, reportText, assessmentId)
      };
      
      // Add PDF attachment if exists
      if (pdfBuffer) {
        const buffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer, 'base64');
        msg.attachments = [{
          content: buffer.toString('base64'),
          filename: `Assessment_Report_${userDetails.name.replace(/\s+/g, '_')}_${Date.now()}.pdf`,
          type: 'application/pdf',
          disposition: 'attachment'
        }];
      }
      
      await sgMail.send(msg);
      console.log('✅ Admin email sent via SendGrid HTTP API');
      return { success: true, method: 'http-api' };
      
    } catch (httpError) {
      console.error('HTTP API admin email also failed:', httpError.message);
      return { success: false, error: httpError.message };
    }
  }
}

/**
 * Generate admin notification email HTML
 */
function generateAdminEmailHTML(userDetails, assessmentType, reportText, assessmentId) {
  const reportPreview = reportText ? (reportText.length > 500 ? reportText.substring(0, 500) + '...' : reportText) : 'No report text available';

  // Helper to escape HTML so raw report text can be safely embedded in the email
  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const fullReportEscaped = escapeHtml(reportText || 'No report text available');
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f4f4; margin: 0; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 30px; }
    .info-section { margin-bottom: 25px; }
    .info-section h2 { color: #1e3a8a; font-size: 18px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 5px; }
    .info-row { display: flex; margin-bottom: 10px; }
    .info-label { font-weight: bold; min-width: 150px; color: #555; }
    .info-value { color: #333; }
    .report-preview { background: #f8fafc; border-left: 4px solid #3b82f6; padding: 15px; margin: 15px 0; font-family: monospace; font-size: 13px; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
    .footer { background: #f8fafc; padding: 20px; text-align: center; color: #666; font-size: 13px; }
    .badge { display: inline-block; padding: 5px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-info { background: #dbeafe; color: #1e40af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header" style="text-align:center;">
      <div style="margin-bottom:12px;">
        <img src="https://www.spplindia.org/PhotoshopPreview_Image.png" alt="SPPL" style="max-width:180px;height:auto;display:inline-block;" />
      </div>
      <h1>🔔 New Assessment Submission</h1>
      <p style="margin: 10px 0 0 0; font-size: 14px;">OSHAS Portal - ${assessmentType} Assessment</p>
    </div>
    
    <div class="content">
      <div class="info-section">
        <h2>📋 Assessment Details</h2>
        <div class="info-row">
          <div class="info-label">Assessment ID:</div>
          <div class="info-value"><code>${assessmentId || 'N/A'}</code></div>
        </div>
        <div class="info-row">
          <div class="info-label">Assessment Type:</div>
          <div class="info-value"><span class="badge badge-info">${assessmentType}</span></div>
        </div>
        <div class="info-row">
          <div class="info-label">Submission Date:</div>
          <div class="info-value">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Status:</div>
          <div class="info-value"><span class="badge badge-success">Completed</span></div>
        </div>
      </div>
      
      <div class="info-section">
        <h2>👤 Client Information</h2>
        <div class="info-row">
          <div class="info-label">Name:</div>
          <div class="info-value">${userDetails.name || 'N/A'}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Email:</div>
          <div class="info-value"><a href="mailto:${userDetails.email}">${userDetails.email || 'N/A'}</a></div>
        </div>
        <div class="info-row">
          <div class="info-label">Phone:</div>
          <div class="info-value"><a href="tel:${userDetails.phone}">${userDetails.phone || 'N/A'}</a></div>
        </div>
        ${userDetails.q1 ? `
        <div class="info-row">
          <div class="info-label">Nature of Expertise:</div>
          <div class="info-value">${userDetails.q1}${userDetails.q1Other ? ` - ${userDetails.q1Other}` : ''}</div>
        </div>
        ` : ''}
        <div class="info-row">
          <div class="info-label">Organization:</div>
          <div class="info-value">${userDetails.organization || 'N/A'}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Location:</div>
          <div class="info-value">${userDetails.location || 'N/A'}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Structure Type:</div>
          <div class="info-value">${userDetails.structureType || assessmentType}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Year of Construction:</div>
          <div class="info-value">${userDetails.yearOfConstruction || 'N/A'}</div>
        </div>
      </div>
      
      <div class="info-section">
        <h2>📄 Report Preview</h2>
        <div class="report-preview">${reportPreview}</div>
        <p style="margin-top: 10px; font-size: 13px; color: #666;">
          <strong>Note:</strong> Full detailed report is attached as PDF to this email (if available). If the PDF could not be attached, the full AI analysis is available below in plain text.
        </p>
      </div>

      <div class="info-section">
        <h2>📎 Attachments</h2>
        <p style="margin: 0;">✅ Assessment Report PDF attached to this email (when available)</p>
      </div>

      <div class="info-section">
        <h2>🗒️ Full AI Report (Plain Text)</h2>
        <div style="background:#f8fafc;border-left:4px solid #3b82f6;padding:12px;border-radius:6px;max-height:420px;overflow:auto;font-family:monospace;font-size:12px;white-space:pre-wrap;">${fullReportEscaped}</div>
      </div>
    </div>
    
    <div class="footer">
      <p style="margin: 0;"><strong>Sanrachna Prahari Pvt Ltd - OSHAS Portal</strong></p>
      <p style="margin: 5px 0 0 0;">Automated Admin Notification System</p>
    </div>
  </div>
</body>
</html>
  `;
}

// Export all email functions
module.exports = {
  sendVerificationEmail,
  sendAssessmentCompletionEmail,
  sendAdminNotificationEmail,
  sendContactFormEmail
};
