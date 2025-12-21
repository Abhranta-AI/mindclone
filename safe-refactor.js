// Safe automated refactoring for optional chaining
const fs = require('fs');

function safeRefactor(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changes = 0;
  
  // Pattern 1: error.message -> error?.message (common pattern)
  const before1 = content;
  content = content.replace(/\berror\.message\b/g, 'error?.message');
  if (content !== before1) changes += (before1.match(/\berror\.message\b/g) || []).length;
  
  // Pattern 2: req.query.property -> req.query?.property  
  const before2 = content;
  content = content.replace(/req\.query\.(\w+)/g, 'req.query?.$1');
  if (content !== before2) changes += (before2.match(/req\.query\.\w+/g) || []).length;
  
  // Pattern 3: req.body.property -> req.body?.property
  const before3 = content;
  content = content.replace(/req\.body\.(\w+)/g, 'req.body?.$1');
  if (content !== before3) changes += (before3.match(/req\.body\.\w+/g) || []).length;
  
  // Pattern 4: msg.role and msg.content (in context of message mapping)
  const before4 = content;
  content = content.replace(/msg\.role\b/g, 'msg?.role');
  content = content.replace(/msg\.content\b/g, 'msg?.content');
  if (content !== before4) changes += (before4.match(/msg\.(role|content)\b/g) || []).length;
  
  // Save file
  fs.writeFileSync(filePath, content, 'utf8');
  return changes;
}

const files = [
  './api/chat-public.js',
  './api/chat.js'
];

let totalChanges = 0;
for (const file of files) {
  const changes = safeRefactor(file);
  console.log(`${file}: ${changes} changes`);
  totalChanges += changes;
}

console.log(`\nTotal: ${totalChanges} safe refactors applied`);
