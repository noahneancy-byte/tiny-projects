const catalog = window.PRICE_CATALOG;

const PRESETS = {
  support: { input: 1200, output: 280, requests: 100000, cache: 20, budget: 100 },
  rag: { input: 6000, output: 800, requests: 50000, cache: 35, budget: 500 },
  agent: { input: 18000, output: 3500, requests: 10000, cache: 50, budget: 1000 },
};

const DEFAULT_STATE = { ...PRESETS.rag, cny: 7.2, preset: "rag", provider: "all" };
const state = { ...DEFAULT_STATE };
let latestRows = [];

const elements = {
  input: document.querySelector("#input-tokens"),
  output: document.querySelector("#output-tokens"),
  requests: document.querySelector("#monthly-requests"),
  budget: document.querySelector("#monthly-budget"),
  cache: document.querySelector("#cache-rate"),
  cacheOutput: document.querySelector("#cache-output"),
  cny: document.querySelector("#cny-rate"),
  customEnabled: document.querySelector("#custom-enabled"),
  customFields: document.querySelector("#custom-fields"),
  customName: document.querySelector("#custom-name"),
  customInput: document.querySelector("#custom-input"),
  customCache: document.querySelector("#custom-cache"),
  customOutput: document.querySelector("#custom-output"),
  winnerName: document.querySelector("#winner-name"),
  winnerNote: document.querySelector("#winner-note"),
  winnerUsd: document.querySelector("#winner-usd"),
  winnerCny: document.querySelector("#winner-cny"),
  budgetBar: document.querySelector("#budget-bar"),
  budgetStatus: document.querySelector("#budget-status"),
  savingCopy: document.querySelector("#saving-copy"),
  contextWarning: document.querySelector("#context-warning"),
  modelList: document.querySelector("#model-list"),
  emptyState: document.querySelector("#empty-state"),
};

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readState() {
  state.input = asNumber(elements.input.value);
  state.output = asNumber(elements.output.value);
  state.requests = asNumber(elements.requests.value);
  state.budget = asNumber(elements.budget.value);
  state.cache = Math.min(100, asNumber(elements.cache.value));
  state.cny = asNumber(elements.cny.value);
}

function writeState() {
  elements.input.value = state.input;
  elements.output.value = state.output;
  elements.requests.value = state.requests;
  elements.budget.value = state.budget;
  elements.cache.value = state.cache;
  elements.cacheOutput.value = `${state.cache}%`;
  elements.cny.value = state.cny;
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === state.preset);
  });
  document.querySelectorAll("[data-provider]").forEach((button) => {
    button.classList.toggle("active", button.dataset.provider === state.provider);
  });
}

function getCustomModel() {
  if (!elements.customEnabled.checked) return null;
  return {
    id: "custom-model",
    provider: "Custom",
    name: elements.customName.value.trim() || "自定义模型",
    note: "使用你的自定义价格",
    input: asNumber(elements.customInput.value),
    cachedInput: asNumber(elements.customCache.value),
    output: asNumber(elements.customOutput.value),
  };
}

function getRates(model) {
  const usesHighContext = Boolean(model.highContext && state.input > model.highContext.threshold);
  const source = usesHighContext ? model.highContext : model;
  return {
    input: source.input,
    cachedInput: source.cachedInput,
    output: source.output,
    usesHighContext,
  };
}

function calculate(model) {
  const rates = getRates(model);
  const cachedTokens = state.input * (state.cache / 100);
  const regularTokens = state.input - cachedTokens;
  const inputCost = regularTokens * rates.input / 1000000;
  const cacheCost = cachedTokens * rates.cachedInput / 1000000;
  const outputCost = state.output * rates.output / 1000000;
  const perRequest = inputCost + cacheCost + outputCost;

  return {
    ...model,
    rates,
    inputCost,
    cacheCost,
    outputCost,
    perRequest,
    monthly: perRequest * state.requests,
  };
}

