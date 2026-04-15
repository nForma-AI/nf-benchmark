'use strict';

const fs = require('fs');
const path = require('path');

// Mapping from benchmark layer names to nf-solve canonical output keys.
// The benchmark was authored with conceptual layer names; nf-solve uses its own key names.
const LAYER_ALIASES = {
  'c_to_e': 'git_heatmap',      // code→evidence = git heatmap (high-churn files w/o formal coverage)
  'c_to_t': 't_to_c',           // code→tests ≈ tests→code (test relationship, same pair)
  'f_to_f': 'formal_lint',      // formal→formal = formal model self-consistency lint
  'f_to_g': 'per_model_gates',  // formal→gate = per-model gate maturity
  'f_to_h': 'hazard_model',     // formal→hazard = FMEA hazard model
  'g_to_f': 'git_history',      // gate→formal = git history driven formal gap
  'l1_to_l2': 'l1_to_l3',      // L1→L2 collapsed into L1→L3 (STRUCT-01)
  'l2_to_l3': 'l3_to_tc',      // L2→L3 collapsed into L3→TC
  'r_to_c': 'c_to_r',          // req→code ≈ code→req (same pair, reverse direction)
  'r_to_t': 't_to_r',          // req→tests ≈ tests→req (same pair, reverse direction)
  't_to_d': 'd_to_r',          // tests→docs ≈ docs→req (closest available)
};

// Resolve a layer name through LAYER_ALIASES and return its residual from a residual_vector.
// Returns -1 if the layer is not present (skipped in run mode).
function getLayerResidual(rv, layer) {
  if (!rv || !layer) return -1;
  if (rv[layer] !== undefined) return rv[layer].residual ?? -1;
  const alias = LAYER_ALIASES[layer];
  if (alias && rv[alias] !== undefined) return rv[alias].residual ?? -1;
  return -1;
}

// Continuous score: fraction of total residual reduced by the solve run.
// Positive = solver reduced gaps. Negative = solver made it worse. Range [-1, 1].
// For detection challenges (mutation increases gaps), this will be negative — that's expected and correct.
function reductionScore(pre, post) {
  const preTotal = pre?.total ?? 0;
  if (preTotal === 0) return 0;
  return (preTotal - (post?.total ?? preTotal)) / preTotal;
}

function scoreChallenge(challenge, preResidual, postResidual, solveOutput, error) {
  const method = challenge.scoring.method;
  const targetLayer = challenge.scoring.target_layer;

  if (error) {
    return {
      passed: false,
      score: 0,
      reduction_score: 0,
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
      return { passed: false, score: 0, reduction_score: 0, reason: 'File restoration scoring not yet implemented', details: { method } };
    case 'json_field_restored':
      return { passed: false, score: 0, reduction_score: 0, reason: 'JSON field restoration scoring not yet implemented', details: { method } };
    case 'convergence_achieved':
      return scoreConvergence(preResidual, postResidual);
    case 'detection_only':
      return scoreDetection(solveOutput, challenge, preResidual, postResidual);
    case 'no_crash':
      return {
        passed: true,
        score: 1,
        reduction_score: reductionScore(preResidual, postResidual),
        reason: 'Solver completed without crash',
        details: { method }
      };
    case 'custom':
      // Custom end-to-end challenges: pass if solver detects any of the target layers
      return scoreDetection(solveOutput, challenge, preResidual, postResidual);
    default:
      return { passed: false, score: 0, reduction_score: 0, reason: `Unknown scoring method: ${method}`, details: { method } };
  }
}

function scoreResidualZero(pre, post, targetLayer) {
  const postTotal = post?.total ?? -1;
  const passed = postTotal === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    reduction_score: reductionScore(pre, post),
    reason: passed
      ? 'Total residual is zero after solve'
      : `Total residual is ${postTotal} (expected 0)`,
    details: { pre_total: pre?.total, post_total: postTotal, target_layer: targetLayer }
  };
}

function scoreResidualDecreased(pre, post, targetLayer) {
  if (!pre || pre.total === undefined) {
    return { passed: false, score: 0, reduction_score: 0, reason: 'No valid pre-residual baseline', details: { pre, post_total: post?.total } };
  }
  const preTotal = pre.total;
  const postTotal = post?.total ?? Infinity;
  const passed = postTotal < preTotal;
  return {
    passed,
    score: passed ? 1 : 0,
    reduction_score: reductionScore(pre, post),
    reason: passed
      ? `Residual decreased from ${preTotal} to ${postTotal}`
      : `Residual did not decrease (${preTotal} -> ${postTotal})`,
    details: { pre_total: preTotal, post_total: postTotal, target_layer: targetLayer }
  };
}

function scoreLayerZero(pre, post, targetLayer) {
  if (!targetLayer) {
    return { passed: false, score: 0, reduction_score: 0, reason: 'No target_layer specified', details: {} };
  }
  const preLayer = getLayerResidual(pre, targetLayer);
  const postLayer = getLayerResidual(post, targetLayer);
  // Layer was skipped in both pre and post (e.g. t_to_c in --fast mode) — not applicable
  if (preLayer === -1 && postLayer === -1) {
    return {
      passed: true,
      score: 1,
      reduction_score: reductionScore(pre, post),
      reason: `Layer ${targetLayer} skipped in current run mode — not applicable`,
      details: { skipped: true, target_layer: targetLayer }
    };
  }
  const passed = postLayer === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    reduction_score: reductionScore(pre, post),
    reason: passed
      ? `Layer ${targetLayer} residual is zero after solve`
      : `Layer ${targetLayer} residual is ${postLayer} (expected 0, was ${preLayer})`,
    details: { pre_layer: preLayer, post_layer: postLayer, target_layer: targetLayer }
  };
}

