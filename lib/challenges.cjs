'use strict';

const fs = require('fs');
const path = require('path');

const CHALLENGES_DIR = path.join(__dirname, '..', 'challenges');

function loadAllChallenges() {
  const files = fs.readdirSync(CHALLENGES_DIR)
    .filter(f => f.endsWith('.json') && f !== 'challenge.schema.json')
    .sort();
  const all = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(CHALLENGES_DIR, f), 'utf8'));
    all.push(...data);
  }
  return all;
}

function loadChallenge(id) {
  const all = loadAllChallenges();
  return all.find(c => c.id === id) || null;
}

function loadByCategory(category) {
  return loadAllChallenges().filter(c => c.category === category);
}

function loadByDifficulty(difficulty) {
  return loadAllChallenges().filter(c => c.difficulty === difficulty);
}

function getCategories() {
  const cats = new Set();
  for (const c of loadAllChallenges()) cats.add(c.category);
  return [...cats].sort();
}

function getDifficulties() {
  return ['easy', 'medium', 'hard', 'expert'];
}

function validateChallenge(challenge) {
  const errors = [];
  if (!challenge.id || !/^BENCH-\d{3}$/.test(challenge.id)) {
    errors.push(`Invalid id: ${challenge.id}`);
  }
  if (!challenge.title) errors.push('Missing title');
  if (!challenge.category) errors.push('Missing category');
  if (!challenge.difficulty) errors.push('Missing difficulty');
  if (!challenge.target_layers || challenge.target_layers.length === 0) {
    errors.push('Missing target_layers');
  }
  if (!challenge.mutation) errors.push('Missing mutation');
  if (!challenge.expected_outcome) errors.push('Missing expected_outcome');
  if (!challenge.scoring) errors.push('Missing scoring');
  return errors;
}

function validateAll() {
  const all = loadAllChallenges();
  const results = [];
  const ids = new Set();
  for (const c of all) {
    const errors = validateChallenge(c);
    if (ids.has(c.id)) errors.push(`Duplicate id: ${c.id}`);
    ids.add(c.id);
    results.push({ id: c.id, valid: errors.length === 0, errors });
  }
  return results;
}

function printSummary() {
  const all = loadAllChallenges();
  const byCategory = {};
  const byDifficulty = {};
  for (const c of all) {
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    byDifficulty[c.difficulty] = (byDifficulty[c.difficulty] || 0) + 1;
  }
  console.log(`\nnf-benchmark: ${all.length} challenges loaded\n`);
  console.log('By Category:');
  for (const [cat, count] of Object.entries(byCategory).sort()) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log('\nBy Difficulty:');
  for (const [diff, count] of Object.entries(byDifficulty)) {
    console.log(`  ${diff}: ${count}`);
  }
  return { total: all.length, byCategory, byDifficulty };
}

module.exports = {
  loadAllChallenges,
  loadChallenge,
  loadByCategory,
  loadByDifficulty,
  getCategories,
  getDifficulties,
  validateChallenge,
  validateAll,
  printSummary,
  CHALLENGES_DIR
};
