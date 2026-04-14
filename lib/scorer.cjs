'use strict';

const fs = require('fs');
const path = require('path');

function scoreChallenge(challenge, preResidual, postResidual, solveOutput, error) {
  const method = challenge.scoring.method;
  const targetLayer = challenge.scoring.target_layer;

  if (error) {
    return {
      passed: false,
      score: 0,
      reason: `Solver error: ${error.message}`,
      details: { method, error: true }
    };
  }

  switch (method) {
    case 'residual_zero':
      return scoreResidualZero(preResidual, postResidual, targetLayer);
    case 'residual_decreased':
      return scoreResidualDecreased(preResidual, postResidual, targetLayer);
    case 'residual_layer_zero':
      return scoreLayerZero(preResidual, postResidual, targetLayer);
    case 'file_restored':
      return { passed: false, score: 0, reason: 'File restoration scoring not yet implemented', details: { method } };
    case 'json_field_restored':
      return { passed: false, score: 0, reason: 'JSON field restoration scoring not yet implemented', details: { method } };
    case 'convergence_achieved':
      return scoreConvergence(postResidual);
    case 'detection_only':
      return scoreDetection(solveOutput, challenge);
    case 'no_crash':
      return { passed: true, score: 1, reason: 'Solver completed without crash', details: { method } };
    case 'custom':
      return { passed: false, score: 0, reason: 'Custom scoring not yet implemented', details: { method } };
    default:
      return { passed: false, score: 0, reason: `Unknown scoring method: ${method}`, details: { method } };
  }
}

function scoreResidualZero(pre, post, targetLayer) {
  const postTotal = post?.total ?? -1;
  const passed = postTotal === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? 'Total residual is zero after solve'
      : `Total residual is ${postTotal} (expected 0)`,
    details: { pre_total: pre?.total, post_total: postTotal, target_layer: targetLayer }
  };
}

function scoreResidualDecreased(pre, post, targetLayer) {
  if (!pre || pre.total === undefined) {
    return { passed: false, score: 0, reason: 'No valid pre-residual baseline', details: { pre, post_total: post?.total } };
  }
  const preTotal = pre.total;
  const postTotal = post?.total ?? Infinity;
  const passed = postTotal < preTotal;
  return {
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Residual decreased from ${preTotal} to ${postTotal}`
      : `Residual did not decrease (${preTotal} -> ${postTotal})`,
    details: { pre_total: preTotal, post_total: postTotal, target_layer: targetLayer }
  };
}

function scoreLayerZero(pre, post, targetLayer) {
  if (!targetLayer) {
    return { passed: false, score: 0, reason: 'No target_layer specified', details: {} };
  }
  const preLayer = pre?.[targetLayer]?.residual ?? -1;
  const postLayer = post?.[targetLayer]?.residual ?? -1;
  const passed = postLayer === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Layer ${targetLayer} residual is zero after solve`
      : `Layer ${targetLayer} residual is ${postLayer} (expected 0, was ${preLayer})`,
    details: { pre_layer: preLayer, post_layer: postLayer, target_layer: targetLayer }
  };
}

function scoreConvergence(post) {
  const total = post?.total ?? -1;
  const passed = total === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? 'Convergence achieved — total residual is zero'
      : `Not converged — total residual is ${total}`,
    details: { post_total: total }
  };
}

function scoreDetection(output, challenge) {
  const expectedLayers = challenge.expected_outcome?.layers_affected || [];
  const outputStr = typeof output === 'string' ? output : JSON.stringify(output || '');

  let detected = false;
  for (const layer of expectedLayers) {
    if (layer && outputStr.includes(layer)) {
      detected = true;
      break;
    }
  }

  for (const layer of challenge.target_layers || []) {
    if (layer && outputStr.includes(layer)) {
      detected = true;
      break;
    }
  }

  const residualMentioned = outputStr.includes('residual') || outputStr.includes('gap') || outputStr.includes('mismatch');

  if (expectedLayers.length === 0 && residualMentioned) {
    detected = true;
  }

  return {
    passed: detected || (expectedLayers.length === 0 && residualMentioned),
    score: (detected || residualMentioned) ? 1 : 0,
    reason: (detected || residualMentioned)
      ? 'Issue detected in solver output'
      : 'Issue not detected in solver output',
    details: { expected_layers: expectedLayers, detected }
  };
}

function computeReport(results) {
  const total = results.length;
  const passed = results.filter(r => r.score.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? (passed / total * 100).toFixed(1) : '0.0';

  const byCategory = {};
  const byDifficulty = {};
  const byLayer = {};

  for (const r of results) {
    const c = r.challenge;
    if (!c) continue; // skip results without challenge
    if (!byCategory[c.category]) byCategory[c.category] = { passed: 0, total: 0 };
    byCategory[c.category].total++;
    if (r.score.passed) byCategory[c.category].passed++;

    if (!byDifficulty[c.difficulty]) byDifficulty[c.difficulty] = { passed: 0, total: 0 };
    byDifficulty[c.difficulty].total++;
    if (r.score.passed) byDifficulty[c.difficulty].passed++;

    if (c.target_layers) {
      for (const layer of c.target_layers) {
        if (!byLayer[layer]) byLayer[layer] = { passed: 0, total: 0 };
        byLayer[layer].total++;
        if (r.score.passed) byLayer[layer].passed++;
      }
    }
  }

  return { total, passed, failed, passRate, byCategory, byDifficulty, byLayer };
}

function formatReport(report) {
  const lines = [];
  lines.push('========================================');
  lines.push('       nf:solve Benchmark Report        ');
  lines.push('========================================');
  lines.push(`Total: ${report.total}  Passed: ${report.passed}  Failed: ${report.failed}  Rate: ${report.passRate}%`);
  lines.push('');

  lines.push('By Category:');
  for (const [cat, data] of Object.entries(report.byCategory).sort()) {
    const rate = (data.passed / data.total * 100).toFixed(1);
    lines.push(`  ${cat.padEnd(30)} ${data.passed}/${data.total} (${rate}%)`);
  }
  lines.push('');

  lines.push('By Difficulty:');
  for (const diff of ['easy', 'medium', 'hard', 'expert']) {
    const data = report.byDifficulty[diff];
    if (!data) continue;
    const rate = (data.passed / data.total * 100).toFixed(1);
    lines.push(`  ${diff.padEnd(10)} ${data.passed}/${data.total} (${rate}%)`);
  }
  lines.push('');

  lines.push('By Layer:');
  for (const [layer, data] of Object.entries(report.byLayer).sort()) {
    const rate = (data.passed / data.total * 100).toFixed(1);
    lines.push(`  ${layer.padEnd(12)} ${data.passed}/${data.total} (${rate}%)`);
  }
  lines.push('========================================');

  return lines.join('\n');
}

module.exports = {
  scoreChallenge,
  computeReport,
  formatReport
};
