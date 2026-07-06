'use strict';
// Seeded defect: requires a module that does not exist on disk.
const helper = require('./helpers/missing');
module.exports = { run: () => helper.go() };
