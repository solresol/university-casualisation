const DATA_URL = "data/qilt_casual_profitability_sourced.csv";

const X_METRICS = [
  {
    key: "casual_share_actual_fte_2023_pct",
    label: "Casual share (all casual staff, % of total FTE)",
    unit: "percent",
  },
  {
    key: "casual_teaching_only_share_pct_of_total_staff",
    label: "Casual share (teaching-only, % of total FTE)",
    unit: "percent",
  },
];

const PROFIT_Y_METRICS = [
  { key: "net_margin_2023_pct", label: "Net margin 2023 (%)", unit: "percent" },
  { key: "net_operating_result_2023_k_aud", label: "Net operating result 2023 ($'000)", unit: "k_aud" },
  { key: "total_revenue_2023_k_aud", label: "Total revenue 2023 ($'000)", unit: "k_aud" },
];

const QILT_Y = {
  key: "qilt_undergrad_overall_experience_pct",
  label: "QILT overall experience (undergraduates, %)",
  unit: "percent",
};

const BASELINES = {
  // Department of Education national staff series (Table A + B): casual staff were 14.4% of total staff FTE in 2023.
  higherEdCasualShareFte2023Pct: 14.4,
};

const FIT_KINDS = ["theil_sen", "ransac", "huber", "ols"];

const UNCERTAINTY = {
  theilSenBootstrapIterations: 600,
  cvNSplits: 5,
  cvNRepeats: 20,
  cvRandomState: 42,
};

const THEIL_SEN_BAND_CACHE = new Map();
const CV_R2_CACHE = new Map();

const X_AXIS_MAX_PCT = 50;

const NUMERIC_KEYS = new Set([
  "actual_casual_fte_2023",
  "total_actual_fte_2023",
  "casual_share_actual_fte_2023_pct",
  "casual_teaching_only_fte_2023",
  "casual_teaching_only_share_pct_of_total_staff",
  "qilt_undergrad_overall_experience_pct",
  "total_revenue_2023_k_aud",
  "net_operating_result_2023_k_aud",
  "net_margin_2023_pct",
]);

const SOURCE_MAP = {
  actual_casual_fte_2023: {
    url: "actual_casual_fte_2023_source_url",
    sheet: "actual_casual_fte_2023_source_sheet",
    cell: "actual_casual_fte_2023_source_cell",
  },
  total_actual_fte_2023: {
    url: "total_actual_fte_2023_source_url",
    sheet: "total_actual_fte_2023_source_sheet",
    cell: "total_actual_fte_2023_source_cell",
  },
  casual_share_actual_fte_2023_pct: {
    url: "casual_share_actual_fte_2023_pct_source_url",
    method: "casual_share_actual_fte_2023_pct_source_method",
    inputs: "casual_share_actual_fte_2023_pct_source_inputs",
  },
  casual_teaching_only_fte_2023: {
    url: "casual_teaching_only_fte_2023_source_url",
    sheet: "casual_teaching_only_fte_2023_source_sheet",
    cell: "casual_teaching_only_fte_2023_source_cell",
  },
  casual_teaching_only_share_pct_of_total_staff: {
    url: "casual_teaching_only_share_pct_of_total_staff_source_url",
    method: "casual_teaching_only_share_pct_of_total_staff_source_method",
    inputs: "casual_teaching_only_share_pct_of_total_staff_source_inputs",
  },
  qilt_undergrad_overall_experience_pct: {
    url: "qilt_undergrad_overall_experience_source_url",
    system: "qilt_undergrad_overall_experience_source_system",
    metric: "qilt_undergrad_overall_experience_source_metric",
    note: "qilt_undergrad_overall_experience_source_note",
    verification: "qilt_undergrad_overall_experience_source_verification",
  },
  total_revenue_2023_k_aud: {
    url: "total_revenue_2023_source_url",
    sheet: "total_revenue_2023_source_sheet",
    cell: "total_revenue_2023_source_cell",
    note: "total_revenue_2023_source_note",
  },
  net_operating_result_2023_k_aud: {
    url: "net_operating_result_2023_source_url",
    sheet: "net_operating_result_2023_source_sheet",
    cell: "net_operating_result_2023_source_cell",
    note: "net_operating_result_2023_source_note",
  },
  net_margin_2023_pct: {
    url: "net_margin_2023_source_url",
    sheet: "net_margin_2023_source_sheet",
    cells: "net_margin_2023_source_cells",
    method: "net_margin_2023_source_method",
    note: "net_margin_2023_source_note",
  },
};

