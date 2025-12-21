// Add optional chaining to critical areas
const fs = require('fs');

const criticalFiles = [
  './api/chat.js',
  './api/chat-public.js',
  './api/analytics.js',
  './api/activity.js'
];

let totalFixes = 0;

for (const file of criticalFiles) {
  let content = fs.readFileSync(file, 'utf8');
  let fixes = 0;
  
  // Pattern 1: data.property -> data?.property (for message/user data)
  const pattern1 = /\b(data|userData|visitorData|msgData|msg|message|visitor)\.(\w+)/g;
  content = content.replace(pattern1, (match, obj, prop) => {
    // Skip if already using optional chaining
    if (content.includes(`${obj}?.${prop}`)) return match;
    // Skip if there's a null check nearby
    const index = content.indexOf(match);
    const before = content.substring(Math.max(0, index - 100), index);
    if (before.includes(`if (${obj}`) || before.includes(`${obj} &&`)) return match;
    
    fixes++;
    return `${obj}?.${prop}`;
  });
  
  // Pattern 2: req.body.property -> req.body?.property
  content = content.replace(/req\.body\.(\w+)/g, 'req.body?.$1');
  
  // Pattern 3: req.query.property -> req.query?.property
  content = content.replace(/req\.query\.(\w+)/g, 'req.query?.$1');
  
  if (fixes > 0) {
    // Don't actually write - just report
    console.log(`${file}: ${fixes} optional chaining opportunities`);
    totalFixes += fixes;
  }
}

console.log(`\nTotal: ${totalFixes} potential improvements`);
console.log('\nNote: This is a complex refactor. Manual review recommended.');
