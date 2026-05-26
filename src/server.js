const config = require('./config');
const { createApp } = require('./app');

const app = createApp();

if (process.argv.includes('--check')) {
  console.log('Backend configuration OK');
  process.exit(0);
}

const server = app.listen(config.port, () => {
  console.log(`Smart Event Venue API running on http://localhost:${config.port}`);
});

server.on('error', (error) => {
  console.error(`Backend failed to start on port ${config.port}:`, error.message);
  process.exitCode = 1;
});

server.on('close', () => {
  console.log('Backend HTTP server closed.');
});
