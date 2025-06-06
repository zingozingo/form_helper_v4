const fs = require('fs');

// Read the HTML file
const html = fs.readFileSync('test-foundation.html', 'utf8');

// Extract the main script content (the last script tag)
const scriptMatch = html.match(/<script>[\s\S]*?console\.log\('🟢 Script starting to load\.\.\.\'\);[\s\S]*?<\/script>/);

if (scriptMatch) {
    const scriptContent = scriptMatch[0].replace(/<\/?script>/g, '');
    
    // Write to a temporary JS file
    fs.writeFileSync('temp-script.js', scriptContent);
    console.log('Script extracted to temp-script.js');
    
    // Try to parse it
    try {
        new Function(scriptContent);
        console.log('✅ Script syntax is valid!');
    } catch (error) {
        console.error('❌ Syntax error:', error.message);
        console.error('Line:', error.stack.split('\n')[0]);
    }
} else {
    console.error('Could not find script content');
}