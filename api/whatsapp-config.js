// WhatsApp Configuration Endpoint
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Auth check
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const idToken = authHeader.replace('Bearer ', '');
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;
    
    const configRef = db.collection('users').doc(userId)
      .collection('settings').doc('whatsapp');
    
    if (req.method === 'GET') {
      const doc = await configRef.get();
      const config = doc.exists ? doc.data() : {
        enabled: false,
        phoneNumber: null,
        triggers: { news: true, visitors: true, tasks: true },
        quietHours: { start: 22, end: 8 },
        dailyLimit: 20
      };
      
      return res.status(200).json({ success: true, config });
    }
    
    if (req.method === 'POST') {
      const updates = req.body;
      
      // Validate allowed fields
      const allowedFields = ['enabled', 'phoneNumber', 'triggers', 'quietHours', 'dailyLimit'];
      const sanitized = {};
      
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          sanitized[key] = value;
        }
      }
      
      // Validate phone number format if provided
      if (sanitized.phoneNumber) {
        const phone = sanitized.phoneNumber.replace(/\s/g, '');
        if (!phone.match(/^\+\d{10,15}$/)) {
          return res.status(400).json({ error: 'Invalid phone number format. Use +countrycode followed by number (e.g., +917897057481)' });
        }
        sanitized.phoneNumber = phone;
      }
      
      sanitized.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      
      await configRef.set(sanitized, { merge: true });
      
      console.log(`[WhatsApp Config] Updated for ${userId}:`, Object.keys(sanitized).join(', '));
      
      return res.status(200).json({ success: true, message: 'WhatsApp config updated' });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('[WhatsApp Config] Error:', error);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(500).json({ error: error.message });
  }
};
