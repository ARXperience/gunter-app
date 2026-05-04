const dns = require('dns');

dns.lookup('api.openai.com', (err, address, family) => {
    if (err) {
        console.error('❌ DNS lookup failed:', err);
    } else {
        console.log('✅ DNS lookup successful:', address, '(Family:', family, ')');
    }
});

const http = require('https');
http.get('https://api.openai.com', (res) => {
    console.log('✅ HTTPS connection successful, status:', res.statusCode);
}).on('error', (err) => {
    console.error('❌ HTTPS connection failed:', err);
});
