const elements = {
  source: document.querySelector("#source-input"),
  fileInput: document.querySelector("#file-input"),
  fileName: document.querySelector("#file-name"),
  dropZone: document.querySelector("#drop-zone"),
  lineCount: document.querySelector("#line-count"),
  sizeCount: document.querySelector("#size-count"),
  results: document.querySelector("#results-section"),
  summary: document.querySelector("#summary-card"),
  statusIcon: document.querySelector("#status-icon"),
  statusTitle: document.querySelector("#status-title"),
  statusCopy: document.querySelector("#status-copy"),
  issuesList: document.querySelector("#issues-list"),
  schemaList: document.querySelector("#schema-list"),
  schemaSummary: document.querySelector("#schema-summary"),
};

const SAMPLE = `{"id": 1, "question": "什么是 RAG？", "category": "知识", "score": 5}
{"id": 2, "question": "什么是 Agent？", "category": "知识", "score": "4"}
{"id": 2, "question": "", "category": "", "score": 4}
{"id": 4, "question": "这条记录缺少分类", "score": 3}
{"id": 4, "question": "这条记录缺少分类", "score": 3}`;

let selectedFormat = "auto";
let latestReport = null;
let activeFilter = "all";

function byteSize(text) {
  return new Blob([text]).size;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function updateInputMeta() {
  const value = elements.source.value;
  const lines = value ? value.split(/\r?\n/).length : 0;
  elements.lineCount.textContent = `${lines} 行`;
  elements.sizeCount.textContent = formatBytes(byteSize(value));
}

function detectFormat(text) {
  const trimmed = text.trim();
  if (!trimmed) return "unknown";
  try {
    JSON.parse(trimmed);
    return "json";
  } catch {
    const nonEmptyLines = text.split(/\r?\n/).filter((line) => line.trim());
    if (nonEmptyLines.length <= 1) return "json";
    const validStandaloneLines = nonEmptyLines.filter((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    }).length;
    return validStandaloneLines > 0 ? "jsonl" : "json";
  }
}

function getType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function parseDataset(text, requestedFormat) {
  const format = requestedFormat === "auto" ? detectFormat(text) : requestedFormat;
  const errors = [];
  const records = [];
  const locations = [];

  if (!text.trim()) {
    errors.push({ severity: "error", title: "没有可检查的数据", detail: "请粘贴内容或选择一个 .json / .jsonl 文件。", location: "输入区", code: "empty_input" });
    return { format, records, locations, errors };
  }

  if (format === "json") {
    try {
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      items.forEach((item, index) => {
        records.push(item);
        locations.push(Array.isArray(parsed) ? `记录 ${index + 1}` : "根对象");
      });
    } catch (error) {
      const positionMatch = error.message.match(/position\s+(\d+)/i);
      let location = "JSON";
      if (positionMatch) {
        const position = Number(positionMatch[1]);
        const before = text.slice(0, position);
        const line = before.split(/\r?\n/).length;
        const column = position - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
        location = `第 ${line} 行 · 第 ${column} 列`;
      }
      errors.push({ severity: "error", title: "JSON 格式错误", detail: error.message, location, code: "invalid_json" });
    }
  } else if (format === "jsonl") {
    text.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      try {
        records.push(JSON.parse(line));
        locations.push(`第 ${index + 1} 行`);
      } catch (error) {
        errors.push({ severity: "error", title: "这一行不是有效的 JSON", detail: error.message, location: `第 ${index + 1} 行`, code: "invalid_jsonl_line" });
      }
    });
  } else {
    errors.push({ severity: "error", title: "无法识别数据格式", detail: "请选择 JSON 或 JSONL 后重试。", location: "输入区", code: "unknown_format" });
  }

  return { format, records, locations, errors };
}

