# Page Summarizer (v1)

Extract page text, summarize with Gemini or local Ollama, using your own saved prompts.

## Load for testing
1. chrome://extensions → enable Developer mode
2. "Load unpacked" → select this folder
3. Open Settings (link in popup), paste a Gemini API key (free at aistudio.google.com), save

## Ollama note
Ollama blocks extension requests by default. Run it with:
```
OLLAMA_ORIGINS=chrome-extension://* ollama serve
```
(Windows: set OLLAMA_ORIGINS as an environment variable, restart Ollama.)

## Store submission checklist
1. Test on 5–10 varied sites (news, docs, SPA, long article — confirm truncation notice)
2. Host PRIVACY.md publicly (GitHub Pages / repo link)
3. Zip the folder contents (not the folder itself): manifest.json at zip root
4. Chrome Web Store dev dashboard ($5 one-time) → New item → upload zip
5. Listing needs: 1280×800 screenshot, 128px icon (included), description, privacy policy URL
6. Data-use disclosure: declare "website content" is transmitted to the user's chosen AI provider; no data collected by developer
7. Permission justifications:
   - activeTab/scripting: "Reads visible text of the current page when the user clicks Extract/Summarize"
   - storage: "Saves user settings and prompt presets locally"
   - host permissions: "Sends user-initiated requests to the Gemini API and the user's local Ollama server"

## v1.1 roadmap
- Google Drive export (OAuth + verification review)
- Readability.js article extraction
- Streaming responses
