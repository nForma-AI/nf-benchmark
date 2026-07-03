'use strict';
// Data-access layer. Clean by default: parameterized queries.
function getUserById(db, id) {
  return db.query('SELECT * FROM users WHERE id = ?', [id]);
}
function findByName(db, name) {
  return db.query('SELECT * FROM users WHERE name = ?', [name]);
}
module.exports = { getUserById, findByName };