function scoreConvergence(pre, post) {
  const total = post?.total ?? -1;
  const passed = total === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    reduction_score: reductionScore(pre, post),
    reason: passed
      ? 'Convergence achieved — total residual is zero'
      : `Not converged — total residual is ${total}`,
    details: { post_total: total }
  };
}

// Detection scoring — checks whether nf-solve correctly reported a higher residual
// for the mutated layer (i.e., it noticed the injected gap).
//
// Primary method: residual_layer_increased — post[targetLayer].residual > pre[targetLayer].residual
// Fallback: keyword matching (less reliable, used when residuals are unavailable)
function scoreDetection(output, challenge, preResidual, postResidual) {
  const targetLayer = challenge.scoring.target_layer;
  const expectedLayers = challenge.expected_outcome?.layers_affected || [];

  // Primary: residual-based detection for the scoring target_layer
  if (targetLayer && preResidual && postResidual) {
    const preLayer = getLayerResidual(preResidual, targetLayer);
    const postLayer = getLayerResidual(postResidual, targetLayer);
    if (preLayer >= 0 && postLayer >= 0) {
      const detected = postLayer > preLayer;
      return {
        passed: detected,
        score: detected ? 1 : 0,
        reduction_score: reductionScore(preResidual, postResidual),
        reason: detected
          ? `Layer ${targetLayer} residual increased ${preLayer}→${postLayer} — mutation detected`
          : `Layer ${targetLayer} residual unchanged (${preLayer}→${postLayer}) — mutation not detected`,
        details: {
          method: 'residual_layer_increased',
          pre_layer: preLayer,
          post_layer: postLayer,
          target_layer: targetLayer
        }
      };
    }
  }

  // Secondary: check any of the expected_outcome layers
  if (expectedLayers.length > 0 && preResidual && postResidual) {
    for (const layer of expectedLayers) {
      const preLayer = getLayerResidual(preResidual, layer);
      const postLayer = getLayerResidual(postResidual, layer);
      if (preLayer >= 0 && postLayer >= 0 && postLayer > preLayer) {
        return {
          passed: true,
          score: 1,
          reduction_score: reductionScore(preResidual, postResidual),
          reason: `Layer ${layer} residual increased ${preLayer}→${postLayer} — mutation detected`,
          details: { method: 'residual_layer_increased', matched_layer: layer }
        };
      }
    }
    // All expected layers checked — none increased
    return {
      passed: false,
      score: 0,
      reduction_score: reductionScore(preResidual, postResidual),
      reason: `No expected layer showed increased residual after mutation`,
      details: { method: 'residual_layer_increased', expected_layers: expectedLayers }
    };
  }

  // Fallback: keyword matching (used when residual_vector is unavailable)
  const outputStr = typeof output === 'string' ? output : JSON.stringify(output || '');
  let detected = false;

  function checkLayer(layer) {
    if (!layer || detected) return;
    if (outputStr.includes(layer)) { detected = true; return; }
    const alias = LAYER_ALIASES[layer];
    if (alias && outputStr.includes(alias)) detected = true;
  }

  for (const layer of expectedLayers) checkLayer(layer);
  for (const layer of challenge.target_layers || []) checkLayer(layer);

  const passed = detected;
  return {
    passed,
    score: passed ? 1 : 0,
    reduction_score: 0,
    reason: passed
      ? 'Mutation detected in solver output (keyword fallback)'
      : 'Mutation not detected in solver output',
    details: { method: 'keyword_fallback', expected_layers: expectedLayers, detected }
  };
}

function computeReport(results) {
  const total = results.length;
  const passed = results.filter(r => r.score.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? (passed / total * 100).toFixed(1) : '0.0';

  // Aggregate continuous reduction scores (only for non-detection challenges where it's meaningful)
  const reductionScores = results
    .filter(r => r.score.reduction_score !== undefined && r.score.reduction_score !== null)
    .map(r => r.score.reduction_score);
  const avgReductionScore = reductionScores.length > 0
    ? reductionScores.reduce((a, b) => a + b, 0) / reductionScores.length
    : 0;

  const byCategory = {};
  const byDifficulty = {};
  const byLayer = {};

  for (const r of results) {
    const c = r.challenge;
    if (!c) continue;
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

  return { total, passed, failed, passRate, avgReductionScore, byCategory, byDifficulty, byLayer };
}

function formatReport(report) {
  const lines = [];
  lines.push('========================================');
  lines.push('       nf:solve Benchmark Report        ');
  lines.push('========================================');
  lines.push(`Total: ${report.total}  Passed: ${report.passed}  Failed: ${report.failed}  Rate: ${report.passRate}%`);
  const redStr = (report.avgReductionScore * 100).toFixed(1);
  const redSign = report.avgReductionScore >= 0 ? '+' : '';
  lines.push(`Avg Reduction Score: ${redSign}${redStr}%  (positive = solver reduces gaps, negative = mutation increases gaps as expected)`);
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
  formatReport,
  getLayerResidual,
  reductionScore,
  LAYER_ALIASES
};
