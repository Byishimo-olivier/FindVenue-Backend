const crypto = require('crypto');
const config = require('../config');
const { readCollection, writeCollection } = require('../db/mongoStore');
const { sendPasswordReset, sendVerificationCode } = require('./emailService');
const { HttpError } = require('../utils/errors');
const { cleanString, isEmail, normalizeEmail } = require('../utils/validators');

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    provider: user.provider || 'password',
    verified: Boolean(user.verified),
    createdAt: user.createdAt,
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash || '').split(':');
  if (!salt || !originalHash) return false;

  const hash = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHash, 'hex');
  return original.length === hash.length && crypto.timingSafeEqual(original, hash);
}

function signToken(payload) {
  const body = {
    ...payload,
    exp: Date.now() + config.tokenTtlMs,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const signature = crypto.createHmac('sha256', config.tokenSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) throw new HttpError(401, 'Invalid authentication token.');

  const expected = crypto.createHmac('sha256', config.tokenSecret).update(encoded).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new HttpError(401, 'Invalid authentication token.');
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (payload.exp < Date.now()) throw new HttpError(401, 'Authentication token expired.');
  return payload;
}

function createVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function attachVerificationCode(user) {
  const code = createVerificationCode();
  user.verificationCodeHash = hashVerificationCode(code);
  user.verificationCodeExpiresAt = Date.now() + 1000 * 60 * 10;
  user.verificationCodeCreatedAt = new Date().toISOString();
  return code;
}

function verificationEmailMessage(emailSent) {
  return emailSent
    ? 'Verification code sent to your email. If you do not see it in your inbox, check your Spam or Junk folder.'
    : 'Email was not sent. Please check your email settings and request a new code.';
}

async function registerUser(input) {
  const fullName = cleanString(input.fullName);
  const email = normalizeEmail(input.email);
  const phone = cleanString(input.phone);
  const password = String(input.password || '');
  const role = cleanString(input.role) || 'customer';

  if (!fullName || !email || !phone || !password) {
    throw new HttpError(400, 'Full name, email, phone, and password are required.');
  }
  if (!isEmail(email)) throw new HttpError(400, 'Please provide a valid email address.');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');

  const users = await readCollection('users');
  const existingUser = users.find((user) => user.email === email);
  if (existingUser?.verified) {
    throw new HttpError(409, 'An account with this email already exists.');
  }
  if (existingUser && !existingUser.verified) {
    const verificationCode = attachVerificationCode(existingUser);
    existingUser.fullName = fullName;
    existingUser.phone = phone;
    existingUser.role = role;
    existingUser.passwordHash = hashPassword(password);
    await writeCollection('users', users);
    const emailResult = await sendVerificationCode({ to: existingUser.email, fullName: existingUser.fullName, code: verificationCode });
    const token = signToken({ sub: existingUser.id, role: existingUser.role });

    return {
      user: publicUser(existingUser),
      token,
      emailSent: emailResult.sent,
      emailError: emailResult.sent ? undefined : emailResult.reason,
      message: verificationEmailMessage(emailResult.sent),
    };
  }

  const user = {
    id: crypto.randomUUID(),
    fullName,
    email,
    phone,
    role,
    provider: 'password',
    verified: false,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  const verificationCode = attachVerificationCode(user);

  users.push(user);
  await writeCollection('users', users);
  const emailResult = await sendVerificationCode({ to: user.email, fullName: user.fullName, code: verificationCode });

  const token = signToken({ sub: user.id, role: user.role });
  return {
    user: publicUser(user),
    token,
    emailSent: emailResult.sent,
    emailError: emailResult.sent ? undefined : emailResult.reason,
    message: verificationEmailMessage(emailResult.sent),
  };
}

async function loginUser(input) {
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');

  const users = await readCollection('users');
  const user = users.find((item) => item.email === email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }

  const token = signToken({ sub: user.id, role: user.role });
  return { user: publicUser(user), token };
}

function decodeGoogleCredential(credential) {
  const parts = String(credential || '').split('.');
  if (parts.length < 2) throw new HttpError(400, 'Invalid Google credential.');

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid Google credential payload.');
  }
}

async function loginWithGoogle(input) {
  const payload = input.credential ? decodeGoogleCredential(input.credential) : input.profile || {};

  if (config.googleClientId && payload.aud && payload.aud !== config.googleClientId) {
    throw new HttpError(401, 'Google credential is not for this application.');
  }

  const email = normalizeEmail(payload.email);
  const fullName = cleanString(payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' '));
  if (!email || !isEmail(email)) throw new HttpError(400, 'Google account email is required.');

  const users = await readCollection('users');
  let user = users.find((item) => item.email === email);

  if (!user) {
    user = {
      id: crypto.randomUUID(),
      fullName: fullName || email.split('@')[0],
      email,
      phone: cleanString(input.phone),
      role: cleanString(input.role) || 'customer',
      provider: 'google',
      googleProviderId: cleanString(payload.sub),
      verified: Boolean(payload.email_verified),
      passwordHash: '',
      createdAt: new Date().toISOString(),
    };
    users.push(user);
  } else {
    user.provider = user.provider === 'password' ? 'password' : 'google';
    user.googleProviderId = user.googleProviderId || cleanString(payload.sub);
    user.verified = user.verified || Boolean(payload.email_verified);
  }

  await writeCollection('users', users);
  const token = signToken({ sub: user.id, role: user.role });
  return { user: publicUser(user), token };
}

