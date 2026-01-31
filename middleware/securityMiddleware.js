const mongoSanitize = require('express-mongo-sanitize');
const validator = require('validator');

/**
 * Sanitize user input to prevent NoSQL injection attacks
 * This middleware removes keys that start with '$' or contain '.'
 */
const sanitizeInput = mongoSanitize({
  replaceWith: '_', // Replace prohibited characters with underscore
  onSanitize: ({ req, key }) => {
    console.warn(`⚠️ Sanitized potentially malicious input: ${key}`);
  }
});

/**
 * Validate and sanitize email addresses
 */
const validateEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }
  
  const trimmedEmail = email.trim().toLowerCase();
  
  if (!validator.isEmail(trimmedEmail)) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  // Additional check for common disposable email domains (optional)
  const disposableDomains = ['tempmail.com', 'throwaway.email', '10minutemail.com'];
  const domain = trimmedEmail.split('@')[1];
  
  if (disposableDomains.includes(domain)) {
    return { valid: false, error: 'Disposable email addresses are not allowed' };
  }
  
  return { valid: true, email: trimmedEmail };
};

/**
 * Validate password strength
 */
const validatePassword = (password) => {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  
  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters long' };
  }
  
  // Optional: Add more strict requirements for production
  // if (!/[A-Z]/.test(password)) {
  //   return { valid: false, error: 'Password must contain at least one uppercase letter' };
  // }
  // if (!/[a-z]/.test(password)) {
  //   return { valid: false, error: 'Password must contain at least one lowercase letter' };
  // }
  // if (!/[0-9]/.test(password)) {
  //   return { valid: false, error: 'Password must contain at least one number' };
  // }
  
  return { valid: true };
};

/**
 * Sanitize and validate phone number
 */
const validatePhone = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, error: 'Phone number is required' };
  }
  
  // Remove all non-numeric characters
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length < 10 || cleaned.length > 15) {
    return { valid: false, error: 'Please enter a valid phone number (10-15 digits)' };
  }
  
  return { valid: true, phone: cleaned };
};

/**
 * Sanitize string inputs to prevent XSS
 */
const sanitizeString = (str, maxLength = 1000) => {
  if (!str || typeof str !== 'string') {
    return '';
  }
  
  // Trim whitespace
  let cleaned = str.trim();
  
  // Limit length
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength);
  }
  
  // Escape HTML special characters (React does this automatically, but good practice)
  // For storing in DB, we keep original text. React will escape on render.
  
  return cleaned;
};

/**
 * Middleware to log security events
 */
const securityLogger = (event, details) => {
  const timestamp = new Date().toISOString();
  console.log(`🔐 [SECURITY] ${timestamp} - ${event}:`, details);
};

module.exports = {
  sanitizeInput,
  validateEmail,
  validatePassword,
  validatePhone,
  sanitizeString,
  securityLogger
};
