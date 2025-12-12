// Letterhead helper module - fetches per-user letterhead config from Firestore
// Each user can configure their own: companyName, address, website, email, logoBase64

/**
 * Get letterhead config for a user from Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {string} userId - The user ID
 * @returns {Promise<Object|null>} - Letterhead config or null if not configured
 */
async function getLetterheadConfig(db, userId) {
  try {
    // Try to get user's letterhead settings from Firestore
    const letterheadDoc = await db.collection('users').doc(userId)
      .collection('settings').doc('letterhead').get();

    if (letterheadDoc.exists) {
      const data = letterheadDoc.data();
      console.log(`[Letterhead] Loaded config for user ${userId}`);
      return {
        companyName: data.companyName || '',
        address: data.address || '',
        website: data.website || '',
        email: data.email || '',
        logoBase64: data.logoBase64 || '', // User's logo as base64
        logoUrl: data.logoUrl || ''  // Or URL to fetch logo from
      };
    }

    // Fallback: check if user has basic profile info to construct letterhead
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      // If user has mindclone name or display name, use that as company name
      if (userData.mindcloneName || userData.displayName) {
        console.log(`[Letterhead] Using profile info for user ${userId}`);
        return {
          companyName: userData.mindcloneName || userData.displayName || '',
          address: '',
          website: '',
          email: userData.email || '',
          logoBase64: userData.avatarBase64 || '',
          logoUrl: userData.avatarUrl || ''
        };
      }
    }

    console.log(`[Letterhead] No config found for user ${userId}`);
    return null;
  } catch (error) {
    console.error(`[Letterhead] Error loading config for user ${userId}:`, error.message);
    return null;
  }
}

/**
 * Render letterhead onto a PDF page
 * @param {Object} options - Rendering options
 * @param {PDFPage} options.page - The PDF page to draw on
 * @param {PDFDocument} options.pdfDoc - The PDF document (for embedding images)
 * @param {Object} options.config - Letterhead config (companyName, address, website, email, logoBase64)
 * @param {Object} options.fonts - { regular, bold } font objects
 * @param {Function} options.rgb - pdf-lib rgb function
 * @param {number} options.pageHeight - Page height in points
 * @param {number} options.margin - Page margin in points
 * @returns {Promise<number>} - New yPosition after letterhead
 */
async function renderLetterhead({ page, pdfDoc, config, fonts, rgb, pageHeight, margin }) {
  if (!config) {
    return pageHeight - margin; // No letterhead, return normal start position
  }

  let yPosition = pageHeight - margin;

  try {
    // Draw logo if available
    if (config.logoBase64) {
      const logoBytes = Buffer.from(config.logoBase64, 'base64');
      // Try PNG first, then JPG
      let logoImage;
      try {
        logoImage = await pdfDoc.embedPng(logoBytes);
      } catch {
        try {
          logoImage = await pdfDoc.embedJpg(logoBytes);
        } catch {
          console.error('[Letterhead] Could not embed logo image');
        }
      }

      if (logoImage) {
        // Draw logo (top-left, 50x50 points)
        page.drawImage(logoImage, {
          x: margin,
          y: pageHeight - margin - 50,
          width: 50,
          height: 50
        });
      }
    }

    // Draw company name next to logo (or at top if no logo)
    const textX = config.logoBase64 ? margin + 60 : margin;

    if (config.companyName) {
      page.drawText(config.companyName, {
        x: textX,
        y: pageHeight - margin - 20,
        size: 16,
        font: fonts.bold,
        color: rgb(0.4, 0.4, 0.4)
      });
    }

    // Draw address below
    if (config.address) {
      page.drawText(config.address, {
        x: textX,
        y: pageHeight - margin - 35,
        size: 9,
        font: fonts.regular,
        color: rgb(0.5, 0.5, 0.5)
      });
    }

    // Draw website | email
    const contactLine = [config.website, config.email].filter(Boolean).join(' | ');
    if (contactLine) {
      page.drawText(contactLine, {
        x: textX,
        y: pageHeight - margin - 47,
        size: 9,
        font: fonts.regular,
        color: rgb(0.5, 0.5, 0.5)
      });
    }

    // Adjust starting position for content
    yPosition = pageHeight - margin - 80;
    console.log('[Letterhead] Rendered successfully');
  } catch (error) {
    console.error('[Letterhead] Rendering error:', error.message);
    yPosition = pageHeight - margin; // Fallback to normal position
  }

  return yPosition;
}

module.exports = { getLetterheadConfig, renderLetterhead };
