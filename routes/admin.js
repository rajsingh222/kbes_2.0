const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Assessment = require('../models/Assessment');
const multer = require('multer');
const cloudinaryService = require('../services/cloudinaryService');
const mongoose = require('mongoose');
const { Readable } = require('stream');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

// Admin credentials (set via environment in production)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@spplindia.org';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '@Admin1234554321';

// Admin authentication middleware
const verifyAdmin = (req, res, next) => {
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
    if (!decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }
    req.adminEmail = decoded.email;
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
 * POST /api/admin/login
 * Admin login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate credentials
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        email: ADMIN_EMAIL,
        isAdmin: true
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: 'Admin login successful',
      token,
      admin: {
        email: ADMIN_EMAIL,
        role: 'admin'
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

/**
 * GET /api/admin/users
 * Get all users with their assessment counts
 */
router.get('/users', verifyAdmin, async (req, res) => {
  try {
    // Get all users
    const users = await User.find({}, '-password -verificationCode -verificationCodeExpiry')
      .sort({ createdAt: -1 })
      .lean();

    // Get assessment counts for each user
    const usersWithAssessments = await Promise.all(
      users.map(async (user) => {
        const assessmentCount = await Assessment.countDocuments({
          'userDetails.email': user.email
        });
        
        return {
          ...user,
          assessmentCount
        };
      })
    );

    res.json({
      success: true,
      users: usersWithAssessments,
      totalUsers: usersWithAssessments.length
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
});

/**
 * GET /api/admin/users/:email/assessments
 * Get all assessments for a specific user
 */
router.get('/users/:email/assessments', verifyAdmin, async (req, res) => {
  try {
    const { email } = req.params;

    // Get all assessments for this user (case-insensitive email query)
    const emailRegex = new RegExp(`^${email.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, 'i');
    const assessments = await Assessment.find({
      'userDetails.email': emailRegex
    })
    .select('-pdfData.data') // Exclude binary PDF data for performance
    .sort({ submittedAt: -1 })
    .lean();

    res.json({
      success: true,
      assessments,
      totalAssessments: assessments.length
    });

  } catch (error) {
    console.error('Get user assessments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching assessments'
    });
  }
});

/**
 * GET /api/admin/assessments/:id
 * Get detailed assessment by ID
 */
router.get('/assessments/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const assessment = await Assessment.findById(id)
      .select('-pdfData.data') // Exclude binary PDF data
      .lean();

    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    // Extract raw responses from all potential storage layers
    let basicResponses = {};
    if (assessment.assessmentResponses) {
      if (assessment.assessmentResponses.raw_responses && typeof assessment.assessmentResponses.raw_responses === 'object') {
        basicResponses = assessment.assessmentResponses.raw_responses;
      } else {
        basicResponses = assessment.assessmentResponses;
      }
    }
    
    const flatResponses = assessment.responses || {};
    const advancedResponses = assessment.advancedResponses || {};

    const mergedResponses = {
      ...flatResponses,
      ...basicResponses,
      ...advancedResponses
    };

    // Remove internal non-question metadata keys if present
    delete mergedResponses._rawOriginal;
    delete mergedResponses.formatted_responses;
    delete mergedResponses.filtered_responses;
    delete mergedResponses.formatted;

    res.json({
      success: true,
      assessment: {
        ...assessment,
        rawResponses: mergedResponses
      }
    });

  } catch (error) {
    console.error('Get assessment detail error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching assessment details'
    });
  }
});

/**
 * GET /api/admin/stats
 * Get overall statistics
 */
router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAssessments = await Assessment.countDocuments();
    const verifiedUsers = await User.countDocuments({ isVerified: true });
    
    // Get assessments by type
    const assessmentsByType = await Assessment.aggregate([
      {
        $group: {
          _id: '$assessmentType',
          count: { $sum: 1 }
        }
      }
    ]);

    // Recent assessments (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentAssessments = await Assessment.countDocuments({
      submittedAt: { $gte: sevenDaysAgo }
    });

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalAssessments,
        verifiedUsers,
        assessmentsByType,
        recentAssessments
      }
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics'
    });
  }
});

/**
 * GET /api/admin/assessments
 * Get all assessments with pagination
 */
router.get('/assessments', verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const assessments = await Assessment.find()
      .select('-pdfData.data')
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Assessment.countDocuments();

    res.json({
      success: true,
      assessments,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit
      }
    });

  } catch (error) {
    console.error('Get all assessments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching assessments'
    });
  }
});

/**
 * POST /api/admin/assessments/:id/upload-report
 * Upload admin report for assessment
 */
router.post('/assessments/:id/upload-report', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reportUrl, publicId } = req.body;

    if (!reportUrl || !publicId) {
      return res.status(400).json({
        success: false,
        message: 'Report URL and public ID are required'
      });
    }

    const assessment = await Assessment.findById(id);
    
    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    // Update assessment with admin report
    assessment.adminReport = {
      cloudinaryPublicId: publicId,
      cloudinaryUrl: reportUrl,
      uploadedAt: new Date(),
      uploadedBy: req.adminEmail
    };

    await assessment.save();

    res.json({
      success: true,
      message: 'Report uploaded successfully',
      adminReport: assessment.adminReport
    });

  } catch (error) {
    console.error('Upload report error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading report'
    });
  }
});

// Multer setup for in-memory file handling
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

/**
 * POST /api/admin/assessments/:id/upload-report-file
 * Accepts a multipart/form-data file and uploads to GridFS
 */
router.post('/assessments/:id/upload-report-file', verifyAdmin, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ success: false, message: 'Only PDF files are accepted' });
    }

    const buffer = req.file.buffer;

    // Get GridFS bucket from mongoose connection
    const { GridFSBucket } = require('mongodb');
    const gridFSBucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'adminReports'
    });

    // Create a readable stream from buffer
    const readableStream = Readable.from(buffer);
    
    // Create upload stream with metadata
    const filename = `report_${id}_${Date.now()}.pdf`;
    const uploadStream = gridFSBucket.openUploadStream(filename, {
      contentType: 'application/pdf',
      metadata: {
        assessmentId: id,
        uploadedBy: req.adminEmail,
        uploadedAt: new Date()
      }
    });

    // Upload file to GridFS
    await new Promise((resolve, reject) => {
      readableStream.pipe(uploadStream)
        .on('error', reject)
        .on('finish', resolve);
    });

    const gridFsFileId = uploadStream.id;
    console.log('✅ PDF uploaded to GridFS:', gridFsFileId);

    // Update assessment with GridFS file reference
    const assessment = await Assessment.findById(id);
    if (!assessment) {
      return res.status(404).json({ success: false, message: 'Assessment not found' });
    }

    assessment.adminReport = {
      gridFsFileId: gridFsFileId,
      uploadedAt: new Date(),
      uploadedBy: req.adminEmail
    };

    await assessment.save();

    res.json({ 
      success: true, 
      message: 'Report uploaded successfully to GridFS',
      adminReport: {
        fileId: gridFsFileId,
        uploadedAt: assessment.adminReport.uploadedAt,
        uploadedBy: assessment.adminReport.uploadedBy
      }
    });
  } catch (error) {
    console.error('Upload report file error:', error);
    res.status(500).json({ success: false, message: 'Error uploading report file', error: error.message });
  }
});

/**
 * GET /api/admin/assessments/:id/admin-report-file
 * Stream uploaded admin report file (GridFS) to authenticated admin.
 * If report is cloud-hosted, redirect to that URL.
 */
router.get('/assessments/:id/admin-report-file', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const assessment = await Assessment.findById(id).lean();

    if (!assessment) {
      return res.status(404).json({ success: false, message: 'Assessment not found' });
    }

    const adminReport = assessment.adminReport || {};

    if (adminReport.cloudinaryUrl) {
      return res.redirect(adminReport.cloudinaryUrl);
    }

    const fileId = adminReport.gridFsFileId || adminReport.fileId;
    if (!fileId) {
      return res.status(404).json({ success: false, message: 'No uploaded admin report found' });
    }

    const { GridFSBucket } = require('mongodb');
    const gridFSBucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'adminReports'
    });

    const objectId = typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="admin_report_${id}.pdf"`);

    const stream = gridFSBucket.openDownloadStream(objectId);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(404).json({ success: false, message: 'Report file not found in storage' });
      }
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Get admin report file error:', error);
    res.status(500).json({ success: false, message: 'Error fetching admin report file', error: error.message });
  }
});

module.exports = router;