function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fmt(unit, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "k_aud") return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(value);
}

function median(values) {
  const v = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  if (v.length % 2 === 1) return v[mid];
  return (v[mid - 1] + v[mid]) / 2;
}

function quantile(values, q) {
  const v = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  if (q <= 0) return v[0];
  if (q >= 1) return v[v.length - 1];
  const pos = (v.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = v[base + 1] ?? v[base];
  return v[base] + rest * (next - v[base]);
}

function mean(values) {
  if (!values || values.length === 0) return null;
  let s = 0;
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    s += v;
    n += 1;
  }
  if (n === 0) return null;
  return s / n;
}

function stddev(values) {
  const m = mean(values);
  if (m === null) return null;
  let s2 = 0;
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const d = v - m;
    s2 += d * d;
    n += 1;
  }
  if (n < 2) return 0;
  return Math.sqrt(s2 / (n - 1));
}

function linspace(a, b, n) {
  if (n <= 1) return [a];
  const out = new Array(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + step * i;
  return out;
}

function pearsonStats(x, y) {
  const n = x.length;
  if (n < 2) return null;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let varX = 0;
  let varY = 0;
  let covXY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    varX += dx * dx;
    varY += dy * dy;
    covXY += dx * dy;
  }
  const r = covXY / Math.sqrt(varX * varY);
  return { meanX, meanY, varX, varY, covXY, r, n };
}

function olsFit(x, y) {
  const stats = pearsonStats(x, y);
  if (!stats) return null;
  const { meanX, meanY, varX, varY, covXY, r, n } = stats;
  if (!(varX > 0) || !(varY > 0) || !Number.isFinite(r)) return null;

  const slope = covXY / varX;
  const intercept = meanY - slope * meanX;

  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * x[i];
    sse += (y[i] - yhat) ** 2;
    sst += (y[i] - meanY) ** 2;
  }
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  return { intercept, slope, r, r2, n };
}

function theilSenFit(x, y) {
  const stats = pearsonStats(x, y);
  if (!stats) return null;
  const { meanY, r, n } = stats;
  if (!Number.isFinite(r)) return null;

  const slopes = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[j] - x[i];
      if (dx === 0) continue;
      slopes.push((y[j] - y[i]) / dx);
    }
  }
  const slope = median(slopes);
  if (slope === null) return null;

  const intercepts = [];
  for (let i = 0; i < n; i++) intercepts.push(y[i] - slope * x[i]);
  const intercept = median(intercepts);
  if (intercept === null) return null;

  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * x[i];
    sse += (y[i] - yhat) ** 2;
    sst += (y[i] - meanY) ** 2;
  }
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  return { intercept, slope, r, r2, n };
}

function weightedLeastSquaresFit(x, y, w) {
  let sumW = 0;
  let sumWX = 0;
  let sumWY = 0;
  for (let i = 0; i < x.length; i++) {
    const wi = w[i];
    sumW += wi;
    sumWX += wi * x[i];
    sumWY += wi * y[i];
  }
  if (!(sumW > 0)) return null;
  const meanX = sumWX / sumW;
  const meanY = sumWY / sumW;

  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    const wi = w[i];
    const dx = x[i] - meanX;
    num += wi * dx * (y[i] - meanY);
    den += wi * dx * dx;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return { intercept, slope };
}

