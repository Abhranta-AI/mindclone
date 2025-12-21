const fetch = require('node-fetch');

async function testGoogleSearch() {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  console.log('API Key:', apiKey ? apiKey.substring(0, 20) + '...' : 'MISSING');
  console.log('Search Engine ID:', searchEngineId || 'MISSING');

  if (!apiKey || !searchEngineId) {
    console.error('Missing credentials!');
    process.exit(1);
  }

  const query = 'AI startup founders Gurgaon IIT';
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=5`;

  console.log('Testing search for:', query);

  try {
    const response = await fetch(url);
    const data = await response.json();

    console.log('Status:', response.status);

    if (response.ok) {
      console.log('SUCCESS! Found', data.items?.length || 0, 'results');
      if (data.items && data.items.length > 0) {
        console.log('\nFirst result:');
        console.log('Title:', data.items[0].title);
        console.log('Link:', data.items[0].link);
        console.log('Snippet:', data.items[0].snippet);
      }
    } else {
      console.error('FAILED!');
      console.error('Error:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('Exception:', error.message);
  }
}

testGoogleSearch();
