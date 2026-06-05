const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../src/env');

loadEnv();

const keys = ['PesaPal_Consumer_Key', 'PesaPal_Consumer_Secret', 'PesaPal_API_URL'];
for (const k of keys) {
  const v = process.env[k];
  console.log(k, v === undefined ? '<undef>' : `len=${v.length} value=${JSON.stringify(v)}`);
}

console.log('--- .env raw lines for PesaPal keys ---');
const env = fs.readFileSync('.env', 'utf8');
const lines = env.split(/\r?\n/);
for (const l of lines) {
  if (/PesaPal/i.test(l)) {
    console.log(JSON.stringify(l));
  }
}

const pkgDir = path.join('node_modules', 'pesapal');
if (fs.existsSync(pkgDir)) {
  const files = fs.readdirSync(pkgDir);
  console.log('package files:', files);
  const jsfiles = files.filter(f => f.endsWith('.js'));
  if (jsfiles.length) {
    const index = fs.readFileSync(path.join(pkgDir, jsfiles[0]), 'utf8');
    console.log('package sample:', index.slice(0, 1000));
  }
}
