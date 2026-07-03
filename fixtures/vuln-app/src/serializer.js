'use strict';
// Deserialization. Clean by default: safe JSON parsing (no code execution).
function deserialize(payload) {
  return JSON.parse(payload);
}
module.exports = { deserialize };
