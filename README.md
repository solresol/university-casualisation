# university-casualisation
Various charts and numbers on casualisation in universities

## What this project is

This repo collects institution-level Australian higher-education data on:

- **Casualisation** (as *casual staff FTE share*, not headcount share)
- **Student experience** (QILT / SES, via ComparED)
- **Profitability** (via the Department’s finance tables; net margin derived)

The immediate goal is to build a small website with **interactive charts** (Plotly/D3) that lets people explore these relationships and inspect underlying sourcing.

## Dataset (with sourcing)

- `data/qilt_casual_profitability_sourced.csv`
  - 42 matched institutions.
  - Includes **source URLs** and (for spreadsheets) **sheet + cell references** for each number.
  - Key fields include:
    - Staff: `actual_casual_fte_2023`, `total_actual_fte_2023`, `casual_share_actual_fte_2023_pct`, plus teaching-only variants.
    - QILT/SES: `qilt_undergrad_overall_experience_pct` (“Had a positive overall experience”, pooled across two most recent SES years per ComparED).
    - Finance: `total_revenue_2023_k_aud`, `net_operating_result_2023_k_aud`, `net_margin_2023_pct` (derived).

Primary data sources (see per-cell `*_source_*` columns for exact references):

- Department of Education staff “Appendix 1 – Actual staff FTE” (2023 actual staff FTE by institution).
- ComparED institution pages (QILT/SES results).
- Department of Education “Finance 2023” higher-education provider tables (derived from audited financial statements per the Department).

## Baselines (context)

These are useful “sanity check” benchmarks that sit outside the matched university dataset:

- **Australian economy overall (ABS, Aug 2025):** 20.0% of employees without paid holiday/sick leave (ABS proxy for casual); 19.5% self-identified as casual.
- **Universities / higher ed providers (Dept staff series, 2023):** casual staff were 14.4% of total staff FTE (Table A + B), down from 15.3% in 2022 and 17.8% in 2019.
- **Within universities (2023):** teaching-only roles were 64.7% casual; Level A / below lecturer academic FTE were 53.5% casual.
- **Education & training industry (ABS, Aug 2025):** about 16.3% self-identified as casual (≈200.1k casual employees).

These use different statistical definitions (employee counts vs FTE; proxy vs self-identified). Treat them as rough benchmarks, not apples-to-apples.

## Two concrete examples (Divinity vs Macquarie)

Using the “actual staff FTE” measure:

- **University of Divinity**: 7.51 casual FTE / 180.00 total FTE → **4.17%** casual share; QILT overall experience **90.7%**; 2023 net margin **-7.82%**.
- **Macquarie University**: 589.02 casual FTE / 3,534.78 total FTE → **16.66%** casual share; QILT overall experience **76.1%**; 2023 net margin **-9.50%**.

## Findings so far (institution-level, observational)

### Casual share vs QILT “overall experience”

In a simple one-predictor fit across the 42 matched institutions, the relationship is essentially flat:

- Pearson r ≈ 0.041
- R² ≈ 0.002 (p ≈ 0.798)

### Casual share vs profitability (net margin)

Using robust regressors with repeated 5-fold cross-validation (20 repeats), the out-of-sample R² values are negative:

- Theil–Sen: mean CV R² = -0.496
- RANSAC: mean CV R² = -1.046
- Huber: mean CV R² = -0.386

Interpretation: **in this dataset, casual share alone does not reliably predict net margin**, and the signal (if any) is swamped by noise/confounding.

### Wording that stays honest

Defensible:

> In these institution-level data, we found no clear evidence that a higher or lower casual staff share is associated with either profitability (net margin) or undergraduate overall student experience.

Not defensible (causal leap):

> Increasing or decreasing casuals has no impact.

## Caveats (important)

- **Not causal**: cross-sectional university-level data are confounded.
- **FTE share ≠ headcount share**: public staff releases don’t publish casual headcount.
- **Timing alignment is imperfect**: ComparED pools SES years; staff metric here is 2023 actual casual FTE.
- **Aggregation hides heterogeneity**: within-university patterns can wash out.

## Website + deployment target

There is a deployment target available via SSH:

- Host: `casualisation@merah`
- Web root: `/var/www/vhosts/casualisation.symmachus.org/htdocs/`
- Public URL: https://casualisation.symmachus.org/ (HTTP 200 confirmed on 2026-03-03)

Planned site features:

- Interactive scatter plots (Casual share ↔ QILT; Casual share ↔ net margin), with tooltips and filters.
- “Show your working”: click-through to row-level sourcing (URLs, sheet/cell refs).
- Downloadable CSVs and a short methods note.

## DOI / citation

Goal: mint a DOI for this repo so it can be cited in papers. Likely approach:

- Connect the GitHub repo to Zenodo and create a GitHub Release.
- Zenodo archives the release and mints a DOI.
- Add the DOI badge + “How to cite” text to this README once minted.

## Substack post

Drafts for a Substack post should live locally (not in git). The plan is:

- Write a draft in a `substack/` folder (gitignored).
- Publish on Substack.
- Add the final published URL here.

## Repro / build

Python dependencies are in `requirements.txt`.

Build everything (metrics, plots, Substack draft + PNGs, and a deployable website bundle in `dist/`):

```bash
python3 scripts/build.py all
```

Key outputs:

- `outputs/metrics/summary.json`
- `outputs/metrics/robust_regression_cv_r2.csv`
- `outputs/plots/*.png`
- `substack/draft.md` (gitignored)
- `substack/assets/*.png` (gitignored)
- `dist/` (gitignored; deployable static site bundle)

## Deploy

Deploy to the server described above:

```bash
bash scripts/deploy_site.sh
```

Local preview:

```bash
python3 scripts/build.py dist
cd dist
python3 -m http.server 8000
```
