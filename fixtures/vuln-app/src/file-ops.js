'use strict';
const path = require('path');
// File path building. Clean by default: portable path.join.
function resolveUpload(baseDir, name) {
  return path.join(baseDir, name);
}
module.exports = { resolveUpload };
