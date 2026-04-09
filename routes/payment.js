const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const https = require('https');
const mongoose = require('mongoose');
const geoip = require('geoip-lite');
const Payment = require('../models/Payment');
const User = require('../models/User');
const router = express.Router();

const COUNTRY_CODE_MAP = {
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  SG: 'Singapore',
  AE: 'UAE'
};

// Currency pricing map by assessment level (in smallest units)
const CURRENCY_PRICING = {
  basic: {
    INR: 50000, // ₹500 (in paise)
    USD: 1000   // $10 (in cents)
  },
  advanced: {
    INR: 250000, // ₹2500 (in paise)
    USD: 5000   // $50 (in cents)
  }
};

const normalizeAssessmentLevel = (value) => {
  return String(value || 'basic').toLowerCase() === 'advanced' ? 'advanced' : 'basic';
};

const normalizeStructureType = (value) => {
  const input = String(value || '').trim();
  if (!input) {
    return null;
  }

  const normalized = input.toLowerCase();
  const mapping = {
    'rcc structure': 'RCC Structure',
    'rcc frame structure': 'RCC Structure',
    'steel structure': 'Steel Structure',
    'load bearing masonry': 'Load Bearing Masonry',
    'composite structure': 'Composite Structure (RCC + Steel)',
    'composite structure (rcc + steel)': 'Composite Structure (RCC + Steel)',
    'heritage structure': 'Heritage Structure',
    'tunnel': 'Tunnel',
    'bridge': 'Bridge'
  };

  return mapping[normalized] || input;
};

const getDisplayAmount = (currency, amount) => {
  if (currency === 'INR') {
    return `₹${amount / 100}`;
  }
  if (currency === 'USD') {
    return `$${(amount / 100).toFixed(0)}`;
  }
  return `${amount} ${currency}`;
};

// Helper: extract IP from request (handles proxies)
function getClientIP(req) {
  console.log('\n🔍 IP Detection Debug:');
  console.log('  Headers:', {
    'x-client-ip': req.headers['x-client-ip'],
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'x-real-ip': req.headers['x-real-ip'],
    'remoteAddress': req.connection?.remoteAddress,
    'req.ip': req.ip
  });

  const clientIpHeader = req.headers['x-client-ip'];
  if (clientIpHeader) {
    const ip = String(clientIpHeader).split(',')[0].trim();
    console.log('  ✅ Using x-client-ip:', ip);
    return ip;
  }
  
  // Check for common proxy headers
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = forwarded.split(',')[0].trim();
    console.log('  ✅ Using x-forwarded-for:', ip);
    return ip;
  }
  
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    console.log('  ✅ Using x-real-ip:', realIp);
    return realIp;
  }
  
  const remoteAddr = req.connection?.remoteAddress || req.ip;
  console.log('  ✅ Using remoteAddress/req.ip:', remoteAddr);
  return remoteAddr;
}

function isLocalOrPrivateIP(ip) {
  if (!ip) {
    return true;
  }

  const cleanIP = ip.replace(/^::ffff:/, '');
  const octets = cleanIP.split('.').map(Number);
  const is172Private = octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;

  if (cleanIP === '127.0.0.1' || cleanIP === '::1') {
    return true;
  }

  if (cleanIP.startsWith('10.') || cleanIP.startsWith('192.168.') || is172Private) {
    return true;
  }

  return false;
}

function fetchPublicIP() {
  return new Promise((resolve) => {
    const req = https.get('https://api64.ipify.org?format=json', { timeout: 3500 }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          resolve(parsed.ip || null);
        } catch (error) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 4500 }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(data || '{}'));
        } catch (error) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function mapCountryCodeToName(code) {
  if (!code) {
    return null;
  }

  const normalized = String(code).trim().toUpperCase();
  return COUNTRY_CODE_MAP[normalized] || normalized;
}

async function detectCountryFromExternalService(ip) {
  const encodedIP = encodeURIComponent(ip);

  const ipApiResult = await fetchJson(`https://ipapi.co/${encodedIP}/json/`);
  if (ipApiResult) {
    const countryFromName = ipApiResult.country_name;
    const countryFromCode = mapCountryCodeToName(ipApiResult.country);
    if (countryFromName || countryFromCode) {
      return countryFromName || countryFromCode;
    }
  }

  const ipWhoResult = await fetchJson(`https://ipwho.is/${encodedIP}`);
  if (ipWhoResult && ipWhoResult.success && ipWhoResult.country) {
    return ipWhoResult.country;
  }

  return null;
}