function huberFit(x, y, { epsilon = 1.35, maxIter = 50, tol = 1e-6 } = {}) {
  const stats = pearsonStats(x, y);
  if (!stats) return null;
  const { meanY, r, n } = stats;
  if (!Number.isFinite(r)) return null;

  const init = olsFit(x, y) ?? theilSenFit(x, y);
  if (!init) return null;
  let intercept = init.intercept;
  let slope = init.slope;

  const residuals0 = x.map((xi, i) => y[i] - (intercept + slope * xi));
  const abs0 = residuals0.map((ri) => Math.abs(ri));
  let scale = median(abs0);
  if (scale === null) return null;
  // Convert MAD to robust sigma estimate (assumes normal-ish tails).
  scale = 1.4826 * scale;
  if (!(scale > 0)) scale = 1;

  const delta = epsilon * scale;
  const w = new Array(n).fill(1);

  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      const ri = y[i] - (intercept + slope * x[i]);
      const a = Math.abs(ri);
      w[i] = a <= delta ? 1 : delta / a;
    }

    const fit = weightedLeastSquaresFit(x, y, w);
    if (!fit) break;

    const dIntercept = fit.intercept - intercept;
    const dSlope = fit.slope - slope;
    intercept = fit.intercept;
    slope = fit.slope;

    if (Math.abs(dIntercept) + Math.abs(dSlope) < tol) break;
  }

  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * x[i];
    sse += (y[i] - yhat) ** 2;
    sst += (y[i] - meanY) ** 2;
  }
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  return { intercept, slope, r, r2, n };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function ransacFit(
  x,
  y,
  { iterations = 400, randomState = 42, minInliers = 8, thresholdScale = 2.5 } = {}
) {
  const stats = pearsonStats(x, y);
  if (!stats) return null;
  const { meanY, r, n } = stats;
  if (!Number.isFinite(r)) return null;

  // Estimate a sensible residual scale using a robust initial fit.
  const init = theilSenFit(x, y) ?? olsFit(x, y);
  if (!init) return null;
  const residuals0 = x.map((xi, i) => y[i] - (init.intercept + init.slope * xi));
  const abs0 = residuals0.map((ri) => Math.abs(ri));
  let scale = median(abs0);
  if (scale === null) return null;
  scale = 1.4826 * scale;
  if (!(scale > 0)) scale = 1;

  let threshold = thresholdScale * scale;
  if (!(threshold > 0)) threshold = 1;

  const rng = mulberry32(randomState);

  let best = null;
  for (let iter = 0; iter < iterations; iter++) {
    const i = Math.floor(rng() * n);
    let j = Math.floor(rng() * n);
    if (j === i) j = (j + 1) % n;

    const dx = x[j] - x[i];
    if (dx === 0) continue;
    const slope = (y[j] - y[i]) / dx;
    const intercept = y[i] - slope * x[i];

    const inliers = [];
    const absResiduals = [];
    for (let k = 0; k < n; k++) {
      const res = y[k] - (intercept + slope * x[k]);
      const a = Math.abs(res);
      if (a <= threshold) {
        inliers.push(k);
        absResiduals.push(a);
      }
    }
    if (inliers.length < Math.min(minInliers, n)) continue;

    const q = median(absResiduals) ?? Number.POSITIVE_INFINITY;
    if (!best || inliers.length > best.inliers.length || (inliers.length === best.inliers.length && q < best.q)) {
      best = { inliers, q };
    }
  }

  if (!best || best.inliers.length < 2) return null;
  const xIn = best.inliers.map((k) => x[k]);
  const yIn = best.inliers.map((k) => y[k]);

  const refined = olsFit(xIn, yIn);
  const intercept = refined ? refined.intercept : init.intercept;
  const slope = refined ? refined.slope : init.slope;

  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * x[i];
    sse += (y[i] - yhat) ** 2;
    sst += (y[i] - meanY) ** 2;
  }
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  return { intercept, slope, r, r2, n, inliers: best.inliers.length, threshold };
}

function bootstrapTheilSenBand(
  x,
  y,
  xGrid,
  { iterations = UNCERTAINTY.theilSenBootstrapIterations, randomState = UNCERTAINTY.cvRandomState } = {}
) {
  const n = x.length;
  if (n < 3) return null;
  const rng = mulberry32(randomState);

  const slopes = [];
  const intercepts = [];
  const preds = xGrid.map(() => []);

  for (let b = 0; b < iterations; b++) {
    const xb = new Array(n);
    const yb = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      xb[i] = x[j];
      yb[i] = y[j];
    }
    const fit = theilSenFit(xb, yb);
    if (!fit) continue;

    slopes.push(fit.slope);
    intercepts.push(fit.intercept);
    for (let i = 0; i < xGrid.length; i++) {
      preds[i].push(fit.intercept + fit.slope * xGrid[i]);
    }
  }

  if (slopes.length < Math.min(80, Math.floor(iterations / 3))) return null;

  const slopeLo = quantile(slopes, 0.025);
  const slopeHi = quantile(slopes, 0.975);
  const yLo = preds.map((p) => quantile(p, 0.025));
  const yHi = preds.map((p) => quantile(p, 0.975));
  if (
    slopeLo === null ||
    slopeHi === null ||
    yLo.some((v) => v === null) ||
    yHi.some((v) => v === null)
  ) {
    return null;
  }

  return {
    slopeLo,
    slopeHi,
    xGrid,
    yLo: yLo.map((v) => v),
    yHi: yHi.map((v) => v),
    nBoot: slopes.length,
  };
}

