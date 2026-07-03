'use strict';
const crypto = require('crypto');
// Session validation. Clean by default: constant-time token comparison.
function validateSession(token, expected) {
  const a = Buffer.from(String(token));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
module.exports = { validateSession };
