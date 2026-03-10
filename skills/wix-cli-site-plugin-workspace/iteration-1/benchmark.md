# Benchmark: wix-cli-site-plugin — Iteration 1

## Summary Table

| Eval | Version | Run | Tokens | Time (s) | Est. Price | Pass Rate | Tool Uses |
|------|---------|-----|--------|----------|------------|-----------|-----------|
| best-seller-badge | new_skill | 1 | 28,092 | 86.1 | $0.0126 | 11/12 | 21 |
| best-seller-badge | new_skill | 2 | 29,093 | 85.7 | $0.0131 | 11/12 | 21 |
| best-seller-badge | old_skill | 1 | 37,164 | 68.2 | $0.0167 | 11/12 | 15 |
| best-seller-badge | old_skill | 2 | 28,970 | 65.3 | $0.0130 | 11/12 | 13 |
| promo-banner | new_skill | 1 | 27,954 | 88.7 | $0.0126 | 11/12 | 21 |
| promo-banner | new_skill | 2 | 26,924 | 88.6 | $0.0121 | 11/12 | 20 |
| promo-banner | old_skill | 1 | 25,956 | 77.6 | $0.0117 | 11/12 | 14 |
| promo-banner | old_skill | 2 | 25,996 | 81.5 | $0.0117 | 11/12 | 14 |
| customers-also-viewed | new_skill | 1 | 30,470 | 86.8 | $0.0137 | 13/14 | 19 |
| customers-also-viewed | new_skill | 2 | 30,770 | 96.2 | $0.0138 | 13/14 | 19 |
| customers-also-viewed | old_skill | 1 | 38,741 | 89.3 | $0.0174 | 13/14 | 16 |
| customers-also-viewed | old_skill | 2 | 30,163 | 84.2 | $0.0136 | 13/14 | 15 |

## Averages by Version

| Eval | Version | Avg Tokens | Avg Time (s) | Avg Price | Pass Rate |
|------|---------|------------|--------------|-----------|-----------|
| best-seller-badge | new_skill | 28,593 | 85.9 | $0.0129 | 11/12 |
| best-seller-badge | old_skill | 33,067 | 66.8 | $0.0149 | 11/12 |
| promo-banner | new_skill | 27,439 | 88.7 | $0.0124 | 11/12 |
| promo-banner | old_skill | 25,976 | 79.6 | $0.0117 | 11/12 |
| customers-also-viewed | new_skill | 30,620 | 91.5 | $0.0138 | 13/14 |
| customers-also-viewed | old_skill | 34,452 | 86.8 | $0.0155 | 13/14 |

## Overall Averages

| Version | Avg Tokens | Avg Time (s) | Avg Price | Avg Tool Uses |
|---------|------------|--------------|-----------|---------------|
| **new_skill** | **28,884** | **88.7** | **0.0130** | **20.2** |
| **old_skill** | **31,165** | **77.7** | **0.0140** | **14.5** |
| **Delta** | **-2,281 (-7.3%)** | **+11.0 (+14.2%)** | **-$0.0010 (-7.1%)** | **+5.7** |

## Key Findings

1. **Tokens: new_skill wins by 7.3%** — The template-based approach uses fewer tokens on average (28.9K vs 31.2K), especially on the more complex eval (customers-also-viewed: 30.6K vs 34.5K).

2. **Time: old_skill wins by 14.2%** — The new skill takes ~11s longer on average due to ~6 extra tool calls (reading/copying template files). This is the main tradeoff.

3. **Price: new_skill wins by 7.1%** — Directly follows from the token savings.

4. **Quality: identical** — Both versions produce the same pass rates across all evals. No quality regression from the refactoring.

5. **Consistency: new_skill is more consistent** — Token variance is lower for new_skill (std dev ~1.5K vs ~4.7K for old_skill), suggesting the template approach produces more predictable outputs.

## Tradeoff Analysis

The assets-based approach trades **wall-clock time for token efficiency and consistency**. Each template read adds a tool call round-trip (~1-2s), and the new skill averages ~6 more tool calls. However, the model generates less from scratch, resulting in fewer tokens and more predictable output structure.

For a skill that will be invoked many times, the **7% token/price savings** at scale outweighs the 11s latency increase per invocation. The consistency improvement is also valuable — less variance means fewer surprising outputs.

## Verdict

**new_skill (assets-based) is the better choice** for production use. The token savings compound at scale, quality is identical, and output consistency improves. The latency increase is modest and could potentially be reduced by consolidating template reads.