function cvR2(
  kind,
  x,
  y,
  {
    nSplits = UNCERTAINTY.cvNSplits,
    nRepeats = UNCERTAINTY.cvNRepeats,
    randomState = UNCERTAINTY.cvRandomState,
  } = {}
) {
  const n = x.length;
  if (n < Math.max(6, nSplits + 1)) return null;

  const scores = [];
  const baseIdx = Array.from({ length: n }, (_, i) => i);

  for (let rep = 0; rep < nRepeats; rep++) {
    const rng = mulberry32((randomState + rep * 10007) >>> 0);

    const idx = baseIdx.slice();
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = idx[i];
      idx[i] = idx[j];
      idx[j] = tmp;
    }

    const foldSizes = new Array(nSplits).fill(Math.floor(n / nSplits));
    for (let i = 0; i < n % nSplits; i++) foldSizes[i] += 1;

    let start = 0;
    for (let f = 0; f < nSplits; f++) {
      const size = foldSizes[f];
      const testIdx = idx.slice(start, start + size);
      start += size;

      const testSet = new Set(testIdx);
      const xTrain = [];
      const yTrain = [];
      const xTest = [];
      const yTest = [];

      for (let i = 0; i < n; i++) {
        if (testSet.has(i)) {
          xTest.push(x[i]);
          yTest.push(y[i]);
        } else {
          xTrain.push(x[i]);
          yTrain.push(y[i]);
        }
      }

      const fit = fitLine(kind, xTrain, yTrain);
      if (!fit) continue;

      const yMean = mean(yTest);
      if (yMean === null) continue;
      let sse = 0;
      let sst = 0;
      for (let i = 0; i < yTest.length; i++) {
        const yhat = fit.intercept + fit.slope * xTest[i];
        sse += (yTest[i] - yhat) ** 2;
        const d = yTest[i] - yMean;
        sst += d * d;
      }
      const r2 = sst === 0 ? 0 : 1 - sse / sst;
      if (Number.isFinite(r2)) scores.push(r2);
    }
  }

  if (scores.length === 0) return null;
  const m = mean(scores);
  if (m === null) return null;
  const sd = stddev(scores) ?? 0;
  return { mean: m, std: sd, nFolds: scores.length, nSplits, nRepeats, randomState };
}

function fitLine(kind, x, y) {
  if (kind === "none") return null;
  if (kind === "ols") return olsFit(x, y);
  if (kind === "theil_sen") return theilSenFit(x, y);
  if (kind === "huber") return huberFit(x, y);
  if (kind === "ransac") return ransacFit(x, y);
  return null;
}

function plotTheme() {
  const isLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  return isLight
    ? {
        text: "#0f172a",
        grid: "rgba(15, 23, 42, 0.10)",
        paper: "rgba(0,0,0,0)",
        plot: "rgba(0,0,0,0)",
        highlight: "#f97316",
      }
    : {
        text: "#e8ecff",
        grid: "rgba(255,255,255,0.10)",
        paper: "rgba(0,0,0,0)",
        plot: "rgba(0,0,0,0)",
        highlight: "#f97316",
      };
}

function stateColors(states) {
  const palette = [
    "#60a5fa",
    "#34d399",
    "#fbbf24",
    "#a78bfa",
    "#fb7185",
    "#22d3ee",
    "#f472b6",
    "#94a3b8",
  ];
  const map = new Map();
  let idx = 0;
  for (const s of states) {
    if (!map.has(s)) {
      map.set(s, palette[idx % palette.length]);
      idx += 1;
    }
  }
  return map;
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] ?? "Unknown";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function selectOptions(selectEl, options, selectedKey) {
  selectEl.innerHTML = "";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.key;
    o.textContent = opt.label;
    if (opt.key === selectedKey) o.selected = true;
    selectEl.appendChild(o);
  }
}

