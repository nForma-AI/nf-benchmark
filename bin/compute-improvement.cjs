#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'results');

function loadResults() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('report-'))
    .sort();
  return files.map(f => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')));
}

function computeImprovementScore() {
  const results = loadResults();
  if (results.length === 0) {
    console.log('No results found. Run benchmarks first.');
    return;
  }

  // Group by challenge ID
  const byChallenge = {};
  for (const r of results) {
    const id = r.challenge.id;
    if (!byChallenge[id]) byChallenge[id] = [];
    byChallenge[id].push(r);
  }

  // Compute pass rate trends per challenge
  const trends = {};
  for (const [id, runs] of Object.entries(byChallenge)) {
    runs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const passRates = runs.map(r => r.score.passed ? 1 : 0);
    const current = passRates[passRates.length - 1];
    const previous = passRates.length > 1 ? passRates[passRates.length - 2] : null;
    const improvement = previous !== null ? current - previous : 0;

    trends[id] = {
      challenge: runs[0].challenge,
      runs: runs.length,
      current_pass: current,
      previous_pass: previous,
      improvement: improvement,
      first_run: runs[0].timestamp,
      last_run: runs[runs.length - 1].timestamp
    };
  }

  // Aggregate scores
  const allTrends = Object.values(trends);
  const totalChallenges = allTrends.length;
  const currentlyPassing = allTrends.filter(t => t.current_pass).length;
  const improved = allTrends.filter(t => t.improvement > 0).length;
  const regressed = allTrends.filter(t => t.improvement < 0).length;
  const stable = allTrends.filter(t => t.improvement === 0).length;

  const overallScore = (currentlyPassing / totalChallenges * 100).toFixed(1);

  // Output
  console.log('========================================');
  console.log('       nf:solve Improvement Score       ');
  console.log('========================================');
  console.log(`Overall Pass Rate: ${currentlyPassing}/${totalChallenges} (${overallScore}%)`);
  console.log(`Improved: ${improved}  Regressed: ${regressed}  Stable: ${stable}`);
  console.log('');

  console.log('Recent Changes:');
  const recent = allTrends
    .filter(t => t.improvement !== 0)
    .sort((a, b) => new Date(b.last_run) - new Date(a.last_run))
    .slice(0, 10);

  if (recent.length === 0) {
    console.log('  No recent changes.');
  } else {
    for (const t of recent) {
      const change = t.improvement > 0 ? '+' : '';
      console.log(`  ${t.challenge.id} ${t.challenge.title.slice(0, 40).padEnd(40)} ${change}${t.improvement} (${t.previous_pass}→${t.current_pass})`);
    }
  }

  // Save to file
  const report = {
    timestamp: new Date().toISOString(),
    overall_score: parseFloat(overallScore),
    metrics: { total_challenges: totalChallenges, currently_passing: currentlyPassing, improved, regressed, stable },
    trends: allTrends
  };

  const reportPath = path.join(RESULTS_DIR, `improvement-${Date.now().toString(36)}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nSaved to ${reportPath}`);

  return report;
}

if (require.main === module) {
  computeImprovementScore();
}
