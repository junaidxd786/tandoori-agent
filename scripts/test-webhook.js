const http = require('http');

const data = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                from: '923001234567',
                id: 'wamid.HBgLOTIzMTI1Mjk3MDI3FQIAEhgUM0EBQ0M3RjREOTY3RjA5RjA5RkIA',
                timestamp: Math.floor(Date.now() / 1000).toString(),
                type: 'text',
                text: {
                  body: 'Mujhe aik Chicken Karahi full chahiye delivery ke liye'
                }
              }
            ],
            contacts: [
              {
                profile: {
                  name: 'Test Customer'
                }
              }
            ]
          },
          field: 'messages'
        }
      ]
    }
  ]
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  },
};

console.log('🚀 Sending simulated WhatsApp message: "Mujhe aik Chicken Karahi full chahiye delivery ke liye"');

const req = http.request(options, (res) => {
  console.log(`📡 Server responded with status: ${res.statusCode}`);
  
  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (error) => {
  console.error('❌ Error testing webhook:', error.message);
  console.log('💡 Tip: Make sure your server is running with "npm run dev"');
});

req.write(data);
req.end();