// Helper: detect country from IP address
async function detectCountryFromIP(ip) {
  console.log('\n🌍 Country Detection Debug:');
  console.log('  Raw IP:', ip);
  
  if (!ip) {
    console.log('  ❌ No IP provided');
    return null;
  }
  
  // Remove IPv6 prefix if present (::ffff:)
  const cleanIP = ip.replace(/^::ffff:/, '');
  console.log('  Cleaned IP:', cleanIP);
  
  if (isLocalOrPrivateIP(cleanIP)) {
    console.log('  ⚠️ Local/private IP detected; skipping GeoIP for this address');
    return null;
  }

  console.log('  🔎 Looking up country using external IP geolocation...');
  const externalCountry = await detectCountryFromExternalService(cleanIP);
  if (externalCountry) {
    console.log('  ✅ Country detected via external service:', externalCountry);
    return externalCountry;
  }
  
  console.log('  🔎 External lookup failed, trying local geoip database...');
  const geo = geoip.lookup(cleanIP);
  console.log('  GeoIP result:', geo);
  
  if (geo && geo.country) {
    const countryName = mapCountryCodeToName(geo.country);
    console.log('  ✅ Country detected:', countryName, `(${geo.country})`);
    return countryName;
  }
  
  console.log('  ❌ Could not detect country from IP:', cleanIP);
  return null;
}

// Helper: determine country/currency decision from IP and profile fallback
async function getCurrencyDecision(user, req) {
  console.log('\n💰 Currency Determination:');
  
  // Priority 1: Try IP-based detection first
  if (req) {
    let clientIP = getClientIP(req);
    let detectedCountry = await detectCountryFromIP(clientIP);

    // Local development often resolves to localhost/private IP.
    // In that case, resolve public egress IP so VPN geolocation can be honored.
    if (!detectedCountry && isLocalOrPrivateIP(clientIP)) {
      const publicIP = await fetchPublicIP();
      if (publicIP) {
        console.log('  🌐 Resolved public IP for geolocation:', publicIP);
        clientIP = publicIP;
        detectedCountry = await detectCountryFromIP(clientIP);
      } else {
        console.log('  ⚠️ Public IP lookup failed; continuing to fallback logic');
      }
    }
    
    if (detectedCountry) {
      const currency = (detectedCountry === 'India') ? 'INR' : 'USD';
      console.log('  ✅ FINAL DECISION: Currency from IP:', currency);
      console.log('  📍 Country:', detectedCountry);
      console.log('  💵 Currency selected from country:', currency);
      return { country: detectedCountry, currency, source: 'ip' };
    }
  }
  
  // Priority 2: Use user's saved country from profile
  if (user && user.country) {
    const currency = (user.country === 'India') ? 'INR' : 'USD';
    console.log('  ⚠️ Using profile country (IP failed):', currency);
    return { country: user.country, currency, source: 'profile' };
  }
  
  // Priority 3: Default to INR
  console.log('  ⚠️ Using default currency: INR');
  return { country: 'India', currency: 'INR', source: 'default' };
}

async function getCurrencyForUser(user, req) {
  const decision = await getCurrencyDecision(user, req);
  return decision.currency;
}

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Middleware to authenticate user (passed from server.js)
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
  
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