function inspectQuality(records, locations) {
  const issues = [];
  const schema = new Map();
  const objectRecords = records.filter((record) => record && typeof record === "object" && !Array.isArray(record));

  records.forEach((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      issues.push({ severity: "warning", title: "记录不是对象", detail: `当前类型为 ${getType(record)}，通常数据集中的每条记录应为对象。`, location: locations[index], code: "non_object_record" });
    }
  });

  objectRecords.forEach((record) => {
    Object.entries(record).forEach(([key, value]) => {
      if (!schema.has(key)) schema.set(key, { count: 0, types: new Set(), empty: 0 });
      const field = schema.get(key);
      field.count += 1;
      field.types.add(getType(value));
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) field.empty += 1;
    });
  });

  objectRecords.forEach((record, index) => {
    schema.forEach((field, key) => {
      if (!(key in record)) {
        const originalIndex = records.indexOf(record);
        issues.push({ severity: "warning", title: `缺少字段 “${key}”`, detail: `该字段出现在 ${field.count}/${objectRecords.length} 条对象记录中。`, location: locations[originalIndex] || `记录 ${index + 1}`, code: "missing_field" });
      }
    });
    Object.entries(record).forEach(([key, value]) => {
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
        const originalIndex = records.indexOf(record);
        issues.push({ severity: "warning", title: `字段 “${key}” 为空`, detail: "空值可能影响训练、检索或评测结果。", location: locations[originalIndex] || `记录 ${index + 1}`, code: "empty_value" });
      }
    });
  });

  schema.forEach((field, key) => {
    const meaningfulTypes = [...field.types].filter((type) => type !== "null");
    if (meaningfulTypes.length > 1) {
      issues.push({ severity: "warning", title: `字段 “${key}” 类型不一致`, detail: `检测到 ${meaningfulTypes.join("、")}，建议统一字段类型。`, location: "全部记录", code: "mixed_types" });
    }
  });

  const duplicateMap = new Map();
  records.forEach((record, index) => {
    const fingerprint = stableStringify(record);
    if (duplicateMap.has(fingerprint)) {
      issues.push({ severity: "warning", title: "发现完全重复的记录", detail: `内容与 ${locations[duplicateMap.get(fingerprint)]} 相同。`, location: locations[index], code: "duplicate_record" });
    } else {
      duplicateMap.set(fingerprint, index);
    }
  });

  ["id", "ID", "uuid", "key"].forEach((candidate) => {
    const seen = new Map();
    objectRecords.forEach((record) => {
      if (!(candidate in record) || record[candidate] === null || record[candidate] === "") return;
      const originalIndex = records.indexOf(record);
      const value = String(record[candidate]);
      if (seen.has(value)) {
        issues.push({ severity: "warning", title: `字段 “${candidate}” 存在重复值`, detail: `值 “${value}” 也出现在 ${locations[seen.get(value)]}。`, location: locations[originalIndex], code: "duplicate_identifier" });
      } else {
        seen.set(value, originalIndex);
      }
    });
  });

  return { issues, schema, objectCount: objectRecords.length };
}

