const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });
const User = require('../models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/osham_assessments';

async function resetExemptions() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const emails = [
      'singhraj.gop@gmail.com',
      'sbhalla@civil.iitd.ac.in',
      'madan@civil.iitd.ac.in',
      'office@spplindia.org'
    ];
    
    const result = await User.updateMany(
      { email: { $in: emails } },
      { $set: { isPaymentExempt: false } }
    );
    
    console.log('Reset result:', result);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

resetExemptions();
