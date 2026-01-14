const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendVerificationEmail } = require('../services/emailService');

// JWT Secret - In production, use environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d'; // Token expires in 7 days

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No token provided',
      requiresLogin: true
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      requiresLogin: true
    });
  }
};

/**
 * POST /api/auth/register
 * Register a new user and send verification email
 */
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, organisation } = req.body;
    console.log('📝 Registration attempt:', { firstName, lastName, email, phone, hasPassword: !!password, organisation });

    // Validate required fields
    if (!firstName || !lastName || !email || !phone || !password) {
      console.log('❌ Validation failed - missing fields:', {
        hasFirstName: !!firstName,
        hasLastName: !!lastName,
        hasEmail: !!email,
        hasPhone: !!phone,
        hasPassword: !!password
      });
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('❌ Invalid email format:', email);
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Validate password strength (minimum 6 characters)
    if (password.length < 6) {
      console.log('❌ Password too short:', password.length);
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      console.log('⚠️ User already exists:', { email, isVerified: existingUser.isVerified });
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create new user and mark as verified (skip verification code flow)
    const user = new User({
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      organisation: organisation || '',
      password, // Will be hashed by pre-save middleware
      isVerified: true
    });

    // Save user to database
    await user.save();
    console.log('✅ User registered successfully:', { email: user.email, isVerified: user.isVerified });

    // Return success and auto-login prompt
    res.status(201).json({
      success: true,
      message: 'Registration successful. You can now log in.',
      userId: user._id
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: error.message
    });
  }
});

/**
 * POST /api/auth/verify-email
 * Verify email with code sent to user
 */
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'Email and verification code are required'
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already verified
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }

    // Check if verification code matches
    if (user.verificationCode !== code) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Check if verification code has expired
    if (new Date() > user.verificationCodeExpires) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new one.'
      });
    }

    // Mark user as verified
    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully. You can now login.'
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during verification',
      error: error.message
    });
  }
});

/**
 * POST /api/auth/resend-code
 * Resend verification code to user email
 */
router.post('/resend-code', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }

    // Generate new verification code
    const verificationCode = user.generateVerificationCode();
    await user.save();

    // Send verification email
    const emailResult = await sendVerificationEmail(email, user.firstName, verificationCode);

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email'
      });
    }

    res.json({
      success: true,
      message: 'Verification code has been resent to your email'
    });

  } catch (error) {
    console.error('Resend code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * POST /api/auth/login
 * Login user with email and password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if email is verified
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in',
        requiresVerification: true
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Return user data and token
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        organisation: user.organisation,
        country: user.country,
        isVerified: user.isVerified,
        lastLogin: user.lastLogin
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: error.message
    });
  }
});

/**
 * POST /api/auth/validate-token
 * Validate JWT token and return user data if valid
 */
router.post('/validate-token', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password -verificationCode -verificationCodeExpires');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        requiresLogin: true
      });
    }

    res.json({
      success: true,
      valid: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        isVerified: user.isVerified,
        lastLogin: user.lastLogin
      }
    });

  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user info (protected route)
 */
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password -verificationCode -verificationCodeExpires');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        isVerified: user.isVerified,
        lastLogin: user.lastLogin
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * PUT /api/auth/update-profile
 * Update user profile (firstName, lastName, phone)
 */
router.put('/update-profile', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, phone } = req.body;

    // Find user by ID from token
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * PUT /api/auth/profile
 * Update user organization and phone (for ProfileModal)
 */
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { organisation, phone, country } = req.body;

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (organisation !== undefined) user.organisation = organisation;
    if (phone) user.phone = phone;
    if (country !== undefined) user.country = country;

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        organisation: user.organisation,
        country: user.country,
        phone: user.phone
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * POST /api/auth/profile-photo
 * Upload profile photo (placeholder - returns mock URL)
 */
router.post('/profile-photo', verifyToken, async (req, res) => {
  try {
    // In a real implementation, you would:
    // 1. Use multer or similar to handle file upload
    // 2. Upload to cloudinary or S3
    // 3. Save URL to user model
    
    // For now, return a placeholder
    const photoUrl = `https://ui-avatars.com/api/?name=${req.userId}&size=200&background=4F46E5&color=fff`;
    
    const user = await User.findById(req.userId);
    if (user) {
      user.profilePhoto = photoUrl;
      await user.save();
    }

    res.json({
      success: true,
      message: 'Photo uploaded successfully',
      photoUrl: photoUrl
    });

  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * DELETE /api/auth/delete-account
 * Delete user account permanently
 */
router.delete('/delete-account', verifyToken, async (req, res) => {
  try {
    // Find and delete user by ID from token
    const user = await User.findByIdAndDelete(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;
