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

const $ = (id) => document.getElementById(id);

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}
let presets = [];

init();

async function init() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };

  $("theme").value = s.theme;
  applyTheme(s.theme);
  $("provider").value = s.provider;
  $("geminiKey").value = s.geminiKey;
  $("geminiModel").value = s.geminiModel;
  $("ollamaUrl").value = s.ollamaUrl;
  $("ollamaModel").value = s.ollamaModel;
  $("includeTitle").checked = s.includeTitle;
  $("includeUrl").checked = s.includeUrl;
  $("includeDate").checked = s.includeDate;
  $("geminiMaxChars").value = s.geminiMaxChars;
  $("ollamaMaxChars").value = s.ollamaMaxChars;
  presets = s.presets.map((p) => ({ ...p }));

  toggleProviderFields();
  renderPresets();

  $("provider").addEventListener("change", toggleProviderFields);
  $("theme").addEventListener("change", () => applyTheme($("theme").value));
  $("addPreset").addEventListener("click", () => {
    presets.push({ name: "New prompt", prompt: "" });
    renderPresets();
  });
  $("save").addEventListener("click", save);
  $("openShortcuts").addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });
}

function toggleProviderFields() {
  const isOllama = $("provider").value === "ollama";
  $("geminiFields").hidden = isOllama;
  $("ollamaFields").hidden = !isOllama;
}

function renderPresets() {
  const list = $("presetList");
  list.innerHTML = "";
  presets.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "preset";

    const head = document.createElement("div");
    head.className = "preset-head";

    const name = document.createElement("input");
    name.type = "text";
    name.value = p.name;
    name.placeholder = "Prompt name";
    name.addEventListener("input", () => (presets[i].name = name.value));

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      presets.splice(i, 1);
      renderPresets();
    });

    head.append(name, remove);

    const body = document.createElement("textarea");
    body.value = p.prompt;
    body.placeholder = "System prompt sent to the model";
    body.addEventListener("input", () => (presets[i].prompt = body.value));

    card.append(head, body);
    list.appendChild(card);
  });
}

async function save() {
  const cleaned = presets
    .map((p) => ({ name: p.name.trim(), prompt: p.prompt.trim() }))
    .filter((p) => p.name && p.prompt);
  if (!cleaned.length) cleaned.push(...DEFAULTS.presets);

  await chrome.storage.local.set({
    theme: $("theme").value,
    provider: $("provider").value,
    geminiKey: $("geminiKey").value.trim(),
    geminiModel: $("geminiModel").value.trim() || DEFAULTS.geminiModel,
    ollamaUrl: $("ollamaUrl").value.trim() || DEFAULTS.ollamaUrl,
    ollamaModel: $("ollamaModel").value.trim() || DEFAULTS.ollamaModel,
    includeTitle: $("includeTitle").checked,
    includeUrl: $("includeUrl").checked,
    includeDate: $("includeDate").checked,
    geminiMaxChars: Math.max(1000, Math.min(Number($("geminiMaxChars").value) || 200000, 4000000)),
    ollamaMaxChars: Math.max(1000, Math.min(Number($("ollamaMaxChars").value) || 12000, 4000000)),
    maxChars: null,
    presets: cleaned,
    lastPreset: 0,
  });

  $("saveStatus").textContent = "Saved.";
  setTimeout(() => ($("saveStatus").textContent = ""), 1500);
}
