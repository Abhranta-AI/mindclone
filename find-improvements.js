// Find code improvements (not bugs, but enhancements)
const fs = require('fs');
const path = require('path');

const improvements = [];
const apiDir = './api';
const files = fs.readdirSync(apiDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));

for (const file of files) {
  const filePath = path.join(apiDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  lines.forEach((line, i) => {
    // TODO comments
    if (line.includes('TODO')) {
      improvements.push({
        file,
        line: i + 1,
        type: 'TODO',
        priority: 'LOW',
        code: line.trim()
      });
    }
    
    // Missing optional chaining for safer access
    if (line.match(/\w+\.\w+\.\w+/) && !line.includes('?.') && !line.includes('if (')) {
      improvements.push({
        file,
        line: i + 1,
        type: 'USE_OPTIONAL_CHAINING',
        priority: 'LOW',
        code: line.trim().substring(0, 60)
      });
    }
    
    // parseInt without radix
    if (line.includes('parseInt(') && !line.includes(', 10)')) {
      improvements.push({
        file,
        line: i + 1,
        type: 'MISSING_RADIX_IN_PARSEINT',
        priority: 'LOW',
        code: line.trim().substring(0, 60)
      });
    }
  });
}

// Deduplicate
const unique = improvements.filter((item, index, self) =>
  index === self.findIndex((t) => (
    t.file === item.file && t.line === item.line && t.type === item.type
  ))
);

console.log('\n=== CODE IMPROVEMENTS AVAILABLE ===\n');
console.log(`Files analyzed: ${files.length}`);
console.log(`Improvements found: ${unique.length}\n`);

const byType = {};
for (const imp of unique) {
  if (!byType[imp.type]) byType[imp.type] = [];
  byType[imp.type].push(imp);
}

console.log('=== SUMMARY ===\n');
for (const [type, list] of Object.entries(byType)) {
  console.log(`${type}: ${list.length}`);
}

console.log('\n=== ACTIONABLE TODOs ===\n');
const todos = unique.filter(i => i.type === 'TODO');
todos.forEach(todo => {
  console.log(`${todo.file}:${todo.line}`);
  console.log(`  ${todo.code}`);
  console.log('');
});

