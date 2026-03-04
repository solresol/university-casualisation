#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import json
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.linear_model import HuberRegressor, LinearRegression, RANSACRegressor, TheilSenRegressor
from sklearn.model_selection import RepeatedKFold, cross_val_score


REPO_ROOT = Path(__file__).resolve().parent.parent
DATASET_PATH = REPO_ROOT / "data" / "qilt_casual_profitability_sourced.csv"

OUTPUTS_DIR = REPO_ROOT / "outputs"
OUTPUTS_PLOTS_DIR = OUTPUTS_DIR / "plots"
OUTPUTS_METRICS_DIR = OUTPUTS_DIR / "metrics"

SUBSTACK_DIR = REPO_ROOT / "substack"
SUBSTACK_ASSETS_DIR = SUBSTACK_DIR / "assets"

SITE_DIR = REPO_ROOT / "site"
DIST_DIR = REPO_ROOT / "dist"


PredictorKey = Literal[
    "casual_share_actual_fte_2023_pct",
    "casual_teaching_only_share_pct_of_total_staff",
]
TargetKey = Literal[
    "qilt_undergrad_overall_experience_pct",
    "net_margin_2023_pct",
]


@dataclass(frozen=True)
class LinearFit:
    intercept: float
    slope: float
    r2_in_sample: float | None = None


@dataclass(frozen=True)
class PearsonResult:
    r: float
    p_value: float
    n: int


@dataclass(frozen=True)
class RobustCvResult:
    mean_r2: float
    std_r2: float
    n: int
    n_splits: int
    n_repeats: int
    random_state: int


def load_dataset(path: Path = DATASET_PATH) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {path}")
    return pd.read_csv(path)


def _clean_xy(df: pd.DataFrame, x_col: str, y_col: str) -> tuple[np.ndarray, np.ndarray]:
    d = df[[x_col, y_col]].dropna()
    x = d[x_col].astype(float).to_numpy()
    y = d[y_col].astype(float).to_numpy()
    return x, y


def fit_ols(df: pd.DataFrame, predictor: str, target: str) -> LinearFit:
    x, y = _clean_xy(df, predictor, target)
    X = x.reshape(-1, 1)
    model = LinearRegression().fit(X, y)
    return LinearFit(
        intercept=float(model.intercept_),
        slope=float(model.coef_[0]),
        r2_in_sample=float(model.score(X, y)),
    )


def pearson(df: pd.DataFrame, x_col: str, y_col: str) -> PearsonResult:
    x, y = _clean_xy(df, x_col, y_col)
    r, p = stats.pearsonr(x, y)
    return PearsonResult(r=float(r), p_value=float(p), n=int(len(x)))


def robust_cv_r2(
    df: pd.DataFrame,
    predictor: PredictorKey,
    target: TargetKey,
    *,
    n_splits: int = 5,
    n_repeats: int = 20,
    random_state: int = 42,
) -> dict[str, RobustCvResult]:
    x, y = _clean_xy(df, predictor, target)
    X = x.reshape(-1, 1)

    cv = RepeatedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=random_state)
    models: dict[str, Any] = {
        "theil_sen": TheilSenRegressor(random_state=random_state),
        "ransac": RANSACRegressor(random_state=random_state),
        "huber": HuberRegressor(),
        "ols": LinearRegression(),
    }

    results: dict[str, RobustCvResult] = {}
    for name, model in models.items():
        scores = cross_val_score(model, X, y, scoring="r2", cv=cv)
        results[name] = RobustCvResult(
            mean_r2=float(scores.mean()),
            std_r2=float(scores.std(ddof=1)),
            n=int(len(x)),
            n_splits=n_splits,
            n_repeats=n_repeats,
            random_state=random_state,
        )

    return results


def _fit_model_line(
    x: np.ndarray, y: np.ndarray, *, kind: str, random_state: int = 42
) -> LinearFit:
    X = x.reshape(-1, 1)
    if kind == "theil_sen":
        model = TheilSenRegressor(random_state=random_state)
    elif kind == "ransac":
        model = RANSACRegressor(random_state=random_state)
    elif kind == "huber":
        model = HuberRegressor()
    elif kind == "ols":
        model = LinearRegression()
    else:
        raise ValueError(f"Unknown model kind: {kind}")
    model.fit(X, y)
    if hasattr(model, "estimator_") and kind == "ransac":
        base = model.estimator_
        intercept = float(base.intercept_)
        slope = float(base.coef_[0])
    else:
        intercept = float(model.intercept_)
        slope = float(model.coef_[0])
    return LinearFit(intercept=intercept, slope=slope, r2_in_sample=None)


