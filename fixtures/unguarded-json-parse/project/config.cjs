'use strict';
// Seeded defect: JSON.parse with no guard — throws on malformed/empty input.
// Fix: wrap in try/catch and return the default config on parse failure.
function loadConfig(text) {
  return JSON.parse(text);
}
module.exports = { loadConfig };
