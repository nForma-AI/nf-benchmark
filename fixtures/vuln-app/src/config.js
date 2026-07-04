'use strict';
// App configuration. Clean by default: every secret is read from the environment,
// never hardcoded. The BENCH-042 mutation replaces an env read with a live-key
// literal to exercise the sast `hardcoded-secret` rule.
const config = {
  stripeKey: process.env.STRIPE_SECRET_KEY,
  awsAccessKey: process.env.AWS_ACCESS_KEY_ID,
  tokenType: 'Bearer',
};

module.exports = { config };
