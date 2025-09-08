#!/usr/bin/env node
// Triggers the admin endpoint to cancel expired pickup holds and restock.
// Usage (env): API_BASE_URL=https://your-api ADMIN_JWT=... node scripts/cancel-expired-pickups.mjs

import https from 'https';
import http from 'http';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const ADMIN_JWT = process.env.ADMIN_JWT || '';

if (!ADMIN_JWT) {
  console.error('ADMIN_JWT is required to run this job.');
  process.exit(1);
}

const url = new URL('/orders/admin/cancel-expired-pickups', API_BASE_URL);
const lib = url.protocol === 'https:' ? https : http;

const payload = JSON.stringify({});

const req = lib.request(
  {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + (url.search || ''),
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': `Bearer ${ADMIN_JWT}`,
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      console.log('Status:', res.statusCode);
      try {
        console.log('Body:', JSON.parse(data));
      } catch {
        console.log('Body:', data);
      }
      process.exit(ok ? 0 : 2);
    });
  }
);

req.on('error', (err) => {
  console.error('Request error:', err?.message || err);
  process.exit(2);
});

req.write(payload);
req.end();

