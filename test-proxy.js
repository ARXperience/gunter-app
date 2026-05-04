const http = require('http');
const fs = require('fs');
const path = require('path');

// This script tests the /api/transcribe endpoint of the proxy server
async function testTranscription() {
    console.log('🚀 Starting transcription test...');

    // Create a dummy WAV-like buffer for testing
    // A real WAV header would be better, but we just want to see if it reaches OpenAI
    const dummyBuffer = Buffer.alloc(1000);
    dummyBuffer.write('RIFF', 0); // Fake WAV header start

    // Construct a multipart/form-data body manually to see if the proxy handles it
    const boundary = '----TestBoundary' + Math.random().toString(16).slice(2);
    const parts = [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="test.wav"\r\n`,
        `Content-Type: audio/wav\r\n\r\n`,
        dummyBuffer,
        `\r\n--${boundary}\r\n`,
        `Content-Disposition: form-data; name="model"\r\n\r\n`,
        `whisper-1\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="language"\r\n\r\n`,
        `es\r\n`,
        `--${boundary}--\r\n`
    ];

    const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p));

    const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/transcribe',
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length
        }
    };

    console.log(`📡 Sending test request to http://localhost:3001/api/transcribe (${body.length} bytes)...`);

    const req = http.request(options, res => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
            console.log(`📥 Status: ${res.statusCode}`);
            console.log(`📄 Response: ${responseData}`);

            if (res.statusCode === 200) {
                console.log('✅ Test SUCCEEDED (or at least got a response from OpenAI)');
            } else {
                console.log('❌ Test FAILED');
            }
        });
    });

    req.on('error', e => {
        console.error(`❌ Connection error: ${e.message}`);
        console.log('Is the server running? Run "node server.js" in another terminal.');
    });

    req.write(body);
    req.end();
}

testTranscription();
