const config = require('./config');
const { createApp } = require('./app');

const app = createApp();

if (process.argv.includes('--check')) {
  console.log('Backend configuration OK');
  process.exit(0);
}

app.listen(config.port, () => {
  console.log(`Smart Event Venue API running on http://localhost:${config.port}`);
});
