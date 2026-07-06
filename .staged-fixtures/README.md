# Staged fixtures — ahead of the published npm nf-solve

These external-project detection fixtures pass against nForma HEAD but the pinned
@nforma.ai/nforma npm SUT does not yet detect them (sql-injection via sast,
dangling-require via require_graph). Restore into `fixtures/` once a newer nf-solve is
published to npm. The git-init harness fix (lib/fixture-runner.cjs) that makes git-scoped
detectors work on external fixtures is already merged.
