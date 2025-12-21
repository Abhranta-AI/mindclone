// Test search detection logic

const message = "more details about them";
const userMessage = message.toLowerCase();

const isSearchRequest = userMessage.includes('find') ||
                        userMessage.includes('search') ||
                        userMessage.includes('look up') ||
                        userMessage.includes('lookup') ||
                        userMessage.includes('list') ||
                        userMessage.includes('identify') ||
                        userMessage.includes('who is') ||
                        userMessage.includes('what is') ||
                        userMessage.includes('who are') ||
                        userMessage.includes('what are') ||
                        userMessage.includes('tell me about') ||
                        userMessage.includes('more details') ||
                        userMessage.includes('more information') ||
                        userMessage.includes('tell me more') ||
                        userMessage.includes('learn more') ||
                        userMessage.includes('know more') ||
                        userMessage.includes('more about');

console.log('Message:', message);
console.log('Lowercase:', userMessage);
console.log('Is search request:', isSearchRequest);
console.log('\nChecking specific matches:');
console.log('  includes("more details"):', userMessage.includes('more details'));
console.log('  includes("details"):', userMessage.includes('details'));
