const cloudinary = require('cloudinary').v2;

// Configure via env variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload a PDF buffer to Cloudinary as a raw resource.
 * Returns the Cloudinary upload result object.
 */
function uploadPdfBuffer(buffer, publicId, folder) {
  return new Promise((resolve, reject) => {
    // Ensure publicId is defined and safe
    const safePublicId = (publicId || `report_${Date.now()}`).replace(/[^a-zA-Z0-9_\-\/]/g, '_');
    const targetFolder = folder || process.env.CLOUDINARY_FOLDER || 'assessments';
    const options = {
      resource_type: 'raw',
      public_id: safePublicId,
      overwrite: true,
      folder: targetFolder,
      format: 'pdf',
      access_mode: 'public' // Make PDFs publicly accessible
    };

    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });

    try {
      uploadStream.end(buffer);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Upload an image buffer (from multer memoryStorage) to Cloudinary.
 * Returns the full Cloudinary upload result (result.secure_url is the CDN URL).
 */
function uploadImageBuffer(buffer, originalname, folder) {
  return new Promise((resolve, reject) => {
    const ext = (originalname || 'photo').split('.').pop().toLowerCase() || 'jpg';
    const safeName = (originalname || `img_${Date.now()}`).replace(/[^a-zA-Z0-9_\-]/g, '_');
    const targetFolder = folder || process.env.CLOUDINARY_FOLDER || 'assessments';
    const options = {
      resource_type: 'image',
      public_id: `${safeName}_${Date.now()}`,
      overwrite: false,
      folder: `${targetFolder}/images`,
      format: ext,
      quality: 'auto:good',
      fetch_format: 'auto',
    };

    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });

    try {
      uploadStream.end(buffer);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  uploadPdfBuffer,
  uploadImageBuffer,
};
