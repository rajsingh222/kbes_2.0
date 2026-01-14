require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

console.log('🔗 Testing MongoDB connection...');
console.log('📍 URI:', MONGODB_URI ? MONGODB_URI.replace(/:[^:@]+@/, ':****@') : 'NOT FOUND IN .env');

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env file');
  process.exit(1);
}

const options = {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  family: 4
};

console.log('⏳ Connecting...\n');

mongoose.connect(MONGODB_URI, options)
  .then(() => {
    console.log('✅ MongoDB connected successfully!');
    console.log('📊 Database:', mongoose.connection.name);
    console.log('🌍 Host:', mongoose.connection.host);
    console.log('\n🎉 Your database is accessible!');
    mongoose.connection.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Connection failed:', err.message);
    console.log('\n💡 Solutions:');
    console.log('1. Login to MongoDB Atlas: https://cloud.mongodb.com/');
    console.log('2. Go to: Network Access');
    console.log('3. Click: Add IP Address');
    console.log('4. Select: ALLOW ACCESS FROM ANYWHERE (0.0.0.0/0)');
    console.log('5. Save and try again');
    console.log('\n⚠️ If using VPN, MongoDB may be blocked');
    console.log('   Try: Disable VPN temporarily OR add 0.0.0.0/0 to Atlas');
    process.exit(1);
  });