function buildDatalist(datalistEl, rows) {
  datalistEl.innerHTML = "";
  const inst = rows.map((r) => r.institution).filter(Boolean).sort((a, b) => a.localeCompare(b));
  for (const name of inst) {
    const o = document.createElement("option");
    o.value = name;
    datalistEl.appendChild(o);
  }
}

function renderDetails(row) {
  const details = byId("details");
  details.innerHTML = "";

  const title = document.createElement("div");
  title.className = "details__title";
  const h = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = row.institution ?? "—";
  h.appendChild(strong);
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = row.state ? `State: ${row.state}` : "State: —";
  title.appendChild(h);
  title.appendChild(pill);
  details.appendChild(title);

  const metrics = [
    { key: "casual_share_actual_fte_2023_pct", label: "Casual staff share (all casuals, % of total FTE)", unit: "percent" },
    { key: "casual_teaching_only_share_pct_of_total_staff", label: "Casual staff share (teaching-only, % of total FTE)", unit: "percent" },
    { key: "qilt_undergrad_overall_experience_pct", label: "QILT undergrad overall experience (%)", unit: "percent" },
    { key: "net_margin_2023_pct", label: "Net margin 2023 (%)", unit: "percent" },
    { key: "total_revenue_2023_k_aud", label: "Total revenue 2023 ($'000)", unit: "k_aud" },
    { key: "net_operating_result_2023_k_aud", label: "Net operating result 2023 ($'000)", unit: "k_aud" },
    { key: "actual_casual_fte_2023", label: "Actual casual staff FTE (2023)", unit: "raw" },
    { key: "total_actual_fte_2023", label: "Total actual staff FTE (2023)", unit: "raw" },
    { key: "casual_teaching_only_fte_2023", label: "Teaching-only casual staff FTE (2023)", unit: "raw" },
  ];

  for (const m of metrics) {
    const value = row[m.key];
    const block = document.createElement("div");
    block.className = "kv";

    const k = document.createElement("div");
    k.className = "kv__k";
    k.textContent = m.label;

    const v = document.createElement("div");
    v.className = "kv__v";

    const val = document.createElement("div");
    val.textContent = fmt(m.unit, value);
    v.appendChild(val);

    const src = SOURCE_MAP[m.key];
    if (src) {
      const url = row[src.url];
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.className = "source";
        a.textContent = url;
        v.appendChild(a);
      }

      for (const extraKey of ["sheet", "cell", "cells", "method", "inputs", "note", "system", "metric", "verification"]) {
        if (!src[extraKey]) continue;
        const val = row[src[extraKey]];
        if (!val) continue;
        const div = document.createElement("div");
        div.className = "source";
        div.textContent = `${extraKey}: ${val}`;
        v.appendChild(div);
      }
    }

    block.appendChild(k);
    block.appendChild(v);
    details.appendChild(block);
  }
}

function plotlyNumberFormat(unit) {
  if (unit === "percent") return ".2f";
  if (unit === "k_aud") return ",.0f";
  return "";
}

