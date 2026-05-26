const fs = require('fs');
const path = require('path');

function loadEnv(filePath = path.resolve(__dirname, '..', '.env')) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const [rawKey, ...rawValueParts] = trimmed.split('=');
    const key = rawKey.trim();
    const value = rawValueParts.join('=').trim().replace(/^['"]|['"]$/g, '');

    if (key) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadEnv };
