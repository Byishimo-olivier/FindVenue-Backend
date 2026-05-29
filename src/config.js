const { loadEnv } = require('./env');

loadEnv();

function getNumberEnv(...keys) {
  for (const key of keys) {
    if (process.env[key] !== undefined && process.env[key] !== '') {
      return Number(process.env[key]);
    }
  }
  return undefined;
}

function getBooleanEnv(key) {
  if (process.env[key] === undefined || process.env[key] === '') return undefined;
  return String(process.env[key]).toLowerCase() === 'true';
}

const mailPort = getNumberEnv('MAIL_PORT', 'SMTP_PORT') || 465;
const explicitMailSecure = getBooleanEnv('MAIL_SECURE');
const dbUrl = process.env.db_url || process.env.url_db || process.env.DB_URL || process.env.DATABASE_URL || process.env.MONGODB_URI || process.env.URL_DB || '';

function normalizeMailPassword(value, host) {
  const password = String(value || '');
  if (/gmail/i.test(host || '')) return password.replace(/\s+/g, '');
  return password;
}

function getDbNameFromUrl(url) {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\/+|\/+$/g, ''));
  } catch (_error) {
    return '';
  }
}

const config = {
  port: Number(process.env.PORT || process.env.port || 4000),
  tokenSecret: process.env.TOKEN_SECRET || 'dev-token-secret-change-me',
  tokenTtlMs: 1000 * 60 * 60 * 24 * 7,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || '',
  frontendUrl: process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173',
  backendUrl: process.env.BACKEND_URL || '',
  mailUser: process.env.MAIL_USER || process.env.EMAIL_USER || process.env.USERNAME || '',
  mailHost: process.env.MAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
  mailPort,
  mailSecure: explicitMailSecure === undefined ? mailPort === 465 : explicitMailSecure,
  mailRequireTls: getBooleanEnv('MAIL_REQUIRE_TLS'),
  mailDebug: getBooleanEnv('MAIL_DEBUG') === true,
  dbUrl,
  dbName: process.env.DB_NAME || process.env.db_name || getDbNameFromUrl(dbUrl) || 'smart_event_venue',
  openAiApiKey: process.env.OPENAI_API_KEY || process.env.openai_api_key || '',
  openAiModel: process.env.OPENAI_MODEL || process.env.openai_model || 'gpt-5.4-mini',
  exposeDevCodes: process.env.NODE_ENV !== 'production',
};

config.mailPassword = normalizeMailPassword(
  process.env.MAIL_PASSWORD || process.env.EMAIL_PASSWORD || process.env.USER_PASSWORD || '',
  config.mailHost,
);
config.mailFrom = process.env.MAIL_FROM || process.env.MAIL_USER || process.env.EMAIL_USER || process.env.USERNAME || '';

module.exports = config;
