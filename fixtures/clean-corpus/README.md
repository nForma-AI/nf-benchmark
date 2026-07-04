# clean-corpus

Known-clean code for the precision harness (bin/precision-harness.cjs). Every FP-safe
deterministic detector must produce ZERO findings here. Any finding is a false
positive — a precision regression. Run the harness additionally against a real nForma
checkout (`--clean-root <path>`) to exercise shipping code.
