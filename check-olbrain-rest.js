// Check olbrain.com users via Firestore REST API
require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');
const https = require('https');

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

function httpsRequest(url, options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getAccessToken() {
  const jwt = createJWT(serviceAccount);
  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;

  const result = await httpsRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  return result.data.access_token;
}

async function listUsers(accessToken) {
  const projectId = serviceAccount.project_id;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?pageSize=300`;

  const result = await httpsRequest(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  return result.data;
}

async function listPregrandfathered(accessToken) {
  const projectId = serviceAccount.project_id;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pregrandfathered?pageSize=300`;

  const result = await httpsRequest(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  return result.data;
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
  console.log('Getting access token...');
  const token = await getAccessToken();

  console.log('Fetching all users...');
  const usersData = await listUsers(token);

  if (!usersData.documents) {
    console.log('No users found or error:', JSON.stringify(usersData).substring(0, 500));
    return;
  }

  console.log('Total users:', usersData.documents.length);
  console.log('');

  const olbrainUsers = [];

  for (const doc of usersData.documents) {
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
  const preData = await listPregrandfathered(token);
  if (preData.documents) {
    const pendingOlbrain = preData.documents.filter(doc => {
      const docPath = doc.name.split('/');
      const docId = docPath[docPath.length - 1];
      return docId.toLowerCase().includes('olbrain');
    });
    console.log('Total pregrandfathered entries:', preData.documents.length);
    console.log('Olbrain.com entries in pregrandfathered:', pendingOlbrain.length);
    if (pendingOlbrain.length > 0) {
      for (const doc of pendingOlbrain) {
        const docPath = doc.name.split('/');
        console.log('  -', docPath[docPath.length - 1]);
      }
    }
  } else {
    console.log('No pregrandfathered entries found (or collection is empty).');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