function tracesFor(rows, xMetric, yMetric, selectedInstitution) {
  const theme = plotTheme();
  const grouped = groupBy(rows, "state");
  const colorMap = stateColors([...grouped.keys()]);
  const traces = [];

  const xFmt = plotlyNumberFormat(xMetric.unit);
  const yFmt = plotlyNumberFormat(yMetric.unit);
  const xSuffix = xMetric.unit === "percent" ? "%" : "";
  const ySuffix = yMetric.unit === "percent" ? "%" : "";

  for (const [state, rs] of grouped.entries()) {
    const xs = [];
    const ys = [];
    const text = [];
    const ids = [];
    for (const r of rs) {
      const x = r[xMetric.key];
      const y = r[yMetric.key];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !(x > 0) || x > X_AXIS_MAX_PCT) continue;
      xs.push(x);
      ys.push(y);
      text.push(r.institution);
      ids.push(r.__id);
    }
    traces.push({
      name: state,
      type: "scatter",
      mode: "markers",
      x: xs,
      y: ys,
      text,
      customdata: ids,
      marker: {
        size: 9,
        color: colorMap.get(state) ?? "#60a5fa",
        opacity: 0.85,
        line: { color: "rgba(255,255,255,0.35)", width: 1 },
      },
      hovertemplate:
        "<b>%{text}</b><br>" +
        `${xMetric.label}: %{x:${xFmt}}${xSuffix}` +
        "<br>" +
        `${yMetric.label}: %{y:${yFmt}}${ySuffix}` +
        "<extra></extra>",
    });
  }

  if (selectedInstitution) {
    const sr = rows.find((r) => r.institution === selectedInstitution);
    if (
      sr &&
      Number.isFinite(sr[xMetric.key]) &&
      Number.isFinite(sr[yMetric.key]) &&
      sr[xMetric.key] > 0 &&
      sr[xMetric.key] <= X_AXIS_MAX_PCT
    ) {
      traces.push({
        name: "Selected",
        type: "scatter",
        mode: "markers",
        x: [sr[xMetric.key]],
        y: [sr[yMetric.key]],
        text: [sr.institution],
        customdata: [sr.__id],
        marker: {
          size: 16,
          color: theme.highlight,
          opacity: 0.95,
          symbol: "circle",
          line: { color: theme.text, width: 2 },
        },
        hovertemplate: "<b>%{text}</b><extra></extra>",
        showlegend: false,
      });
    }
  }

  return traces;
}

function ensurePlotlyHandlers(div, rows, onSelectInstitution) {
  if (div.__handlersAttached) return;
  div.__handlersAttached = true;

  div.on("plotly_click", (ev) => {
    const p = ev?.points?.[0];
    if (!p) return;
    const id = p.customdata;
    const row = rows.find((r) => r.__id === id);
    if (!row) return;
    onSelectInstitution(row.institution);
  });

  div.on("plotly_doubleclick", () => {
    onSelectInstitution(null);
  });
}

function fitLabel(kind) {
  if (kind === "huber") return "Huber";
  if (kind === "theil_sen") return "Theil–Sen";
  if (kind === "ransac") return "RANSAC";
  if (kind === "ols") return "OLS";
  return "Fit";
}

function fitLineStyle(theme, kind) {
  if (kind === "ols") return { color: theme.text, width: 2 };
  return { color: theme.text, width: 2, dash: "dash" };
}