def _make_scatter(
    df: pd.DataFrame,
    *,
    x_col: str,
    y_col: str,
    title: str,
    x_label: str,
    y_label: str,
    out_path: Path,
    highlight_institutions: tuple[str, ...] = (),
    overlay_models: tuple[str, ...] = ("ols",),
    annotate: str | None = None,
    x_trim_max: float | None = None,
    drop_x_le_zero: bool = False,
) -> None:
    d = df[["institution", "state", x_col, y_col]].dropna().copy()
    d[x_col] = d[x_col].astype(float)
    d[y_col] = d[y_col].astype(float)

    if drop_x_le_zero:
        d = d[d[x_col] > 0]
    if x_trim_max is not None:
        d = d[d[x_col] <= float(x_trim_max)]

    x = d[x_col].to_numpy(dtype=float)
    y = d[y_col].to_numpy(dtype=float)

    fig, ax = plt.subplots(figsize=(12, 7), dpi=150)
    ax.set_title(title, fontsize=14, pad=14)
    ax.grid(True, which="major", alpha=0.25)
    ax.set_xlabel(x_label)
    ax.set_ylabel(y_label)

    ax.scatter(
        d[x_col].astype(float),
        d[y_col].astype(float),
        s=36,
        alpha=0.85,
        linewidths=0.5,
        edgecolors="white",
        color="#2563eb",
    )

    if highlight_institutions:
        dh = d[d["institution"].isin(highlight_institutions)]
        if len(dh) > 0:
            ax.scatter(
                dh[x_col].astype(float),
                dh[y_col].astype(float),
                s=72,
                alpha=0.95,
                linewidths=1.0,
                edgecolors="black",
                color="#f97316",
                zorder=3,
                label="Highlighted",
            )
            for _, row in dh.iterrows():
                ax.annotate(
                    str(row["institution"]),
                    (float(row[x_col]), float(row[y_col])),
                    textcoords="offset points",
                    xytext=(6, 6),
                    fontsize=9,
                    color="#111827",
                )

    if len(x) == 0:
        raise ValueError(f"No data left after filtering for plot: {x_col} vs {y_col}")

    if x_trim_max is not None:
        x_min, x_max = 0.0, float(x_trim_max)
        ax.set_xlim(x_min, x_max)
    else:
        x_min, x_max = float(np.nanmin(x)), float(np.nanmax(x))
    x_grid = np.linspace(x_min, x_max, 200)

    model_styles = {
        "ols": dict(color="#111827", linestyle="-", linewidth=2.0, label="OLS"),
        "theil_sen": dict(color="#0ea5e9", linestyle="--", linewidth=2.0, label="Theil–Sen"),
        "huber": dict(color="#22c55e", linestyle="--", linewidth=2.0, label="Huber"),
        "ransac": dict(color="#a855f7", linestyle="--", linewidth=2.0, label="RANSAC"),
    }

    for kind in overlay_models:
        fit = _fit_model_line(x, y, kind=kind)
        y_grid = fit.intercept + fit.slope * x_grid
        ax.plot(x_grid, y_grid, **model_styles[kind])

    if len(overlay_models) > 1 or highlight_institutions:
        ax.legend(frameon=False, loc="best")

    if annotate:
        ax.text(
            0.01,
            0.01,
            annotate,
            transform=ax.transAxes,
            ha="left",
            va="bottom",
            fontsize=9,
            color="#374151",
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(out_path, bbox_inches="tight")
    plt.close(fig)


def write_outputs(df: pd.DataFrame) -> dict[str, Any]:
    outputs: dict[str, Any] = {}

    # QILT vs casual share (all and teaching-only)
    qilt_all = {
        "predictor": "casual_share_actual_fte_2023_pct",
        "target": "qilt_undergrad_overall_experience_pct",
        "pearson": asdict(pearson(df, "casual_share_actual_fte_2023_pct", "qilt_undergrad_overall_experience_pct")),
        "ols": asdict(fit_ols(df, "casual_share_actual_fte_2023_pct", "qilt_undergrad_overall_experience_pct")),
    }
    qilt_teaching = {
        "predictor": "casual_teaching_only_share_pct_of_total_staff",
        "target": "qilt_undergrad_overall_experience_pct",
        "pearson": asdict(
            pearson(df, "casual_teaching_only_share_pct_of_total_staff", "qilt_undergrad_overall_experience_pct")
        ),
        "ols": asdict(
            fit_ols(df, "casual_teaching_only_share_pct_of_total_staff", "qilt_undergrad_overall_experience_pct")
        ),
    }

    # Net margin vs casual share (robust CV)
    net_all_cv = robust_cv_r2(
        df,
        "casual_share_actual_fte_2023_pct",
        "net_margin_2023_pct",
    )
    net_teaching_cv = robust_cv_r2(
        df,
        "casual_teaching_only_share_pct_of_total_staff",
        "net_margin_2023_pct",
    )

    outputs["qilt_vs_casual_share"] = qilt_all
    outputs["qilt_vs_teaching_only_casual_share"] = qilt_teaching
    outputs["net_margin_vs_casual_share_cv_r2"] = {k: asdict(v) for k, v in net_all_cv.items()}
    outputs["net_margin_vs_teaching_only_casual_share_cv_r2"] = {k: asdict(v) for k, v in net_teaching_cv.items()}

    OUTPUTS_METRICS_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUTS_METRICS_DIR / "summary.json").write_text(json.dumps(outputs, indent=2) + "\n")

    # Flat metrics table for easy inspection
    metrics_rows: list[dict[str, Any]] = []
    for predictor, cv_results in [
        ("casual_share_actual_fte_2023_pct", net_all_cv),
        ("casual_teaching_only_share_pct_of_total_staff", net_teaching_cv),
    ]:
        for model, r in cv_results.items():
            metrics_rows.append(
                {
                    "predictor": predictor,
                    "target": "net_margin_2023_pct",
                    "model": model,
                    **asdict(r),
                }
            )

    with (OUTPUTS_METRICS_DIR / "robust_regression_cv_r2.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(metrics_rows[0].keys()))
        writer.writeheader()
        writer.writerows(metrics_rows)

    return outputs


def write_plots(df: pd.DataFrame, summary: dict[str, Any]) -> None:
    x_trim_max = 25.0

    qilt_all_df = df[(df["casual_share_actual_fte_2023_pct"] > 0) & (df["casual_share_actual_fte_2023_pct"] <= x_trim_max)]
    qilt_all_pearson = pearson(qilt_all_df, "casual_share_actual_fte_2023_pct", "qilt_undergrad_overall_experience_pct")
    qilt_all_ols = fit_ols(qilt_all_df, "casual_share_actual_fte_2023_pct", "qilt_undergrad_overall_experience_pct")

    _make_scatter(
        df,
        x_col="casual_share_actual_fte_2023_pct",
        y_col="qilt_undergrad_overall_experience_pct",
        title="Casual staff share vs QILT overall experience (undergraduates)",
        x_label="Casual staff share (% of total actual staff FTE, 2023)",
        y_label="QILT/SES: ‘Had a positive overall experience’ (%)",
        out_path=OUTPUTS_PLOTS_DIR / "qilt_vs_casual_share.png",
        highlight_institutions=("Macquarie University",),
        overlay_models=("ols",),
        annotate=(
            f"Pearson r = {qilt_all_pearson.r:.3f}, R² = {qilt_all_ols.r2_in_sample:.3f}, "
            f"p = {qilt_all_pearson.p_value:.3f} (n={qilt_all_pearson.n}; x≤{x_trim_max:.0f}%)"
        ),
        x_trim_max=x_trim_max,
        drop_x_le_zero=True,
    )

    qilt_teach_df = df[
        (df["casual_teaching_only_share_pct_of_total_staff"] > 0)
        & (df["casual_teaching_only_share_pct_of_total_staff"] <= x_trim_max)
    ]
    qilt_teach_pearson = pearson(
        qilt_teach_df,
        "casual_teaching_only_share_pct_of_total_staff",
        "qilt_undergrad_overall_experience_pct",
    )
    qilt_teach_ols = fit_ols(
        qilt_teach_df,
        "casual_teaching_only_share_pct_of_total_staff",
        "qilt_undergrad_overall_experience_pct",
    )
    _make_scatter(
        df,
        x_col="casual_teaching_only_share_pct_of_total_staff",
        y_col="qilt_undergrad_overall_experience_pct",
        title="Teaching-only casual share vs QILT overall experience (undergraduates)",
        x_label="Teaching-only casual share (% of total actual staff FTE, 2023)",
        y_label="QILT/SES: ‘Had a positive overall experience’ (%)",
        out_path=OUTPUTS_PLOTS_DIR / "qilt_vs_teaching_only_casual_share.png",
        overlay_models=("ols",),
        annotate=(
            f"Pearson r = {qilt_teach_pearson.r:.3f}, R² = {qilt_teach_ols.r2_in_sample:.3f}, "
            f"p = {qilt_teach_pearson.p_value:.3f} (n={qilt_teach_pearson.n}; x≤{x_trim_max:.0f}%)"
        ),
        x_trim_max=x_trim_max,
        drop_x_le_zero=True,
    )

    net_all_df = df[(df["casual_share_actual_fte_2023_pct"] > 0) & (df["casual_share_actual_fte_2023_pct"] <= x_trim_max)]
    net_all_pearson = pearson(net_all_df, "casual_share_actual_fte_2023_pct", "net_margin_2023_pct")
    net_all_ols = fit_ols(net_all_df, "casual_share_actual_fte_2023_pct", "net_margin_2023_pct")
    _make_scatter(
        df,
        x_col="casual_share_actual_fte_2023_pct",
        y_col="net_margin_2023_pct",
        title="Casual staff share vs net margin (profitability proxy, 2023)",
        x_label="Casual staff share (% of total actual staff FTE, 2023)",
        y_label="Net margin (%)",
        out_path=OUTPUTS_PLOTS_DIR / "net_margin_vs_casual_share.png",
        overlay_models=("ols",),
        annotate=(
            f"Pearson r = {net_all_pearson.r:.3f}, R² = {net_all_ols.r2_in_sample:.3f}, "
            f"p = {net_all_pearson.p_value:.3f} (n={net_all_pearson.n}; x≤{x_trim_max:.0f}%)"
        ),
        x_trim_max=x_trim_max,
        drop_x_le_zero=True,
    )

    net_teach_df = df[
        (df["casual_teaching_only_share_pct_of_total_staff"] > 0)
        & (df["casual_teaching_only_share_pct_of_total_staff"] <= x_trim_max)
    ]
    net_teach_pearson = pearson(
        net_teach_df,
        "casual_teaching_only_share_pct_of_total_staff",
        "net_margin_2023_pct",
    )
    net_teach_ols = fit_ols(
        net_teach_df,
        "casual_teaching_only_share_pct_of_total_staff",
        "net_margin_2023_pct",
    )
    _make_scatter(
        df,
        x_col="casual_teaching_only_share_pct_of_total_staff",
        y_col="net_margin_2023_pct",
        title="Teaching-only casual share vs net margin (profitability proxy, 2023)",
        x_label="Teaching-only casual share (% of total actual staff FTE, 2023)",
        y_label="Net margin (%)",
        out_path=OUTPUTS_PLOTS_DIR / "net_margin_vs_teaching_only_casual_share.png",
        overlay_models=("ols",),
        annotate=(
            f"Pearson r = {net_teach_pearson.r:.3f}, R² = {net_teach_ols.r2_in_sample:.3f}, "
            f"p = {net_teach_pearson.p_value:.3f} (n={net_teach_pearson.n}; x≤{x_trim_max:.0f}%)"
        ),
        x_trim_max=x_trim_max,
        drop_x_le_zero=True,
    )


def write_substack_draft(df: pd.DataFrame, summary: dict[str, Any]) -> None:
    SUBSTACK_ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    # Generate the figures in the Substack asset folder (higher DPI + a slightly different naming)
    qilt_r = summary["qilt_vs_casual_share"]["pearson"]["r"]
    qilt_r2 = summary["qilt_vs_casual_share"]["ols"]["r2_in_sample"]
    qilt_p = summary["qilt_vs_casual_share"]["pearson"]["p_value"]

    _make_scatter(
        df,
        x_col="casual_share_actual_fte_2023_pct",
        y_col="qilt_undergrad_overall_experience_pct",
        title="Casual staff share vs QILT overall experience (undergraduates)",
        x_label="Casual staff share (% of total actual staff FTE, 2023)",
        y_label="QILT/SES: ‘Had a positive overall experience’ (%)",
        out_path=SUBSTACK_ASSETS_DIR / "qilt_vs_casual_share.png",
        highlight_institutions=("University of Divinity", "Macquarie University"),
        overlay_models=("ols",),
        annotate=f"Pearson r = {qilt_r:.3f}, R² = {qilt_r2:.3f}, p = {qilt_p:.3f} (n=42)",
    )

    net_cv = summary["net_margin_vs_casual_share_cv_r2"]
    ts_r2 = net_cv["theil_sen"]["mean_r2"]
    ransac_r2 = net_cv["ransac"]["mean_r2"]
    huber_r2 = net_cv["huber"]["mean_r2"]
    annotate = (
        "Mean CV R² (5-fold, 20 repeats): "
        + ", ".join(
            [
                f"{label} {net_cv[key]['mean_r2']:.3f}"
                for key, label in [("theil_sen", "Theil–Sen"), ("ransac", "RANSAC"), ("huber", "Huber")]
            ]
        )
        + "\n(negative means worse out-of-sample than predicting the mean)"
    )
    _make_scatter(
        df,
        x_col="casual_share_actual_fte_2023_pct",
        y_col="net_margin_2023_pct",
        title="Casual staff share vs net margin (profitability proxy, 2023)",
        x_label="Casual staff share (% of total actual staff FTE, 2023)",
        y_label="Net margin (%)",
        out_path=SUBSTACK_ASSETS_DIR / "net_margin_vs_casual_share.png",
        overlay_models=("theil_sen", "ransac", "huber"),
        annotate=annotate,
    )

    # Pull two “story” comparisons from the dataset
    inst = df.set_index("institution")
    div = inst.loc["University of Divinity"]
    mq = inst.loc["Macquarie University"]

    qilt_fit = summary["qilt_vs_casual_share"]["ols"]
    line = f"{qilt_fit['intercept']:.2f} + {qilt_fit['slope']:.3f} × casual_share(%)"

    md = f"""\
# Do universities with fewer casuals have happier students (or bigger profits)?

Casualisation in universities is a perennial live wire: it’s central to the working conditions of teaching staff, and it’s often assumed to be bad for students and/or good for budgets.

So I tried a simple, falsifiable question using **public, institution-level Australian data**:

1) Is a higher casual staff share associated with **QILT student experience**?  
2) Is a higher casual staff share associated with **profitability** (net margin)?

This is **not causal inference** — it’s a sanity check on whether a clear, aggregate pattern even shows up.

## The data (and the measurement choice)

I used:

- **Staffing (casual share):** Department of Education “Appendix 1 – Actual staff FTE” (2023).  
  Important caveat: this is **casual FTE share**, not casual headcount share (headcount isn’t published in this release).
- **Student experience:** ComparED institution pages, undergraduate “**Had a positive overall experience**” (%), pooled across the two most recent SES years (per ComparED).
- **Profitability:** Department of Education finance tables for 2023 (derived from audited financial statements per the Department). I use **net margin** = net operating result / total revenue.

The dataset includes row-level sourcing (URLs + sheet/cell references for spreadsheet values).

## Baselines (context)

For a rough benchmark (not perfectly comparable definitions):

- **Australian economy overall (ABS, Aug 2025):** ~20.0% without paid holiday/sick leave (ABS proxy for casual); 19.5% self-identified as casual.
- **Universities / higher ed providers (Dept staff series, 2023):** 14.4% casual staff share of total staff FTE (Table A + B), down from 15.3% (2022) and 17.8% (2019).
- **Within universities (2023):** teaching-only roles were 64.7% casual; Level A / below lecturer academic FTE were 53.5% casual.
- **Education & training industry (ABS, Aug 2025):** ~16.3% self-identified casual (≈200.1k casual employees).

The annoying goblin: these use different statistical definitions (employee counts vs FTE; proxy vs self-identified). Treat them as benchmarks, not apples-to-apples.

## A concrete contrast: Divinity vs Macquarie

On the “actual staff FTE” measure:

- **University of Divinity:** {div['actual_casual_fte_2023']:.2f} casual FTE / {div['total_actual_fte_2023']:.2f} total FTE → **{div['casual_share_actual_fte_2023_pct']:.2f}%** casual share.  
  QILT overall experience: **{div['qilt_undergrad_overall_experience_pct']:.1f}%**.  
  2023 net margin: **{div['net_margin_2023_pct']:.2f}%**.
- **Macquarie University:** {mq['actual_casual_fte_2023']:.2f} casual FTE / {mq['total_actual_fte_2023']:.2f} total FTE → **{mq['casual_share_actual_fte_2023_pct']:.2f}%** casual share.  
  QILT overall experience: **{mq['qilt_undergrad_overall_experience_pct']:.1f}%**.  
  2023 net margin: **{mq['net_margin_2023_pct']:.2f}%**.

## Result 1: casual share vs QILT overall experience

Across 42 universities where I could match the staffing and QILT measures, the simple regression line is:

> QILT overall experience ≈ **{line}**

In other words: basically flat.

The summary stats are:

- Pearson r = **{qilt_r:.3f}**
- R² = **{qilt_r2:.3f}**
- p = **{qilt_p:.3f}**

![Casual share vs QILT overall experience](assets/qilt_vs_casual_share.png)

## Result 2: casual share vs profitability (net margin)

Net margin is noisy across institutions (and for good reasons). To avoid being fooled by a few outliers, I also tried three robust regressors (Theil–Sen, RANSAC, Huber), evaluated with repeated 5-fold cross-validation (20 repeats).

The blunt summary: **out-of-sample R² is negative for all three** — these one-predictor models do worse than just predicting the mean net margin.

The mean cross-validated R² values are:

- Theil–Sen: **{ts_r2:.3f}**
- RANSAC: **{ransac_r2:.3f}**
- Huber: **{huber_r2:.3f}**

![Casual share vs net margin (robust lines)](assets/net_margin_vs_casual_share.png)

## What we can (and can’t) conclude

Defensible:

> In these institution-level data, we found **no clear evidence** that a higher or lower casual staff share is associated with either profitability (net margin) or undergraduate overall student experience.

Not defensible:

> Increasing or decreasing casuals has no impact.

That second sentence sneaks in causality. This is cross-sectional, observational, and heavily confounded.

## Caveats worth keeping front-of-mind

- This uses **casual FTE share**, not headcount.
- QILT on ComparED is pooled across SES years; the staff metric is 2023 actual FTE (close, not perfect).
- Institution averages can hide within-university variation (disciplines, campuses, modes).
- Any real relationship could be nonlinear, delayed, or heterogeneous.

## Where this is going next

- I’m building an interactive website with live charts and clickable sourcing: https://casualisation.symmachus.org/
- Data + code live here: https://github.com/solresol/university-casualisation (DOI to come via Zenodo).

If you have better public datasets for casual headcount, teaching quality, or more granular outcomes, I’d love pointers — institution-level aggregates are a very blunt instrument.
"""

    SUBSTACK_DIR.mkdir(parents=True, exist_ok=True)
    (SUBSTACK_DIR / "draft.md").write_text(md)


def build_dist_bundle() -> None:
    if not SITE_DIR.exists():
        raise FileNotFoundError(f"Site directory not found: {SITE_DIR}")

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    # Copy site files
    shutil.copy2(SITE_DIR / "index.html", DIST_DIR / "index.html")
    if (SITE_DIR / "assets").exists():
        shutil.copytree(SITE_DIR / "assets", DIST_DIR / "assets")

    # Copy data (only what the site needs)
    (DIST_DIR / "data").mkdir(parents=True, exist_ok=True)
    shutil.copy2(DATASET_PATH, DIST_DIR / "data" / DATASET_PATH.name)

    # Copy precomputed summary, if present
    summary_path = OUTPUTS_METRICS_DIR / "summary.json"
    if summary_path.exists():
        shutil.copy2(summary_path, DIST_DIR / "data" / "summary.json")

    # Copy static plot images (PNG), if present
    if OUTPUTS_PLOTS_DIR.exists():
        static_root = DIST_DIR / "static"
        static_root.mkdir(parents=True, exist_ok=True)

        # Stable path (may be cached by CDNs)
        static_plots_dir = static_root / "plots"
        static_plots_dir.mkdir(parents=True, exist_ok=True)

        # Cache-busting path for the current trimmed plots (x<=25% in build.py)
        static_plots_trimmed_dir = static_root / "plots-x25"
        static_plots_trimmed_dir.mkdir(parents=True, exist_ok=True)

        for png in sorted(OUTPUTS_PLOTS_DIR.glob("*.png")):
            shutil.copy2(png, static_plots_dir / png.name)
            shutil.copy2(png, static_plots_trimmed_dir / png.name)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build analysis outputs, Substack assets, and the website bundle.")
    parser.add_argument(
        "target",
        nargs="?",
        default="all",
        choices=["outputs", "plots", "substack", "dist", "all"],
        help="What to build.",
    )
    args = parser.parse_args()

    df = load_dataset()

    summary: dict[str, Any] | None = None

    if args.target in ("outputs", "all"):
        summary = write_outputs(df)

    if args.target in ("plots", "all"):
        if summary is None:
            summary = write_outputs(df)
        write_plots(df, summary)

    if args.target in ("substack", "all"):
        if summary is None:
            summary = write_outputs(df)
        write_substack_draft(df, summary)

    if args.target in ("dist", "all"):
        build_dist_bundle()


if __name__ == "__main__":
    main()
