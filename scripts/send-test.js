const { sendWhatsAppMessage } = require('../lib/whatsapp');
require('dotenv').config({ path: '.env.local' });

// This allows us to use top-level await in simple scripts
(async () => {
  const [,, to, message] = process.argv;

  if (!to || !message) {
    console.log('❌ Usage: node scripts/send-test.js <phone_number> "<message>"');
    console.log('Example: node scripts/send-test.js 923001234567 "Hello from Tandoori!"');
    process.exit(1);
  }

  console.log(`🚀 Sending message to ${to}...`);

  try {
    const response = await sendWhatsAppMessage(to, message);
    
    if (response.messaging_product === 'whatsapp') {
      console.log('✅ Message sent successfully!');
      console.log('Response ID:', response.messages[0].id);
    } else {
      console.error('❌ WhatsApp API Error:', response);
    }
  } catch (err) {
    console.error('❌ Fatal Error:', err.message);
  }
})();