// Create Razorpay Order
router.post('/create-order', authenticateToken, async (req, res) => {
  try {
    const { assessmentId, assessmentLevel, structureType } = req.body;
    const level = normalizeAssessmentLevel(assessmentLevel || (assessmentId ? 'advanced' : 'basic'));
    const normalizedStructureType = normalizeStructureType(structureType);

    // Fetch user details to determine currency
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Determine currency and amount based on IP + user's country
    const currencyDecision = await getCurrencyDecision(user, req);
    const currency = currencyDecision.currency;
    const amount = CURRENCY_PRICING[level][currency];
    const displayAmount = getDisplayAmount(currency, amount);
    
    console.log('\n📦 ORDER SUMMARY:');
    console.log('  User:', user.email);
    console.log('  Assessment ID:', assessmentId || 'N/A');
    console.log('  Level:', level);
    console.log('  Currency:', currency);
    console.log('  Amount:', amount, `(${displayAmount})`);
    console.log('  Display:', displayAmount);
    console.log('  Country decision:', currencyDecision.country, `(source=${currencyDecision.source})`);
    console.log('=' .repeat(60) + '\n');
    
    const options = {
      amount: amount,
      currency: currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        userId: req.user.userId,
        userEmail: req.user.email,
        country: currencyDecision.country,
        assessmentLevel: level,
        assessmentId: assessmentId || '',
        structureType: normalizedStructureType || ''
      }
    };
    
    const order = await razorpay.orders.create(options);
    
    // Save payment record in database — bind to specific assessment
    const paymentData = {
      userId: new mongoose.Types.ObjectId(req.user.userId),
      userEmail: req.user.email,
      razorpayOrderId: order.id,
      amount: amount,
      currency: currency,
      status: 'created',
      metadata: {
        country: currencyDecision.country,
        assessmentLevel: level,
        structureType: normalizedStructureType
      }
    };
    if (assessmentId) {
      paymentData.assessmentId = new mongoose.Types.ObjectId(assessmentId);
    }
    const payment = new Payment(paymentData);
    
    await payment.save();
    
    res.json({
      success: true,
      orderId: order.id,
      amount: amount,
      currency: currency,
      displayAmount: displayAmount,
      assessmentLevel: level,
      keyId: process.env.RAZORPAY_KEY_ID,
      prefill: {
        email: user.email || '',
        // Keep contact blank to prevent stale or region-mismatched phone from being injected into checkout.
        contact: ''
      }
    });
    
  } catch (error) {
    console.error('❌ Error creating Razorpay order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message
    });
  }
});

// Verify Payment
router.post('/verify-payment', authenticateToken, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;
    
    console.log('\n🔐 PAYMENT VERIFICATION:');
    console.log('  Order ID:', razorpay_order_id);
    console.log('  Payment ID:', razorpay_payment_id);
    console.log('  Signature:', razorpay_signature ? 'Received' : 'Missing');
    
    // Create signature to verify
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');
    
    const isAuthentic = expectedSignature === razorpay_signature;
    console.log('  Signature Match:', isAuthentic ? '✅ YES' : '❌ NO');
    
    if (isAuthentic) {
      // Update payment record
      const payment = await Payment.findOne({
        razorpayOrderId: razorpay_order_id,
        userId: new mongoose.Types.ObjectId(req.user.userId)
      });
      
      if (!payment) {
        console.log('  ❌ Payment record not found for authenticated user');
        return res.status(403).json({
          success: false,
          message: 'Payment record does not belong to authenticated user'
        });
      }
      
      payment.razorpayPaymentId = razorpay_payment_id;
      payment.razorpaySignature = razorpay_signature;
      payment.status = 'success';
      payment.paidAt = new Date();
      
      await payment.save();
      
      console.log('  ✅ Payment verified and saved successfully');
      console.log('  💾 Payment ID:', payment._id);
      console.log('=' .repeat(60) + '\n');
      
      res.json({
        success: true,
        message: 'Payment verified successfully',
        paymentId: payment._id
      });
    } else {
      // Update payment as failed
      const payment = await Payment.findOne({
        razorpayOrderId: razorpay_order_id,
        userId: new mongoose.Types.ObjectId(req.user.userId)
      });
      if (payment) {
        payment.status = 'failed';
        await payment.save();
      }
      
      console.log('  ❌ Signature verification failed');
      console.log('=' .repeat(60) + '\n');
      
      res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }
    
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Payment verification error',
      error: error.message
    });
  }
});

// Get currency and pricing info (without creating order)
router.get('/currency-info', authenticateToken, async (req, res) => {
  try {
    const level = normalizeAssessmentLevel(req.query.assessmentLevel);
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const currency = await getCurrencyForUser(user, req);
    const amount = CURRENCY_PRICING[level][currency];
    const displayAmount = getDisplayAmount(currency, amount);
    
    res.json({
      success: true,
      assessmentLevel: level,
      currency: currency,
      amount: amount,
      displayAmount: displayAmount
    });
    
  } catch (error) {
    console.error('❌ Error fetching currency info:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching currency information',
      error: error.message
    });
  }
});

