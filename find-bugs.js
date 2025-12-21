// Find potential bugs in the codebase
const fs = require('fs');
const path = require('path');

const bugs = [];
const apiDir = './api';

// Get all JS files in api/
const files = fs.readdirSync(apiDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));

for (const file of files) {
  const filePath = path.join(apiDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Bug 1: Unhandled promise rejections (async without try-catch)
    if (line.includes('async ') && !line.includes('try')) {
      const nextLines = lines.slice(index, index + 10).join('\n');
      if (!nextLines.includes('try') && !nextLines.includes('.catch')) {
        bugs.push({
          file,
          line: lineNum,
          type: 'POTENTIAL_UNHANDLED_PROMISE',
          code: line.trim()
        });
      }
    }

    // Bug 2: Missing null checks before accessing properties
    if (line.match(/\w+\.\w+/) && !line.includes('?.') && !line.includes('if (')) {
      if (line.includes('req.body.') || line.includes('data.')) {
        bugs.push({
          file,
          line: lineNum,
          type: 'POTENTIAL_NULL_ACCESS',
          code: line.trim().substring(0, 80)
        });
      }
    }

    // Bug 3: res.json() without status code
    if (line.includes('res.json(') && !line.includes('res.status(')) {
      const prevLine = lines[index - 1] || '';
      if (!prevLine.includes('res.status(')) {
        bugs.push({
          file,
          line: lineNum,
          type: 'MISSING_STATUS_CODE',
          code: line.trim().substring(0, 80)
        });
      }
    }

    // Bug 4: Hardcoded secrets/keys
    if (line.match(/(password|secret|key)\s*=\s*['"][^'"]{10,}['"]/i)) {
      bugs.push({
        file,
        line: lineNum,
        type: 'HARDCODED_SECRET',
        code: 'Found hardcoded secret (hidden for security)'
      });
    }

    // Bug 5: Missing input validation
    if (line.includes('req.body') || line.includes('req.query')) {
      if (!content.includes('validator') && !content.includes('validate')) {
        bugs.push({
          file,
          line: lineNum,
          type: 'MISSING_INPUT_VALIDATION',
          code: line.trim().substring(0, 80)
        });
      }
    }
  });
}

// Filter out duplicates and common false positives
const uniqueBugs = bugs.filter((bug, index, self) =>
  index === self.findIndex((b) => (
    b.file === bug.file && b.line === bug.line && b.type === bug.type
  ))
);

// Print results
console.log(`\n=== CODE ANALYSIS COMPLETE ===`);
console.log(`Files analyzed: ${files.length}`);
console.log(`Potential issues found: ${uniqueBugs.length}\n`);

// Group by type
const byType = {};
for (const bug of uniqueBugs) {
  if (!byType[bug.type]) byType[bug.type] = [];
  byType[bug.type].push(bug);
}

console.log('=== ISSUE SUMMARY ===\n');
for (const [type, list] of Object.entries(byType)) {
  console.log(`${type}: ${list.length}`);
}

console.log('\n=== TOP 20 ISSUES ===\n');
uniqueBugs.slice(0, 20).forEach(bug => {
  console.log(`[${bug.type}] ${bug.file}:${bug.line}`);
  console.log(`  ${bug.code}`);
  console.log('');
});
