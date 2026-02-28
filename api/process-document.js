// Document processor for PDFs and Excel files
let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.error('[ProcessDoc] Failed to load pdf-parse:', e.message);
}

let XLSX;
try {
  XLSX = require('xlsx');
} catch (e) {
  console.error('[ProcessDoc] Failed to load xlsx:', e.message);
}

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
      // Check if pdf-parse is available
      if (!pdfParse) {
        return res.status(500).json({
          error: 'PDF parsing library not available',
          details: 'pdf-parse module failed to load'
        });
      }

      // Extract text from PDF
      console.log('[ProcessDoc] Parsing PDF...');
      let pdfData;
      try {
        pdfData = await pdfParse(buffer);
      } catch (pdfError) {
        console.error('[ProcessDoc] PDF parse error:', pdfError);
        return res.status(500).json({
          error: 'Failed to parse PDF',
          details: pdfError.message
        });
      }

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
      // Check if xlsx is available
      if (!XLSX) {
        return res.status(500).json({
          error: 'Excel parsing library not available',
          details: 'xlsx module failed to load'
        });
      }

      // Parse Excel/CSV
      console.log('[ProcessDoc] Parsing Excel/CSV...');
      let workbook;
      try {
        workbook = XLSX.read(buffer, { type: 'buffer' });
      } catch (xlsxError) {
        console.error('[ProcessDoc] Excel parse error:', xlsxError);
        return res.status(500).json({
          error: 'Failed to parse Excel file',
          details: xlsxError.message
        });
      }

      const keyMetrics = {};
      const sheetSummaries = {};

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        // Try to extract key financial metrics
        const metrics = extractFinancialMetrics(jsonData, sheetName);
        if (Object.keys(metrics).length > 0) {
          keyMetrics[sheetName] = metrics;
        }

        // Create a text summary of the sheet (first 50 rows, max 500 chars per cell)
        // Store as text to avoid Firestore nested array limitations
        // Convert Excel date serial numbers to readable dates
        const summaryRows = jsonData.slice(0, 50).map(row =>
          row.map(cell => {
            const formatted = formatCellValue(cell);
            return String(formatted || '').substring(0, 500);
          }).join('\t')
        ).join('\n');
        sheetSummaries[sheetName] = summaryRows.substring(0, 50000); // Limit total size
      }

      extractedContent = {
        type: 'excel',
        sheetNames: workbook.SheetNames,
        sheetSummaries: sheetSummaries, // Text format instead of nested arrays
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

    // Determine document key from filename (not hardcoded type)
    const fileName = req.body.fileName || '';
    let docKey;
    if (documentType && documentType !== 'pitch_deck' && documentType !== 'financial_model') {
      // Use explicitly provided custom type
      docKey = documentType;
    } else if (fileName) {
      // Generate key from filename (like upload-kb.js does)
      const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
      docKey = nameWithoutExt.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'document';
    } else {
      docKey = 'document_' + Date.now();
    }

    existingData.documents[docKey] = {
      ...extractedContent,
      fileName: fileName,
      fileUrl: fileUrl,
      uploadedAt: new Date().toISOString()
    };

    await kbDocRef.set(existingData, { merge: true });

    // Also save to knowledgeBase collection (so it shows in KB panel)
    const kbPanelRef = db.collection('users').doc(userId)
      .collection('knowledgeBase').doc(String(Date.now()));

    await kbPanelRef.set({
      fileName: fileName || docKey,
      type: extractedContent.type === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 0,
      url: fileUrl,
      blobUrl: fileUrl,
      docKey: docKey,
      visibility: 'public',
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      extractedText: extractedContent.text ? extractedContent.text.substring(0, 50000) : null,
      textExtractionType: extractedContent.type,
      pageCount: extractedContent.pageCount || null
    });

    console.log('[ProcessDoc] Stored in Knowledge Base:', docKey);

    return res.status(200).json({
      success: true,
      documentType: docKey,
      fileName: fileName,
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

// Helper function to convert Excel serial number to readable date
function excelSerialToDate(serial) {
  // Excel dates are days since January 1, 1900
  // But Excel incorrectly treats 1900 as a leap year, so we subtract 1 for dates after Feb 28, 1900
  if (typeof serial !== 'number' || serial < 25569 || serial > 60000) {
    return null; // Not a valid date serial in reasonable range (1970-2064)
  }

  // Convert to JavaScript date
  // Excel epoch is Jan 1, 1900 = day 1
  // JavaScript epoch is Jan 1, 1970
  const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899 (accounting for Excel's leap year bug)
  const jsDate = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[jsDate.getMonth()]} ${jsDate.getFullYear()}`;
}

// Helper function to format a cell value (convert Excel dates to readable format)
function formatCellValue(value) {
  if (typeof value === 'number') {
    const dateStr = excelSerialToDate(value);
    if (dateStr) {
      return dateStr;
    }
  }
  return value;
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
  // Convert Excel date serial numbers to readable dates
  if (data.length > 0) {
    const headers = data[0];
    if (headers && headers.length > 1) {
      metrics['_periods'] = headers.slice(1)
        .filter(h => h !== '')
        .map(h => formatCellValue(h));
    }
  }

  return metrics;
}
