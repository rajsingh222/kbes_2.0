const rateLimit = require('express-rate-limit');

const getNormalizedEmailFromRequest = (req) => {
  const email = req?.body?.email;
  if (!email || typeof email !== 'string') {
    return '';
  }
  return email.trim().toLowerCase();
};

// General API rate limiter - 100 requests per 15 minutes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Strict limiter for authentication routes - 5 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  skipSuccessfulRequests: true, // Don't count successful requests
  keyGenerator: (req) => {
    // VPN users may share the same exit IP. Scope auth throttling by IP + email when available.
    const email = getNormalizedEmailFromRequest(req);
    return email ? `${req.ip}:${email}` : req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts. Please try again after 15 minutes.',
      requiresWait: true
    });
  },
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.',
    requiresWait: true
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Payment creation limiter - 10 payment attempts per hour
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: {
    success: false,
    message: 'Too many payment attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Report generation limiter - 20 reports per hour (AI calls are expensive)
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: {
    success: false,
    message: 'Too many report generation requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  apiLimiter,
  authLimiter,
  paymentLimiter,
  reportLimiter
};
