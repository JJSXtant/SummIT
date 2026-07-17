const els = {
  preset: document.getElementById("presetSelect"),
  extract: document.getElementById("extractBtn"),
  run: document.getElementById("runBtn"),
  status: document.getElementById("status"),
  sizeLine: document.getElementById("sizeLine"),
  wrap: document.getElementById("resultWrap"),
  label: document.getElementById("resultLabel"),
  result: document.getElementById("result"),
  copy: document.getElementById("copyBtn"),
  download: document.getElementById("downloadBtn"),
  clear: document.getElementById("clearBtn"),
  histPrev: document.getElementById("histPrev"),
  histNext: document.getElementById("histNext"),
  histPos: document.getElementById("histPos"),
  settings: document.getElementById("openSettings"),
};

const DEFAULTS = {
  provider: "gemini",
  theme: "auto",
  geminiKey: "",
  geminiModel: "gemini-2.5-flash",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  includeUrl: true,
  includeTitle: true,
  includeDate: true,
  geminiMaxChars: 200000,
  ollamaMaxChars: 12000,
  presets: [
    { name: "General summary", prompt: "Summarize the following page content clearly and concisely. Use short paragraphs and bullet points where helpful." },
    { name: "Key facts only", prompt: "Extract only the key facts, figures, names, dates, and claims from the following page content as a bullet list. No commentary." },
  ],
  lastPreset: 0,
};

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function clampMaxChars(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 80000;
  return Math.max(1000, Math.min(n, 4000000));
}

let settings = { ...DEFAULTS };
let lastPageMeta = null;
let cachedPage = null; // extracted once when the popup opens

init();

async function init() {
  const stored = await chrome.storage.local.get({ ...DEFAULTS, maxChars: null });
  settings = { ...DEFAULTS, ...stored };
  // migrate old single limit if user had set one
  if (stored.maxChars != null) settings.geminiMaxChars = stored.maxChars;
  applyTheme(settings.theme);
  renderPresets();

  els.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.extract.addEventListener("click", onExtractOnly);
  els.run.addEventListener("click", onSummarize);
  els.copy.addEventListener("click", onCopy);
  els.download.addEventListener("click", onDownload);
  els.clear.addEventListener("click", onClear);
  els.histPrev.addEventListener("click", () => showHistory(viewIndex + 1));
  els.histNext.addEventListener("click", () => showHistory(viewIndex - 1));
  els.preset.addEventListener("change", () => {
    chrome.storage.local.set({ lastPreset: Number(els.preset.value) });
    updateSizeLine();
  });

  // Measure the page immediately so the user sees total tokens before acting
  precheckSize();

  // Restore result history (session memory only — cleared when browser exits)
  try {
    const stored = await chrome.storage.session.get("history");
    if (Array.isArray(stored.history) && stored.history.length) {
      history = stored.history;
      showHistory(0);
    }
  } catch { /* storage.session unavailable — ignore */ }
}

async function onClear() {
  history = [];
  viewIndex = 0;
  rawResult = "";
  els.wrap.hidden = true;
  els.result.innerHTML = "";
  els.label.textContent = "";
  try { await chrome.storage.session.remove("history"); } catch {}
}

function renderPresets() {
  els.preset.innerHTML = "";
  settings.presets.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = p.name;
    els.preset.appendChild(opt);
  });
  const idx = Math.min(settings.lastPreset || 0, settings.presets.length - 1);
  els.preset.value = String(Math.max(idx, 0));
}

function setStatus(msg, isError = false) {
  els.status.hidden = !msg;
  els.status.textContent = msg || "";
  els.status.classList.toggle("error", isError);
}

let rawResult = ""; // untouched model output — Copy/Download always use this

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markdownToHtml(md) {
  // 1. Pull out fenced code blocks first so no other transform touches them
  const blocks = [];
  let text = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });

  text = escapeHtml(text)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^[\*\-] (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .replace(/<\/ul>\s*<ul>/g, "")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^([^<\u0000].*)$/gm, "<p>$1</p>")
    .replace(/<p><\/p>/g, "");

  // 2. Restore code blocks untouched
  return text.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

