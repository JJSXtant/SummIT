// Runs when the "summarize-page" keyboard shortcut fires (chrome://extensions/shortcuts).
// Mirrors popup.js's extraction/provider logic so the result lands in the same
// chrome.storage.session history the popup reads on open.

const DEFAULTS = {
  provider: "gemini",
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

const MAX_HISTORY = 5;

function clampMaxChars(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 80000;
  return Math.max(1000, Math.min(n, 4000000));
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "summarize-page") return;
  summarizeActiveTab().catch((e) => showError(e.message));
});

function showError(message) {
  console.error("SummIT shortcut:", message);
  chrome.action.setBadgeBackgroundColor({ color: "#c74a3a" });
  chrome.action.setBadgeText({ text: "!" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}

async function summarizeActiveTab() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const settings = { ...DEFAULTS, ...stored };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    throw new Error("This page can't be read.");
  }

  chrome.action.setBadgeBackgroundColor({ color: "#2e8bc9" });
  chrome.action.setBadgeText({ text: "..." });

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      text: document.body ? document.body.innerText : "",
      title: document.title || "",
      url: location.href,
    }),
  });
  const page = results?.[0]?.result;
  if (!page || !page.text.trim()) throw new Error("No readable text found on this page.");

  let text = page.text.trim();
  const limit = clampMaxChars(settings.provider === "ollama" ? settings.ollamaMaxChars : settings.geminiMaxChars);
  const truncated = text.length > limit;
  if (truncated) text = text.slice(0, limit);

  const preset = settings.presets[Number(settings.lastPreset) || 0] || settings.presets[0];

  const lines = [];
  if (settings.includeTitle && page.title) lines.push(`Page title: ${page.title}`);
  if (settings.includeUrl) lines.push(`URL: ${page.url}`);
  if (settings.includeDate) lines.push(`Captured: ${new Date().toISOString()}`);
  const header = lines.length ? lines.join("\n") + "\n\n" : "";
  const userMessage = header + "Page content:\n\n" + text;

  const output =
    settings.provider === "ollama"
      ? await callOllama(settings, preset.prompt, userMessage)
      : await callGemini(settings, preset.prompt, userMessage);

  const item = {
    raw: output,
    label: `${preset.name} · shortcut${truncated ? " (truncated)" : ""}`,
    meta: { title: page.title, url: page.url },
    ts: Date.now(),
  };
  const sessionStored = await chrome.storage.session.get("history");
  const history = Array.isArray(sessionStored.history) ? sessionStored.history : [];
  history.unshift(item);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.session.set({ history });

  chrome.action.setBadgeText({ text: "" });
  try {
    await chrome.action.openPopup();
  } catch {
    // Some Chrome versions/window states refuse a programmatic popup open.
    // The result is still saved in history, so flag it and let the user click the icon.
    chrome.action.setBadgeBackgroundColor({ color: "#2e8bc9" });
    chrome.action.setBadgeText({ text: "✓" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 6000);
  }
}

async function callGemini(settings, systemPrompt, userMessage) {
  if (!settings.geminiKey) throw new Error("No Gemini API key set.");
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
  if (!res.ok) throw new Error(`Gemini error (${res.status}).`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
  if (!text) throw new Error("Gemini returned an empty response.");
  return text.trim();
}

async function callOllama(settings, systemPrompt, userMessage) {
  const base = settings.ollamaUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/chat`, {
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
  if (!res.ok) throw new Error(`Ollama error (${res.status}).`);
  const data = await res.json();
  const text = data?.message?.content;
  if (!text) throw new Error("Ollama returned an empty response.");
  return text.trim();
}
