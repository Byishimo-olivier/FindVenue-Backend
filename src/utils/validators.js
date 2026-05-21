function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || '').trim());
  return missing;
}

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

module.exports = { isEmail, requireFields, cleanString, normalizeEmail };
