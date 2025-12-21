// More accurate bug detection
const fs = require('fs');
const path = require('path');

const apiDir = './api';
const files = fs.readdirSync(apiDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));

const realBugs = [];

for (const file of files) {
  const filePath = path.join(apiDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check if main export has try-catch
  const hasMainExport = content.includes('module.exports = async');
  if (hasMainExport) {
    // Extract the main handler function
    const exportMatch = content.match(/module\.exports = async \(req, res\) => \{[\s\S]*?\n\}/);
    if (exportMatch) {
      const handlerCode = exportMatch[0];
      if (!handlerCode.includes('try {') && !handlerCode.includes('catch')) {
        realBugs.push({
          file,
          type: 'MISSING_TRY_CATCH_IN_HANDLER',
          severity: 'HIGH'
        });
      }
    }
  }
  
  // Check for unvalidated req.body without checks
  const bodyUsages = content.match(/req\.body\.\w+/g) || [];
  if (bodyUsages.length > 0 && !content.includes('if (!req.body') && !content.includes('req.body?.')) {
    realBugs.push({
      file,
      type: 'UNVALIDATED_REQUEST_BODY',
      severity: 'MEDIUM',
      count: bodyUsages.length
    });
  }
  
  // Check for hardcoded secrets (not env vars)
  const secretMatches = content.match(/(api[_-]?key|secret|password)\s*=\s*['"][a-zA-Z0-9]{20,}['"]/gi);
  if (secretMatches) {
    realBugs.push({
      file,
      type: 'HARDCODED_SECRET',
      severity: 'CRITICAL'
    });
  }
}

console.log('\n=== REAL BUGS FOUND ===\n');
console.log(`Total files checked: ${files.length}`);
console.log(`Real bugs found: ${realBugs.length}\n`);

realBugs.forEach(bug => {
  console.log(`[${bug.severity}] ${bug.file}`);
  console.log(`  Type: ${bug.type}`);
  if (bug.count) console.log(`  Count: ${bug.count}`);
  console.log('');
});
