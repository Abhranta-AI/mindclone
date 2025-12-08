// Document processor for PDFs and Excel files
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase
initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileUrl, fileType, userId, documentType } = req.body;

    if (!fileUrl || !userId) {
      return res.status(400).json({ error: 'Missing required fields: fileUrl and userId' });
    }

    console.log('[ProcessDoc] Processing document:', { fileUrl, fileType, documentType });

    // Fetch the file from Vercel Blob
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extractedContent = {};

    // Process based on file type
    if (fileType === 'application/pdf' || fileUrl.endsWith('.pdf')) {
      // Extract text from PDF
      console.log('[ProcessDoc] Parsing PDF...');
      const pdfData = await pdfParse(buffer);

      extractedContent = {
        type: 'pdf',
        text: pdfData.text,
        pageCount: pdfData.numpages,
        info: pdfData.info || {},
        extractedAt: new Date().toISOString()
      };

      // Try to identify slides/sections from the text
      const sections = extractSectionsFromPDF(pdfData.text);
      extractedContent.sections = sections;

      console.log('[ProcessDoc] PDF parsed:', {
        pages: pdfData.numpages,
        textLength: pdfData.text.length,
        sections: sections.length
      });

    } else if (
      fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      fileType === 'application/vnd.ms-excel' ||
      fileUrl.endsWith('.xlsx') ||
      fileUrl.endsWith('.xls') ||
      fileUrl.endsWith('.csv')
    ) {
      // Parse Excel/CSV
      console.log('[ProcessDoc] Parsing Excel/CSV...');
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      const sheets = {};
      const keyMetrics = {};

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        sheets[sheetName] = jsonData;

        // Try to extract key financial metrics
        const metrics = extractFinancialMetrics(jsonData, sheetName);
        if (Object.keys(metrics).length > 0) {
          keyMetrics[sheetName] = metrics;
        }
      }

      extractedContent = {
        type: 'excel',
        sheetNames: workbook.SheetNames,
        sheets: sheets,
        keyMetrics: keyMetrics,
        extractedAt: new Date().toISOString()
      };

      console.log('[ProcessDoc] Excel parsed:', {
        sheets: workbook.SheetNames.length,
        metricsFound: Object.keys(keyMetrics).length
      });

    } else {
      return res.status(400).json({
        error: 'Unsupported file type',
        received: fileType
      });
    }

    // Store in Firestore Knowledge Base
    const kbDocRef = db.collection('users').doc(userId)
      .collection('linkKnowledgeBase').doc('documents');

    const existingDoc = await kbDocRef.get();
    const existingData = existingDoc.exists ? existingDoc.data() : { documents: {} };

    // Determine document key
    const docKey = documentType || (extractedContent.type === 'pdf' ? 'pitch_deck' : 'financial_model');

    existingData.documents[docKey] = {
      ...extractedContent,
      fileUrl: fileUrl,
      uploadedAt: new Date().toISOString()
    };

    await kbDocRef.set(existingData, { merge: true });

    console.log('[ProcessDoc] Stored in Knowledge Base:', docKey);

    return res.status(200).json({
      success: true,
      documentType: docKey,
      summary: {
        type: extractedContent.type,
        pageCount: extractedContent.pageCount,
        sectionsFound: extractedContent.sections?.length,
        sheetsFound: extractedContent.sheetNames?.length,
        metricsExtracted: extractedContent.keyMetrics ? Object.keys(extractedContent.keyMetrics).length : 0
      }
    });

  } catch (error) {
    console.error('[ProcessDoc] Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process document',
      details: error.toString()
    });
  }
};

// Helper function to extract sections from PDF text
function extractSectionsFromPDF(text) {
  const sections = [];
  const lines = text.split('\n').filter(line => line.trim());

  // Common pitch deck section patterns
  const sectionPatterns = [
    /^(problem|the problem)/i,
    /^(solution|our solution)/i,
    /^(market|market size|tam|sam|som)/i,
    /^(business model|revenue model)/i,
    /^(traction|growth|metrics)/i,
    /^(competition|competitive|landscape)/i,
    /^(team|our team|founding team)/i,
    /^(financials|financial projections)/i,
    /^(ask|the ask|funding)/i,
    /^(roadmap|timeline)/i,
    /^(product|our product)/i,
    /^(vision|mission)/i
  ];

  let currentSection = null;
  let currentContent = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Check if this line is a section header
    let foundSection = false;
    for (const pattern of sectionPatterns) {
      if (pattern.test(trimmedLine) && trimmedLine.length < 50) {
        // Save previous section
        if (currentSection) {
          sections.push({
            title: currentSection,
            content: currentContent.join('\n').trim()
          });
        }
        currentSection = trimmedLine;
        currentContent = [];
        foundSection = true;
        break;
      }
    }

    if (!foundSection && currentSection) {
      currentContent.push(trimmedLine);
    }
  }

  // Save last section
  if (currentSection) {
    sections.push({
      title: currentSection,
      content: currentContent.join('\n').trim()
    });
  }

  return sections;
}

// Helper function to extract financial metrics from Excel
function extractFinancialMetrics(data, sheetName) {
  const metrics = {};

  // Look for common financial terms in first column
  const financialTerms = [
    'revenue', 'sales', 'arr', 'mrr', 'gross profit', 'net income',
    'ebitda', 'margin', 'users', 'customers', 'cac', 'ltv', 'churn',
    'growth', 'burn', 'runway', 'headcount', 'employees'
  ];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const firstCell = String(row[0] || '').toLowerCase();

    for (const term of financialTerms) {
      if (firstCell.includes(term)) {
        // Extract values from subsequent columns (likely years/months)
        const values = row.slice(1).filter(v => v !== '');
        if (values.length > 0) {
          metrics[row[0]] = values;
        }
        break;
      }
    }
  }

  // Also try to get column headers (likely years/periods)
  if (data.length > 0) {
    const headers = data[0];
    if (headers && headers.length > 1) {
      metrics['_periods'] = headers.slice(1).filter(h => h !== '');
    }
  }

  return metrics;
}
