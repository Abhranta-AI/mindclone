// Test the tool filtering logic

const tools = [
  {
    function_declarations: [
      {
        name: "show_slide",
        description: "Display a slide",
        parameters: {}
      },
      {
        name: "draw_canvas",
        description: "Draw something",
        parameters: {}
      },
      {
        name: "web_search",
        description: "Search the web",
        parameters: {}
      }
    ]
  }
];

console.log('Original tools:', JSON.stringify(tools, null, 2));

const filtered = tools.map(t => ({
  function_declarations: t.function_declarations.filter(fd => fd.name === 'web_search')
})).filter(t => t.function_declarations.length > 0);

console.log('\n\nFiltered tools:', JSON.stringify(filtered, null, 2));

console.log('\n\nFiltered count:', filtered[0]?.function_declarations?.length || 0);
