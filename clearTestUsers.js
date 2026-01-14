require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/osham_assessments';

async function clearTestUsers() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // List all users
    const users = await User.find({}, 'email firstName lastName isVerified createdAt');
    console.log('\n📋 Current users in database:');
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} - ${user.firstName} ${user.lastName} - Verified: ${user.isVerified} - Created: ${user.createdAt}`);
    });

    // You can uncomment the line below to delete a specific user by email
    await User.deleteOne({ email: 'office@spplindia.org' });
    console.log('\n🗑️ Deleted user: office@spplindia.org');

    // Or uncomment to delete ALL users (be careful!)
    // const result = await User.deleteMany({});
    // console.log(`\n🗑️ Deleted ${result.deletedCount} users`);

    await mongoose.connection.close();
    console.log('\n👋 Done');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

clearTestUsers();