function renderChart(divId, rows, xMetric, yMetric, selectedInstitution, onSelectInstitution, fitKind) {
  const theme = plotTheme();
  const div = byId(divId);

  const eligible = rows.filter(
    (r) => Number.isFinite(r[xMetric.key]) && Number.isFinite(r[yMetric.key]) && r[xMetric.key] > 0
  );
  const trimmedRows = eligible.filter((r) => r[xMetric.key] > X_AXIS_MAX_PCT);
  const clean = eligible.filter((r) => r[xMetric.key] <= X_AXIS_MAX_PCT);
  const x = clean.map((r) => r[xMetric.key]);
  const y = clean.map((r) => r[yMetric.key]);
  let fit = fitLine(fitKind, x, y);
  if (fit) {
    fit = { ...fit, trimmed_n: trimmedRows.length };
    if (trimmedRows.length > 0 && trimmedRows.length <= 3) {
      fit.trimmed_names = trimmedRows.map((r) => r.institution);
    }
  }

  const pointTraces = tracesFor(rows, xMetric, yMetric, selectedInstitution);
  const xMaxPad = X_AXIS_MAX_PCT;

  const bandTraces = [];
  if (fit && fitKind === "theil_sen" && x.length >= 6) {
    const bandKey = `${xMetric.key}|${yMetric.key}|${xMaxPad.toFixed(6)}`;
    let band = THEIL_SEN_BAND_CACHE.get(bandKey);
    if (band === undefined) {
      const xGrid = linspace(0, xMaxPad, 41);
      band = bootstrapTheilSenBand(x, y, xGrid);
      THEIL_SEN_BAND_CACHE.set(bandKey, band ?? null);
    }

    if (band) {
      const fill = theme.text === "#0f172a" ? "rgba(14,165,233,0.14)" : "rgba(96,165,250,0.18)";
      bandTraces.push({
        type: "scatter",
        mode: "lines",
        x: band.xGrid,
        y: band.yLo,
        line: { color: "rgba(0,0,0,0)", width: 0 },
        hoverinfo: "skip",
        showlegend: false,
      });
      bandTraces.push({
        type: "scatter",
        mode: "lines",
        x: band.xGrid,
        y: band.yHi,
        line: { color: "rgba(0,0,0,0)", width: 0 },
        fill: "tonexty",
        fillcolor: fill,
        hoverinfo: "skip",
        showlegend: false,
      });
      fit = { ...fit, slope_ci95: [band.slopeLo, band.slopeHi], boot_n: band.nBoot };
    }

    const cvKey = `${xMetric.key}|${yMetric.key}|${fitKind}`;
    let cv = CV_R2_CACHE.get(cvKey);
    if (cv === undefined) {
      cv = cvR2(fitKind, x, y);
      CV_R2_CACHE.set(cvKey, cv ?? null);
    }
    if (cv) {
      fit = { ...fit, cv_r2: cv };
    }
  }

  const traces = [...bandTraces, ...pointTraces];
  if (fit) {
    const xMin = 0;
    const xGrid = [xMin, xMaxPad];
    const yGrid = [fit.intercept + fit.slope * xMin, fit.intercept + fit.slope * xMaxPad];
    traces.push({
      name: `${fitLabel(fitKind)} fit`,
      type: "scatter",
      mode: "lines",
      x: xGrid,
      y: yGrid,
      line: fitLineStyle(theme, fitKind),
      hoverinfo: "skip",
    });
  }

  const layout = {
    paper_bgcolor: theme.paper,
    plot_bgcolor: theme.plot,
    margin: { l: 54, r: 12, t: 12, b: 46 },
    showlegend: false,
    font: { color: theme.text },
    xaxis: {
      title: { text: xMetric.label, font: { color: theme.text } },
      gridcolor: theme.grid,
      zerolinecolor: theme.grid,
      tickfont: { color: theme.text },
      range: [0, xMaxPad],
    },
    yaxis: {
      title: { text: yMetric.label, font: { color: theme.text } },
      gridcolor: theme.grid,
      zerolinecolor: theme.grid,
      tickfont: { color: theme.text },
    },
  };

  // Baseline: higher-ed sector average casual share (FTE, 2023). Only comparable when x-axis is the all-casual FTE share.
  if (xMetric.key === "casual_share_actual_fte_2023_pct") {
    const x0 = BASELINES.higherEdCasualShareFte2023Pct;
    layout.shapes = [
      {
        type: "line",
        x0,
        x1: x0,
        y0: 0,
        y1: 1,
        yref: "paper",
        line: { color: "rgba(251,113,133,0.70)", width: 2, dash: "dot" },
      },
    ];
    layout.annotations = [
      {
        x: x0,
        y: 1.03,
        xref: "x",
        yref: "paper",
        text: "HE sector avg: 14.4% (FTE, 2023)",
        showarrow: false,
        font: { size: 11, color: theme.text },
      },
    ];
  }

  const config = { displaylogo: false, responsive: true };

  Plotly.react(div, traces, layout, config)
    .then(() => ensurePlotlyHandlers(div, rows, onSelectInstitution))
    .catch((err) => console.error("Plotly render failed:", err));
  return fit;
}

async function fetchCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length > 0) {
    // still return whatever was parsed, but surface the first parse error
    console.warn("CSV parse errors:", parsed.errors.slice(0, 3));
  }
  return parsed.data;
}

function normalizeRows(rawRows) {
  return rawRows
    .filter((r) => r && r.institution)
    .map((r, idx) => {
      const out = { ...r, __id: idx };
      for (const k of Object.keys(out)) {
        if (NUMERIC_KEYS.has(k)) out[k] = toNumber(out[k]);
      }
      return out;
    });
}

