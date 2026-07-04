'use strict';
// Config hook B. Clean by default: B has no back-edge to A (so no cycle).
function loadB() { return { b: true }; }
module.exports = { loadB };