function formatMoney(value, compact = false) {
  if (!Number.isFinite(value)) return "$0";
  if (compact && value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (compact && value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
  if (value >= 100) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(5)}`;
}

function formatCny(value) {
  if (!Number.isFinite(value)) return "¥0";
  if (value >= 1000000) return `¥${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `¥${(value / 1000).toFixed(2)}K`;
  return `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function providerClass(provider) {
  return provider.toLowerCase().replace(/[^a-z]/g, "");
}

function createBreakdownItem(value, label) {
  const item = document.createElement("div");
  const amount = document.createElement("b");
  const copy = document.createElement("span");
  amount.textContent = value;
  copy.textContent = label;
  item.append(amount, copy);
  return item;
}

function renderModels(rows) {
  elements.modelList.replaceChildren();
  const max = Math.max(...rows.map((row) => row.monthly), 0);

  rows.forEach((row, index) => {
    const card = document.createElement("article");
    card.className = "model-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-expanded", "false");
    card.title = "点击查看成本拆分";

    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("div");
    title.className = "model-title";
    const name = document.createElement("strong");
    name.textContent = row.name;
    const provider = document.createElement("span");
    const dot = document.createElement("i");
    dot.className = `provider-dot ${providerClass(row.provider)}`;
    provider.append(dot, document.createTextNode(`${row.provider} · ${row.note}`));
    title.append(name, provider);

    const bar = document.createElement("div");
    bar.className = "mini-bar";
    const barFill = document.createElement("i");
    barFill.style.width = `${max ? Math.max(3, (row.monthly / max) * 100) : 0}%`;
    bar.append(barFill);

    const cost = document.createElement("div");
    cost.className = "cost";
    const monthly = document.createElement("strong");
    const perRequest = document.createElement("span");
    monthly.textContent = formatMoney(row.monthly, true);
    perRequest.textContent = `${formatMoney(row.perRequest)} / 次`;
    cost.append(monthly, perRequest);

    const breakdown = document.createElement("div");
    breakdown.className = "breakdown";
    breakdown.append(
      createBreakdownItem(formatMoney(row.inputCost), `普通输入 · $${row.rates.input}/M`),
      createBreakdownItem(formatMoney(row.cacheCost), `缓存输入 · $${row.rates.cachedInput}/M`),
      createBreakdownItem(formatMoney(row.outputCost), `输出 · $${row.rates.output}/M`),
      createBreakdownItem(formatCny(row.monthly * state.cny), "人民币月成本"),
    );

    const toggle = () => {
      const isOpen = card.classList.toggle("open");
      card.setAttribute("aria-expanded", String(isOpen));
    };
    card.addEventListener("click", toggle);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });

    card.append(rank, title, bar, cost, breakdown);
    elements.modelList.append(card);
  });
}

function renderSummary(rows) {
  if (!rows.length) {
    elements.winnerName.textContent = "没有可比较的模型";
    elements.winnerNote.textContent = "请选择其他厂商，或启用自定义模型";
    elements.winnerUsd.textContent = "$0";
    elements.winnerCny.textContent = "≈ ¥0 / 月";
    elements.budgetStatus.textContent = "暂无预算判断";
    elements.savingCopy.textContent = "—";
    elements.budgetBar.style.width = "0";
    elements.emptyState.classList.remove("hidden");
    return;
  }

  elements.emptyState.classList.add("hidden");
  const winner = rows[0];
  const mostExpensive = rows[rows.length - 1];
  const saving = Math.max(0, mostExpensive.monthly - winner.monthly);
  const ratio = state.budget > 0 ? winner.monthly / state.budget : 0;

  elements.winnerName.textContent = winner.name;
  elements.winnerNote.textContent = `${winner.provider} · ${formatMoney(winner.perRequest)} / 次`;
  elements.winnerUsd.textContent = `${formatMoney(winner.monthly, true)}`;
  elements.winnerCny.textContent = `≈ ${formatCny(winner.monthly * state.cny)} / 月`;
  elements.budgetBar.style.width = `${Math.min(100, ratio * 100)}%`;
  elements.budgetBar.classList.toggle("over", ratio > 1);

  if (state.budget <= 0) {
    elements.budgetStatus.textContent = "未设置预算";
  } else if (ratio <= 1) {
    elements.budgetStatus.textContent = `预算内 · 还剩 ${formatMoney(state.budget - winner.monthly, true)}`;
  } else {
    elements.budgetStatus.textContent = `超出预算 ${formatMoney(winner.monthly - state.budget, true)}`;
  }
  elements.savingCopy.textContent = rows.length > 1 ? `比当前最高方案省 ${formatMoney(saving, true)} / 月` : "当前仅比较 1 个模型";
}

function render() {
  readState();
  elements.cacheOutput.value = `${state.cache}%`;

  const custom = getCustomModel();
  const models = custom ? [...catalog.models, custom] : [...catalog.models];
  const rows = models
    .filter((model) => state.provider === "all" || model.provider === state.provider)
    .map(calculate)
    .sort((a, b) => a.monthly - b.monthly);

  latestRows = rows;
  renderSummary(rows);
  renderModels(rows);
  elements.contextWarning.classList.toggle("hidden", !rows.some((row) => row.rates.usesHighContext));
  savePreferences();
}

function selectPreset(name) {
  if (name !== "custom" && PRESETS[name]) Object.assign(state, PRESETS[name]);
  state.preset = name;
  writeState();
  render();
}

function markCustomPreset() {
  state.preset = "custom";
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === "custom");
  });
}

function savePreferences() {
  const saved = {
    input: state.input,
    output: state.output,
    requests: state.requests,
    budget: state.budget,
    cache: state.cache,
    cny: state.cny,
    preset: state.preset,
    provider: state.provider,
    customEnabled: elements.customEnabled.checked,
    customName: elements.customName.value,
    customInput: elements.customInput.value,
    customCache: elements.customCache.value,
    customOutput: elements.customOutput.value,
  };
  localStorage.setItem("token-budget-preferences", JSON.stringify(saved));
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem("token-budget-preferences") || "null");
    if (!saved) return;
    ["input", "output", "requests", "budget", "cache", "cny"].forEach((key) => {
      if (Number.isFinite(Number(saved[key])) && Number(saved[key]) >= 0) state[key] = Number(saved[key]);
    });
    if (["support", "rag", "agent", "custom"].includes(saved.preset)) state.preset = saved.preset;
    if (["all", "OpenAI", "Anthropic", "Google", "Custom"].includes(saved.provider)) state.provider = saved.provider;
    elements.customEnabled.checked = Boolean(saved.customEnabled);
    if (typeof saved.customName === "string") elements.customName.value = saved.customName;
    if (saved.customInput !== undefined) elements.customInput.value = saved.customInput;
    if (saved.customCache !== undefined) elements.customCache.value = saved.customCache;
    if (saved.customOutput !== undefined) elements.customOutput.value = saved.customOutput;
  } catch {
    localStorage.removeItem("token-budget-preferences");
  }
}

function exportCsv() {
  if (!latestRows.length) return;
  const headers = ["排名", "厂商", "模型", "输入价_USD每百万Token", "缓存价_USD每百万Token", "输出价_USD每百万Token", "单次成本_USD", "月度成本_USD", "月度成本_CNY"];
  const rows = latestRows.map((row, index) => [
    index + 1,
    row.provider,
    row.name,
    row.rates.input,
    row.rates.cachedInput,
    row.rates.output,
    row.perRequest.toFixed(8),
    row.monthly.toFixed(4),
    (row.monthly * state.cny).toFixed(2),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ai-cost-estimate-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

document.querySelector("#price-date").textContent = catalog.lastUpdated;
document.querySelector("#source-links").replaceChildren(...catalog.sources.flatMap((source, index) => {
  const link = document.createElement("a");
  link.href = source.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = source.provider;
  return index < catalog.sources.length - 1 ? [link, document.createTextNode(" · ")] : [link];
}));

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => selectPreset(button.dataset.preset));
});

document.querySelectorAll("[data-provider]").forEach((button) => {
  button.addEventListener("click", () => {
    state.provider = button.dataset.provider;
    document.querySelectorAll("[data-provider]").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
});

[elements.input, elements.output, elements.requests, elements.budget, elements.cache, elements.cny].forEach((input) => {
  input.addEventListener("input", () => {
    markCustomPreset();
    render();
  });
});

[elements.customName, elements.customInput, elements.customCache, elements.customOutput].forEach((input) => {
  input.addEventListener("input", render);
});

elements.customEnabled.addEventListener("change", () => {
  elements.customFields.classList.toggle("enabled", elements.customEnabled.checked);
  render();
});

document.querySelector("#reset-button").addEventListener("click", () => {
  Object.assign(state, DEFAULT_STATE);
  elements.customEnabled.checked = false;
  elements.customFields.classList.remove("enabled");
  localStorage.removeItem("token-budget-preferences");
  writeState();
  render();
});

document.querySelector("#export-button").addEventListener("click", exportCsv);

loadPreferences();
elements.customFields.classList.toggle("enabled", elements.customEnabled.checked);
writeState();
render();