function runCheck() {
  const parsed = parseDataset(elements.source.value, selectedFormat);
  const quality = inspectQuality(parsed.records, parsed.locations);
  const issues = [...parsed.errors, ...quality.issues];
  latestReport = {
    checkedAt: new Date().toISOString(),
    format: parsed.format.toUpperCase(),
    recordCount: parsed.records.length,
    fieldCount: quality.schema.size,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    issues,
    schema: [...quality.schema.entries()].map(([name, field]) => ({ name, coverage: `${field.count}/${quality.objectCount}`, types: [...field.types], emptyCount: field.empty })),
  };
  activeFilter = "all";
  document.querySelectorAll(".issue-filter-button").forEach((button) => button.classList.toggle("active", button.dataset.filter === "all"));
  renderReport();
  elements.results.classList.remove("hidden");
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderReport() {
  const report = latestReport;
  if (!report) return;
  const hasErrors = report.errorCount > 0;
  const hasWarnings = report.warningCount > 0;

  elements.summary.classList.toggle("has-errors", hasErrors);
  elements.summary.classList.toggle("has-warnings", hasWarnings);
  elements.statusIcon.textContent = hasErrors ? "!" : hasWarnings ? "·" : "✓";
  elements.statusTitle.textContent = hasErrors ? "发现格式错误" : hasWarnings ? "数据可用，但值得再看一眼" : "数据看起来不错";
  elements.statusCopy.textContent = hasErrors ? "先修复红色错误，再检查数据质量" : hasWarnings ? `发现 ${report.warningCount} 个可能影响质量的问题` : "没有发现常见格式或质量问题";

  document.querySelector("#record-stat").textContent = report.recordCount;
  document.querySelector("#field-stat").textContent = report.fieldCount;
  document.querySelector("#error-stat").textContent = report.errorCount;
  document.querySelector("#warning-stat").textContent = report.warningCount;
  document.querySelector("#all-count").textContent = report.issues.length;
  document.querySelector("#error-count").textContent = report.errorCount;
  document.querySelector("#warning-count").textContent = report.warningCount;

  const visibleIssues = report.issues.filter((issue) => activeFilter === "all" || issue.severity === activeFilter);
  elements.issuesList.replaceChildren();
  if (!visibleIssues.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = activeFilter === "all" ? "没有发现问题，漂亮！" : "这一类没有问题";
    elements.issuesList.append(empty);
  } else {
    visibleIssues.forEach((issue) => {
      const item = document.createElement("article");
      item.className = `issue-item ${issue.severity}`;
      const dot = document.createElement("span");
      dot.className = "issue-dot";
      const copy = document.createElement("div");
      copy.className = "issue-copy";
      const title = document.createElement("strong");
      title.textContent = issue.title;
      const detail = document.createElement("p");
      detail.textContent = issue.detail;
      copy.append(title, detail);
      const location = document.createElement("span");
      location.className = "issue-location";
      location.textContent = issue.location;
      item.append(dot, copy, location);
      elements.issuesList.append(item);
    });
  }

  elements.schemaList.replaceChildren();
  elements.schemaSummary.textContent = `${report.fieldCount} 个字段`;
  report.schema.forEach((field) => {
    const row = document.createElement("div");
    row.className = "schema-field";
    const name = document.createElement("code");
    name.textContent = field.name;
    const type = document.createElement("span");
    type.textContent = `${field.types.join("/")} · ${field.coverage}`;
    row.append(name, type);
    elements.schemaList.append(row);
  });
  document.querySelector("#schema-card").classList.toggle("hidden", report.fieldCount === 0);
}

function loadFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    elements.fileName.textContent = "文件超过 10 MB，请选择更小的文件";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    elements.source.value = String(reader.result || "");
    elements.fileName.textContent = file.name;
    updateInputMeta();
    elements.results.classList.add("hidden");
  };
  reader.readAsText(file);
}

function exportReport() {
  if (!latestReport) return;
  const blob = new Blob([JSON.stringify(latestReport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dataset-check-report-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

document.querySelectorAll(".format-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedFormat = button.dataset.format;
    document.querySelectorAll(".format-button").forEach((item) => item.classList.toggle("active", item === button));
  });
});

document.querySelectorAll(".issue-filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".issue-filter-button").forEach((item) => item.classList.toggle("active", item === button));
    renderReport();
  });
});

elements.source.addEventListener("input", () => {
  updateInputMeta();
  elements.results.classList.add("hidden");
});
elements.fileInput.addEventListener("change", () => loadFile(elements.fileInput.files[0]));
document.querySelector("#check-button").addEventListener("click", runCheck);
document.querySelector("#export-button").addEventListener("click", exportReport);
document.querySelector("#sample-button").addEventListener("click", () => {
  elements.source.value = SAMPLE;
  elements.fileName.textContent = "示例数据.jsonl";
  updateInputMeta();
  runCheck();
});
document.querySelector("#clear-button").addEventListener("click", () => {
  elements.source.value = "";
  elements.fileName.textContent = "粘贴内容，或拖入文件";
  elements.results.classList.add("hidden");
  updateInputMeta();
  elements.source.focus();
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
});
elements.dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));

updateInputMeta();