async function main() {
  const rawRows = await fetchCsv(DATA_URL);
  const rows = normalizeRows(rawRows);

  const qiltX = byId("qilt-x");
  const profitX = byId("profit-x");
  const profitY = byId("profit-y");
  const qiltStats = new Map(FIT_KINDS.map((k) => [k, byId(`qilt-stats-${k}`)]));
  const profitStats = new Map(FIT_KINDS.map((k) => [k, byId(`profit-stats-${k}`)]));

  selectOptions(qiltX, X_METRICS, X_METRICS[1].key);
  selectOptions(profitX, X_METRICS, X_METRICS[1].key);
  selectOptions(profitY, PROFIT_Y_METRICS, PROFIT_Y_METRICS[0].key);

  buildDatalist(byId("inst-list"), rows);

  let selectedInstitution = null;

  function formatFitStats(kind, fit, xMetric) {
    if (!fit) return "";
    const per = xMetric.unit === "percent" ? " per 1%" : "";
    const parts = [];

    if (kind === "theil_sen" && Array.isArray(fit.slope_ci95) && fit.slope_ci95.length === 2) {
      const lo = fit.slope_ci95[0];
      const hi = fit.slope_ci95[1];
      parts.push(`slope ${fit.slope.toFixed(3)} [${lo.toFixed(3)}, ${hi.toFixed(3)}]${per}`);
    } else {
      parts.push(`slope ${fit.slope.toFixed(3)}${per}`);
    }

    if (kind === "theil_sen" && fit.cv_r2 && Number.isFinite(fit.cv_r2.mean)) {
      const sd = Number.isFinite(fit.cv_r2.std) ? ` ± ${fit.cv_r2.std.toFixed(3)}` : "";
      parts.push(`CV R² = ${fit.cv_r2.mean.toFixed(3)}${sd}`);
    } else {
      parts.push(`r = ${fit.r.toFixed(3)}`);
    }

    parts.push(`R² = ${fit.r2.toFixed(3)}`);
    if (kind === "ransac" && typeof fit.inliers === "number") parts.push(`inliers = ${fit.inliers}`);
    const trimmed = typeof fit.trimmed_n === "number" ? fit.trimmed_n : 0;
    parts.push(trimmed > 0 ? `n = ${fit.n} (excluded ${trimmed} >${X_AXIS_MAX_PCT}%)` : `n = ${fit.n}`);
    return parts.join(" • ");
  }

  function setSelectedInstitution(name) {
    selectedInstitution = name;
    const search = byId("inst-search");
    search.value = name ?? "";
    if (name) {
      const row = rows.find((r) => r.institution === name);
      if (row) renderDetails(row);
    } else {
      const d = byId("details");
      d.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "details__empty";
      empty.textContent = "No institution selected yet.";
      d.appendChild(empty);
    }
    renderAll();
  }

  function renderAll() {
    const qx = X_METRICS.find((m) => m.key === qiltX.value) ?? X_METRICS[1] ?? X_METRICS[0];
    const px = X_METRICS.find((m) => m.key === profitX.value) ?? X_METRICS[1] ?? X_METRICS[0];
    const py = PROFIT_Y_METRICS.find((m) => m.key === profitY.value) ?? PROFIT_Y_METRICS[0];

    for (const kind of FIT_KINDS) {
      const fitQ = renderChart(
        `chart-qilt-${kind}`,
        rows,
        qx,
        QILT_Y,
        selectedInstitution,
        setSelectedInstitution,
        kind
      );
      qiltStats.get(kind).textContent = formatFitStats(kind, fitQ, qx);
    }

    for (const kind of FIT_KINDS) {
      const fitP = renderChart(
        `chart-profit-${kind}`,
        rows,
        px,
        py,
        selectedInstitution,
        setSelectedInstitution,
        kind
      );
      profitStats.get(kind).textContent = formatFitStats(kind, fitP, px);
    }
  }

  qiltX.addEventListener("change", renderAll);
  profitX.addEventListener("change", renderAll);
  profitY.addEventListener("change", renderAll);

  const search = byId("inst-search");
  search.addEventListener("change", () => {
    const name = search.value?.trim();
    if (!name) return setSelectedInstitution(null);
    const found = rows.find((r) => r.institution === name);
    if (found) setSelectedInstitution(found.institution);
  });

  renderAll();
}

main().catch((err) => {
  console.error(err);
  const details = document.getElementById("details");
  if (details) {
    details.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "details__empty";
    empty.textContent = `Error loading data: ${String(err)}`;
    details.appendChild(empty);
  }
});
