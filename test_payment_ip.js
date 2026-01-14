const axios = require('axios');

// Test 1: Normal localhost request (should detect localhost and default to India)
async function testLocalhostPayment() {
    console.log('\n🧪 TEST 1: Payment from localhost (no VPN effect)');
    console.log('─'.repeat(60));
    
    try {
        const response = await axios.post('http://localhost:5000/api/payment/create-order', {
            userId: 'test-user-123',
            assessmentType: 'load-bearing'
        });
        
        console.log('\n✅ Response received:');
        console.log('Currency:', response.data.currency);
        console.log('Amount:', response.data.amount);
        console.log('Display:', response.data.currency === 'INR' ? '₹100' : '$5');
        console.log('\nExpected: ₹100 (INR) - because localhost always defaults to India');
    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
    }
}

// Test 2: Simulated foreign IP request (US IP)
async function testForeignIPPayment() {
    console.log('\n🧪 TEST 2: Payment with simulated US IP header');
    console.log('─'.repeat(60));
    
    try {
        const response = await axios.post('http://localhost:5000/api/payment/create-order', {
            userId: 'test-user-456',
            assessmentType: 'load-bearing'
        }, {
            headers: {
                'x-forwarded-for': '8.8.8.8' // Google DNS (US IP)
            }
        });
        
        console.log('\n✅ Response received:');
        console.log('Currency:', response.data.currency);
        console.log('Amount:', response.data.amount);
        console.log('Display:', response.data.currency === 'INR' ? '₹100' : '$5');
        console.log('\nExpected: $5 (USD) - because 8.8.8.8 is a US IP');
    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
    }
}

// Run tests
async function runTests() {
    console.log('\n🔬 IP-BASED CURRENCY DETECTION TEST');
    console.log('═'.repeat(60));
    console.log('This will show why VPN doesn\'t work with localhost');
    
    await testLocalhostPayment();
    await testForeignIPPayment();
    
    console.log('\n' + '═'.repeat(60));
    console.log('📊 CONCLUSION:');
    console.log('Test 1 shows localhost always = India (₹100)');
    console.log('Test 2 shows foreign IP header = USA ($5)');
    console.log('\n💡 To test with VPN: Deploy to production or use ngrok!');
    console.log('═'.repeat(60) + '\n');
}

runTests();
