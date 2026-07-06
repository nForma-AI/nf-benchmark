'use strict';
// Seeded defect: SQL injection — user input concatenated into the query string.
// Fix: use a parameterized query (db.query('... WHERE id = ?', [userId])).
function getUser(db, userId) {
  return db.query("SELECT * FROM users WHERE id = " + userId);
}
module.exports = { getUser };