function tryParseJson(text) {
  // Accept bare JSON or a single ```json fenced block
  const fenced = text.match(/^\s*```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
  const candidate = (fenced ? fenced[1] : text).trim();
  if (!/^[\[{]/.test(candidate)) return null;
  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    return null;
  }
}

const MAX_HISTORY = 5;
let history = []; // newest first: [{ raw, label, meta, ts }]
let viewIndex = 0;

// Render a result into the box (no persistence side effects)
function displayItem(item) {
  rawResult = item.raw;
  lastPageMeta = item.meta || null;
  els.wrap.hidden = false;

  const json = tryParseJson(item.raw);
  let label = item.label;
  if (json !== null) {
    rawResult = json; // copy/download get clean pretty-printed JSON, no fences
    if (!label.includes("· JSON")) label += " · JSON";
    els.result.innerHTML = `<pre><code>${escapeHtml(json)}</code></pre>`;
  } else {
    els.result.innerHTML = markdownToHtml(item.raw);
  }
  els.label.textContent = label;
  renderNav();
}

function renderNav() {
  const n = history.length;
  const showNav = n > 1;
  els.histPrev.hidden = !showNav;
  els.histNext.hidden = !showNav;
  els.histPos.hidden = !showNav;
  if (!showNav) return;
  els.histPos.textContent = `${viewIndex + 1}/${n}`;
  els.histPrev.disabled = viewIndex >= n - 1; // ‹ = older
  els.histNext.disabled = viewIndex <= 0;     // › = newer
}

function showHistory(index) {
  if (!history.length) return;
  viewIndex = Math.max(0, Math.min(index, history.length - 1));
  displayItem(history[viewIndex]);
}

// New result: push to front of history, trim to 5, persist, show
function showResult(text, label) {
  const item = { raw: text, label, meta: lastPageMeta, ts: Date.now() };
  history.unshift(item);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  viewIndex = 0;
  displayItem(item);
  chrome.storage.session.set({ history }).catch(() => {});
}

function setBusy(busy) {
  els.run.disabled = busy;
  els.extract.disabled = busy;
}

// ---- extraction ----

async function extractPage() {
  if (cachedPage) return cachedPage;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    throw new Error("This page can't be read (browser-internal page).");
  }
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        text: document.body ? document.body.innerText : "",
        title: document.title || "",
        url: location.href,
      }),
    });
  } catch (e) {
    throw new Error("Couldn't read this page. Some pages (PDFs, store pages) block extraction.");
  }
  const page = results?.[0]?.result;
  if (!page || !page.text.trim()) throw new Error("No readable text found on this page.");
  lastPageMeta = { title: page.title, url: page.url };
  let text = page.text.trim();
  const fullLength = text.length;
  let truncated = false;
  const limit = clampMaxChars(settings.provider === "ollama" ? settings.ollamaMaxChars : settings.geminiMaxChars);
  if (text.length > limit) {
    text = text.slice(0, limit);
    truncated = true;
  }
  cachedPage = { ...page, text, truncated, fullLength };
  return cachedPage;
}

function buildUserMessage(page) {
  const lines = [];
  if (settings.includeTitle && page.title) lines.push(`Page title: ${page.title}`);
  if (settings.includeUrl) lines.push(`URL: ${page.url}`);
  if (settings.includeDate) lines.push(`Captured: ${new Date().toISOString()}`);
  const header = lines.length ? lines.join("\n") + "\n\n" : "";
  return header + "Page content:\n\n" + page.text;
}

// ---- size stats ----

function fmtNum(n) {
  return n.toLocaleString("en-GB");
}

function fmtTokens(chars) {
  const t = Math.round(chars / 4);
  return t >= 1000 ? "\u2248" + (t / 1000).toFixed(t >= 10000 ? 0 : 1) + "k tok" : "\u2248" + t + " tok";
}

function currentLimit() {
  return clampMaxChars(settings.provider === "ollama" ? settings.ollamaMaxChars : settings.geminiMaxChars);
}

function sizeStats(page) {
  const limit = currentLimit();
  const base = fmtNum(page.fullLength) + " ch " + fmtTokens(page.fullLength);
  if (page.fullLength <= limit) return base + " \u00b7 fits limit";
  const pct = Math.round((limit / page.fullLength) * 100);
  return base + " \u00b7 over limit (" + fmtNum(limit) + ") \u2014 only first " + pct + "% sent";
}

async function precheckSize() {
  try {
    await extractPage();
    updateSizeLine();
  } catch {
    els.sizeLine.hidden = true; // unreadable page; buttons will explain on click
  }
}

// Single total: system prompt + metadata header + (truncated) page text
function updateSizeLine() {
  if (!cachedPage) return;
  const preset = settings.presets[Number(els.preset.value)] || settings.presets[0];
  const totalChars = preset.prompt.length + buildUserMessage(cachedPage).length;
  const cut = cachedPage.fullLength > currentLimit();
  els.sizeLine.hidden = false;
  els.sizeLine.innerHTML = cut
    ? `${fmtTokens(totalChars)} total &middot; <span class="warn">page cut to first ${Math.round((currentLimit() / cachedPage.fullLength) * 100)}%</span> &middot; raise limit in Settings for whole page`
    : `${fmtTokens(totalChars)} total &middot; whole page fits`;
}

// ---- actions ----

async function onExtractOnly() {
  setBusy(true);
  setStatus("Extracting…");
  try {
    const page = await extractPage();
    showResult(page.text, sizeStats(page));
    setStatus("");
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
  }
}

async function onSummarize() {
  setBusy(true);
  setStatus("Extracting…");
  try {
    const page = await extractPage();
    const preset = settings.presets[Number(els.preset.value)] || settings.presets[0];
    const userMessage = buildUserMessage(page);

    setStatus(settings.provider === "ollama" ? "Asking Ollama…" : "Asking Gemini…");
    const output =
      settings.provider === "ollama"
        ? await callOllama(preset.prompt, userMessage)
        : await callGemini(preset.prompt, userMessage);

    showResult(output, `${preset.name} · ${fmtTokens(page.text.length)} sent${page.truncated ? " (truncated)" : ""}`);
    setStatus("");
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
  }
}

// ---- providers ----

async function callGemini(systemPrompt, userMessage) {
  if (!settings.geminiKey) {
    throw new Error("No Gemini API key set. Add one in Settings.");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    settings.geminiModel
  )}:generateContent?key=${encodeURIComponent(settings.geminiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 400 && body.includes("API key")) {
      throw new Error("Gemini rejected the API key. Check it in Settings.");
    }
    if (res.status === 429) throw new Error("Gemini rate limit hit. Wait a moment and retry.");
    throw new Error(`Gemini error (${res.status}).`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("");
  if (!text) throw new Error("Gemini returned an empty response.");
  return text.trim();
}

async function callOllama(systemPrompt, userMessage) {
  const base = settings.ollamaUrl.replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.ollamaModel,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
  } catch {
    throw new Error("Can't reach Ollama. Is it running at " + base + "?");
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Ollama model "${settings.ollamaModel}" not found. Pull it or change it in Settings.`);
    throw new Error(`Ollama error (${res.status}).`);
  }
  const data = await res.json();
  const text = data?.message?.content;
  if (!text) throw new Error("Ollama returned an empty response.");
  return text.trim();
}

// ---- output tools ----

async function onCopy() {
  await navigator.clipboard.writeText(rawResult || els.result.innerText);
  els.copy.textContent = "Copied";
  setTimeout(() => (els.copy.textContent = "Copy"), 1200);
}

function onDownload() {
  const meta = lastPageMeta || {};
  const safeTitle = (meta.title || "summary").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "summary";
  const isJson = els.label.textContent.includes("· JSON");

  let content, ext, mime;
  if (isJson) {
    // keep the file valid JSON — no markdown header
    content = rawResult;
    ext = "json";
    mime = "application/json";
  } else {
    const header = [
      meta.title ? `# ${meta.title}` : "# Summary",
      meta.url ? `Source: ${meta.url}` : "",
      `Captured: ${new Date().toISOString()}`,
      "",
      "---",
      "",
    ].filter(Boolean).join("\n");
    content = header + rawResult;
    ext = "md";
    mime = "text/markdown";
  }

  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeTitle}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
