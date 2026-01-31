const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');
const geoip = require('geoip-lite');
const Payment = require('../models/Payment');
const User = require('../models/User');
const router = express.Router();

// Currency pricing map (in smallest units)
const CURRENCY_PRICING = {
  INR: 100,  // ₹1 (in paise)
  USD: 500     // $5 (in cents)
};

// Helper: extract IP from request (handles proxies)
function getClientIP(req) {
  console.log('\n🔍 IP Detection Debug:');
  console.log('  Headers:', {
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'x-real-ip': req.headers['x-real-ip'],
    'remoteAddress': req.connection?.remoteAddress,
    'req.ip': req.ip
  });
  
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

// Helper: detect country from IP address
function detectCountryFromIP(ip) {
  console.log('\n🌍 Country Detection Debug:');
  console.log('  Raw IP:', ip);
  
  if (!ip) {
    console.log('  ❌ No IP provided');
    return null;
  }
  
  // Remove IPv6 prefix if present (::ffff:)
  const cleanIP = ip.replace(/^::ffff:/, '');
  console.log('  Cleaned IP:', cleanIP);
  
  // Skip localhost/private IPs
  if (cleanIP === '127.0.0.1' || cleanIP === '::1') {
    console.log('  ⚠️ LOCALHOST detected → Defaulting to India');
    console.log('  💡 TIP: VPN doesn\'t work with localhost! Deploy to test IP detection.');
    return 'India';
  }
  
  if (cleanIP.startsWith('192.168.') || cleanIP.startsWith('10.')) {
    console.log('  ⚠️ PRIVATE IP detected → Defaulting to India');
    return 'India';
  }
  
  console.log('  🔎 Looking up public IP in geoip database...');
  const geo = geoip.lookup(cleanIP);
  console.log('  GeoIP result:', geo);
  
  if (geo && geo.country) {
    const countryMap = {
      'IN': 'India',
      'US': 'United States',
      'GB': 'United Kingdom',
      'CA': 'Canada',
      'AU': 'Australia',
      'SG': 'Singapore',
      'AE': 'UAE'
    };
    const countryName = countryMap[geo.country] || geo.country;
    console.log('  ✅ Country detected:', countryName, `(${geo.country})`);
    return countryName;
  }
  
  console.log('  ❌ Could not detect country from IP:', cleanIP);
  return null;
}

// Helper: determine currency based on country (IP detection)
function getCurrencyForUser(user, req) {
  console.log('\n💰 Currency Determination:');
  
  // Priority 1: Try IP-based detection first
  if (req) {
    const clientIP = getClientIP(req);
    const detectedCountry = detectCountryFromIP(clientIP);
    
    if (detectedCountry) {
      const currency = (detectedCountry === 'India') ? 'INR' : 'USD';
      console.log('  ✅ FINAL DECISION: Currency from IP:', currency);
      console.log('  📍 Country:', detectedCountry);
      console.log('  💵 Amount:', currency === 'INR' ? '₹250 (25000 paise)' : '$5 (500 cents)');
      return currency;
    }
  }
  
  // Priority 2: Use user's saved country from profile
  if (user && user.country) {
    const currency = (user.country === 'India') ? 'INR' : 'USD';
    console.log('  ⚠️ Using profile country (IP failed):', currency);
    return currency;
  }
  
  // Priority 3: Default to INR
  console.log('  ⚠️ Using default currency: INR');
  return 'INR';
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
    // Fetch user details to determine currency
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Determine currency and amount based on IP + user's country
    const currency = getCurrencyForUser(user, req);
    const amount = CURRENCY_PRICING[currency];
    
    console.log('\n📦 ORDER SUMMARY:');
    console.log('  User:', user.email);
    console.log('  Currency:', currency);
    console.log('  Amount:', amount, currency === 'INR' ? '(₹1)' : '($5)');
    console.log('  Display:', currency === 'INR' ? '₹1' : '$5');
    console.log('=' .repeat(60) + '\n');
    
    const options = {
      amount: amount, // amount in smallest unit (paise/cents)
      currency: currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        userId: req.user.userId,
        userEmail: req.user.email,
        country: user.country || 'India'
      }
    };
    
    const order = await razorpay.orders.create(options);
    
    // Save payment record in database
    const payment = new Payment({
      userId: new mongoose.Types.ObjectId(req.user.userId),
      userEmail: req.user.email,
      razorpayOrderId: order.id,
      amount: amount,
      currency: currency,
      status: 'created',
      metadata: {
        country: user.country || 'India'
      }
    });
    
    await payment.save();
    
    res.json({
      success: true,
      orderId: order.id,
      amount: amount,
      currency: currency,
      displayAmount: currency === 'INR' ? '₹1' : '$5',
      keyId: process.env.RAZORPAY_KEY_ID
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
      const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id });
      
      if (!payment) {
        console.log('  ❌ Payment record not found in database');
        return res.status(404).json({
          success: false,
          message: 'Payment record not found'
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
      const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id });
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
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const currency = getCurrencyForUser(user, req);
    const amount = CURRENCY_PRICING[currency];
    
    res.json({
      success: true,
      currency: currency,
      amount: amount,
      displayAmount: currency === 'INR' ? '₹1' : '$5'
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

// Check if user has available payment (success + not used)
router.get('/check-available', authenticateToken, async (req, res) => {
  try {
    const availablePayment = await Payment.findOne({
      userId: new mongoose.Types.ObjectId(req.user.userId),
      status: 'success',
      assessmentUsed: false
    }).sort({ paidAt: -1 });
    
    res.json({
      success: true,
      hasAvailablePayment: !!availablePayment,
      payment: availablePayment ? {
        id: availablePayment._id,
        amount: availablePayment.amount,
        paidAt: availablePayment.paidAt
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
    const { assessmentId, assessmentType } = req.body;
    
    // Find the most recent available payment for this user
    const payment = await Payment.findOne({
      userId: new mongoose.Types.ObjectId(req.user.userId),
      status: 'success',
      assessmentUsed: false
    }).sort({ paidAt: -1 });
    
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
