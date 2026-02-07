// Check olbrain.com users via Firestore REST API through HTTP proxy
require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const url = require('url');

// Parse service account
let envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}';
if (!envKey.startsWith('{')) {
  envKey = Buffer.from(envKey, 'base64').toString('utf8');
}
const serviceAccount = JSON.parse(envKey);

// Create JWT for Google OAuth
function createJWT(sa) {
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

  return signInput + '.' + signature;
}

// Make HTTPS request through HTTP CONNECT proxy
function proxyRequest(targetUrl, options, postData) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const proxyHost = 'localhost';
    const proxyPort = 3128;

    // First establish CONNECT tunnel through proxy
    const connectReq = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${parsed.hostname}:443`
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
        return;
      }

      // Now make the actual HTTPS request through the tunnel
      const tlsOptions = {
        socket: socket,
        servername: parsed.hostname,
        ...options,
        method: options.method || 'GET',
        path: parsed.pathname + (parsed.search || ''),
        headers: options.headers || {}
      };

      const req = https.request({
        ...tlsOptions,
        host: parsed.hostname
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: response.statusCode, data: data });
          }
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });

    connectReq.on('error', reject);
    connectReq.end();
  });
}

function getFieldValue(field) {
  if (!field) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.integerValue !== undefined) return parseInt(field.integerValue);
  if (field.timestampValue !== undefined) return field.timestampValue;
  if (field.mapValue !== undefined) return field.mapValue;
  return null;
}

async function main() {
  console.log('Getting access token via proxy...');
  const jwt = createJWT(serviceAccount);
  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;

  const tokenResult = await proxyRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  if (!tokenResult.data.access_token) {
    console.error('Failed to get access token:', JSON.stringify(tokenResult.data).substring(0, 500));
    process.exit(1);
  }

  const token = tokenResult.data.access_token;
  console.log('Got access token successfully.');

  const projectId = serviceAccount.project_id;

  // Fetch all users
  console.log('Fetching all users...');
  let allDocs = [];
  let nextPageToken = null;

  do {
    let usersUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?pageSize=300`;
    if (nextPageToken) usersUrl += `&pageToken=${nextPageToken}`;

    const usersData = await proxyRequest(usersUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (usersData.data.documents) {
      allDocs = allDocs.concat(usersData.data.documents);
    }
    nextPageToken = usersData.data.nextPageToken || null;
  } while (nextPageToken);

  console.log('Total users:', allDocs.length);
  console.log('');

  const olbrainUsers = [];

  for (const doc of allDocs) {
    const fields = doc.fields || {};
    const email = getFieldValue(fields.email) || '(no email)';

    if (email.toLowerCase().endsWith('@olbrain.com')) {
      const docPath = doc.name.split('/');
      const userId = docPath[docPath.length - 1];

      olbrainUsers.push({
        id: userId,
        email: email,
        isGrandfathered: getFieldValue(fields.isGrandfathered) === true,
        grandfatheredAt: getFieldValue(fields.grandfatheredAt) || 'N/A',
        username: getFieldValue(fields.username) || '(none)',
        createdAt: getFieldValue(fields.createdAt) || 'N/A'
      });
    }
  }

  console.log('=== OLBRAIN.COM USERS ===');
  console.log('Found ' + olbrainUsers.length + ' users with @olbrain.com email');
  console.log('');

  if (olbrainUsers.length === 0) {
    console.log('No olbrain.com users found in the database.');
  } else {
    let allGrandfathered = true;
    for (const user of olbrainUsers) {
      const status = user.isGrandfathered ? 'YES' : 'NO';
      if (!user.isGrandfathered) allGrandfathered = false;
      console.log('Email:', user.email);
      console.log('  Username:', user.username);
      console.log('  Grandfathered:', status);
      console.log('  Grandfathered At:', user.grandfatheredAt);
      console.log('  Created At:', user.createdAt);
      console.log('');
    }

    console.log('=== SUMMARY ===');
    console.log('Total olbrain.com users:', olbrainUsers.length);
    console.log('Grandfathered:', olbrainUsers.filter(u => u.isGrandfathered).length);
    console.log('NOT grandfathered:', olbrainUsers.filter(u => !u.isGrandfathered).length);
    console.log('');
    console.log(allGrandfathered ? 'ALL olbrain.com users ARE grandfathered.' : 'NOT all olbrain.com users are grandfathered!');
  }

  // Check pregrandfathered collection
  console.log('');
  console.log('=== CHECKING PREGRANDFATHERED COLLECTION ===');
  const preUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pregrandfathered?pageSize=300`;
  const preData = await proxyRequest(preUrl, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (preData.data.documents) {
    const pendingOlbrain = preData.data.documents.filter(doc => {
      const docPath = doc.name.split('/');
      const docId = docPath[docPath.length - 1];
      return docId.toLowerCase().includes('olbrain');
    });
    console.log('Total pregrandfathered entries:', preData.data.documents.length);
    console.log('Olbrain.com entries in pregrandfathered:', pendingOlbrain.length);
    if (pendingOlbrain.length > 0) {
      for (const doc of pendingOlbrain) {
        const docPath = doc.name.split('/');
        console.log('  -', docPath[docPath.length - 1]);
      }
    }
  } else {
    console.log('No pregrandfathered entries found (collection may be empty).');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
