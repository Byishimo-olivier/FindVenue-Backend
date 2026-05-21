const { getUserById, publicUser, verifyToken } = require('../services/authService');
const { HttpError } = require('../utils/errors');

async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'Authentication is required.');

    const payload = verifyToken(token);
    const user = await getUserById(payload.sub);
    req.user = publicUser(user);
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, 'You do not have permission for this action.'));
      return;
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
