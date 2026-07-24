const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });
if (!process.env.MONGODB_URI) {
  dotenv.config({ path: path.join(__dirname, '../../.env') });
}

const User = require('../models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/oshmas';

const EXEMPT_ACCOUNTS = [
  {
    firstName: 'Singhraj',
    lastName: 'Gop',
    email: 'singhraj.gop@gmail.com',
    phone: '9999999991',
    password: 'Test@12345',
    organisation: 'IIT Delhi',
    country: 'India',
    isVerified: true,
    isPaymentExempt: false
  },
  {
    firstName: 'Suresh',
    lastName: 'Bhalla',
    email: 'sbhalla@civil.iitd.ac.in',
    phone: '9999999992',
    password: 'Test@12345',
    organisation: 'IIT Delhi',
    country: 'India',
    isVerified: true,
    isPaymentExempt: false
  },
  {
    firstName: 'Madan',
    lastName: 'Kumar',
    email: 'madan@civil.iitd.ac.in',
    phone: '9999999993',
    password: 'Test@12345',
    organisation: 'IIT Delhi',
    country: 'India',
    isVerified: true,
    isPaymentExempt: false
  },
  {
    firstName: 'Office',
    lastName: 'SPPL',
    email: 'office@spplindia.org',
    phone: '9999999994',
    password: 'Test@12345',
    organisation: 'SPPL India',
    country: 'India',
    isVerified: true,
    isPaymentExempt: true
  }
];

async function seedExemptUsers() {
  try {
    console.log('Connecting to MongoDB at:', MONGODB_URI);
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB.');

    for (const acc of EXEMPT_ACCOUNTS) {
      let user = await User.findOne({ email: acc.email.toLowerCase().trim() });
      if (user) {
        console.log(`Updating existing user: ${acc.email}`);
        user.firstName = acc.firstName;
        user.lastName = acc.lastName;
        user.password = acc.password; // pre('save') hook will hash this if modified
        user.phone = acc.phone;
        user.organisation = acc.organisation;
        user.isVerified = true;
        user.isPaymentExempt = acc.isPaymentExempt;
        await user.save();
        console.log(`✅ Updated: ${acc.email}`);
      } else {
        console.log(`Creating new user: ${acc.email}`);
        user = new User(acc);
        await user.save();
        console.log(`✅ Created: ${acc.email}`);
      }
    }

    console.log('\n🎉 All 3 exempt accounts have been successfully registered/updated!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding exempt users:', error);
    process.exit(1);
  }
}

seedExemptUsers();
