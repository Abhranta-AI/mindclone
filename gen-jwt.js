require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');
let envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}';
if (!envKey.startsWith('{')) envKey = Buffer.from(envKey, 'base64').toString('utf8');
const sa = JSON.parse(envKey);
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/datastore',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600
})).toString('base64url');
const signInput = header + '.' + payload;
const sign = crypto.createSign('RSA-SHA256');
sign.update(signInput);
const signature = sign.sign(sa.private_key, 'base64url');
console.log(signInput + '.' + signature);