async function requestPasswordReset(input) {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) throw new HttpError(400, 'Please provide a valid email address.');

  const users = await readCollection('users');
  const user = users.find((item) => item.email === email);
  const resetTokens = await readCollection('resetTokens');
  const token = crypto.randomBytes(24).toString('hex');

  if (user) {
    resetTokens.push({
      token,
      userId: user.id,
      expiresAt: Date.now() + 1000 * 60 * 30,
      used: false,
      createdAt: new Date().toISOString(),
    });
    await writeCollection('resetTokens', resetTokens);
    const resetUrl = `${config.frontendUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
    await sendPasswordReset({ to: user.email, fullName: user.fullName, resetUrl });
  }

  return {
    message: 'If an account exists, a password reset link has been created.',
    resetToken: user ? token : undefined,
  };
}

async function resetPassword(input) {
  const token = cleanString(input.token);
  const password = String(input.password || '');
  if (!token) throw new HttpError(400, 'Reset token is required.');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');

  const resetTokens = await readCollection('resetTokens');
  const resetToken = resetTokens.find((item) => item.token === token);
  if (!resetToken || resetToken.used || resetToken.expiresAt < Date.now()) {
    throw new HttpError(400, 'Reset token is invalid or expired.');
  }

  const users = await readCollection('users');
  const user = users.find((item) => item.id === resetToken.userId);
  if (!user) throw new HttpError(400, 'Reset token is invalid.');

  user.passwordHash = hashPassword(password);
  user.provider = user.provider || 'password';
  resetToken.used = true;
  resetToken.usedAt = new Date().toISOString();

  await writeCollection('users', users);
  await writeCollection('resetTokens', resetTokens);
  return { message: 'Password reset successfully.' };
}

async function verifyAccount(userId, input) {
  const code = cleanString(input.code);
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Verification code must be 6 digits.');

  const users = await readCollection('users');
  const user = users.find((item) => item.id === userId);
  if (!user) throw new HttpError(401, 'User account no longer exists.');
  if (user.verified) return { user: publicUser(user) };
  if (!user.verificationCodeHash || !user.verificationCodeExpiresAt) {
    throw new HttpError(400, 'No verification code exists. Please request a new code.');
  }
  if (user.verificationCodeExpiresAt < Date.now()) {
    throw new HttpError(400, 'Verification code expired. Please request a new code.');
  }
  if (user.verificationCodeHash !== hashVerificationCode(code)) {
    throw new HttpError(400, 'Verification code is incorrect.');
  }

  user.verified = true;
  user.verificationMethod = cleanString(input.method || 'authenticator');
  user.verifiedAt = new Date().toISOString();
  delete user.verificationCodeHash;
  delete user.verificationCodeExpiresAt;
  delete user.verificationCodeCreatedAt;
  await writeCollection('users', users);
  return { user: publicUser(user) };
}

async function resendVerificationCode(userId) {
  const users = await readCollection('users');
  const user = users.find((item) => item.id === userId);
  if (!user) throw new HttpError(401, 'User account no longer exists.');
  if (user.verified) return { user: publicUser(user), message: 'Account is already verified.' };

  const verificationCode = attachVerificationCode(user);
  await writeCollection('users', users);
  const emailResult = await sendVerificationCode({ to: user.email, fullName: user.fullName, code: verificationCode });

  return {
    user: publicUser(user),
    emailSent: emailResult.sent,
    emailError: emailResult.sent ? undefined : emailResult.reason,
    message: verificationEmailMessage(emailResult.sent),
  };
}

async function getUserById(id) {
  const users = await readCollection('users');
  const user = users.find((item) => item.id === id);
  if (!user) throw new HttpError(401, 'User account no longer exists.');
  return user;
}

module.exports = {
  getUserById,
  loginUser,
  loginWithGoogle,
  publicUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  resendVerificationCode,
  verifyAccount,
  verifyToken,
};