// Check if user has available payment for a specific assessment
router.get('/check-available', authenticateToken, async (req, res) => {
  try {
    const { assessmentId, assessmentLevel, structureType } = req.query;
    const level = assessmentLevel ? normalizeAssessmentLevel(assessmentLevel) : null;
    const normalizedStructureType = normalizeStructureType(structureType);

    let query = {
      userId: new mongoose.Types.ObjectId(req.user.userId),
      status: 'success',
      assessmentUsed: false
    };

    // Optional level filter: allows callers to enforce per-level payment usage.
    if (level) {
      if (level === 'basic') {
        query.$or = [
          { 'metadata.assessmentLevel': 'basic' },
          { 'metadata.assessmentLevel': { $exists: false } }
        ];
      } else {
        query['metadata.assessmentLevel'] = level;
      }
    }

    // If assessmentId provided, check payment specifically for that assessment
    if (assessmentId) {
      query.assessmentId = new mongoose.Types.ObjectId(assessmentId);
    }

    if (level === 'basic' && normalizedStructureType) {
      query['metadata.structureType'] = normalizedStructureType;
    }

    let availablePayment = await Payment.findOne(query).sort({ paidAt: -1 });

    // Backward compatibility: older basic payments may not have structureType metadata.
    // Bind such a payment to the first requested structure to enforce one-payment-one-structure.
    if (!availablePayment && level === 'basic' && normalizedStructureType) {
      const legacyQuery = {
        userId: new mongoose.Types.ObjectId(req.user.userId),
        status: 'success',
        assessmentUsed: false,
        $or: [
          { 'metadata.structureType': { $exists: false } },
          { 'metadata.structureType': null },
          { 'metadata.structureType': '' }
        ]
      };

      legacyQuery.$and = [
        {
          $or: [
            { 'metadata.assessmentLevel': 'basic' },
            { 'metadata.assessmentLevel': { $exists: false } }
          ]
        }
      ];

      if (assessmentId) {
        legacyQuery.assessmentId = new mongoose.Types.ObjectId(assessmentId);
      }

      const legacyPayment = await Payment.findOne(legacyQuery).sort({ paidAt: -1 });
      if (legacyPayment) {
        legacyPayment.metadata = {
          ...(legacyPayment.metadata || {}),
          assessmentLevel: legacyPayment.metadata?.assessmentLevel || 'basic',
          structureType: normalizedStructureType
        };
        await legacyPayment.save();
        availablePayment = legacyPayment;
      }
    }
    
    res.json({
      success: true,
      hasAvailablePayment: !!availablePayment,
      payment: availablePayment ? {
        id: availablePayment._id,
        amount: availablePayment.amount,
        paidAt: availablePayment.paidAt,
        structureType: availablePayment.metadata?.structureType || null
      } : null
    });
    
  } catch (error) {
    console.error('❌ Error checking payment availability:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking payment status',
      error: error.message
    });
  }
});

// Get payment history for user
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const payments = await Payment.find({ userId: new mongoose.Types.ObjectId(req.user.userId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('-razorpaySignature -__v');
    
    res.json({
      success: true,
      payments
    });
    
  } catch (error) {
    console.error('❌ Error fetching payment history:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment history',
      error: error.message
    });
  }
});

// Mark payment as used (called after assessment submission)
router.post('/mark-used', authenticateToken, async (req, res) => {
  try {
    const { assessmentId, assessmentType, assessmentLevel, structureType } = req.body;
    const level = assessmentLevel ? normalizeAssessmentLevel(assessmentLevel) : null;
    const normalizedStructureType = normalizeStructureType(structureType);
    
    // Find the most recent available payment for this user
    const query = {
      userId: new mongoose.Types.ObjectId(req.user.userId),
      status: 'success',
      assessmentUsed: false
    };

    if (level) {
      if (level === 'basic') {
        query.$or = [
          { 'metadata.assessmentLevel': 'basic' },
          { 'metadata.assessmentLevel': { $exists: false } }
        ];
      } else {
        query['metadata.assessmentLevel'] = level;
      }
    }

    if (level === 'basic' && normalizedStructureType) {
      query['metadata.structureType'] = normalizedStructureType;
    }

    const payment = await Payment.findOne(query).sort({ paidAt: -1 });
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'No available payment found'
      });
    }
    
    await payment.markAsUsed(assessmentId, assessmentType);
    
    res.json({
      success: true,
      message: 'Payment marked as used',
      payment: {
        id: payment._id,
        usedAt: payment.usedAt
      }
    });
    
  } catch (error) {
    console.error('❌ Error marking payment as used:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating payment status',
      error: error.message
    });
  }
});

module.exports = router;
