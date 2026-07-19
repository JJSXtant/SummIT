----- Overview SummIT (v1) -----  

This is a simple extension to extract page text, summarize with your own Gemini or local Ollama, using your own saved prompts. This extension is for those who want fine tuned controls over the summarization process and use their own LLMs. 

The tool allows you to configure system prompt, number of tokens and meta data that is sent to the LLM. 

Future versions will be focused on syncing with automated systems: 

- Google Drive export (OAuth + verification review)
- Readability.js article extraction
- Streaming responses
- More LLM support


----- Keyboard shortcut ----- 

Default `Ctrl+Shift+Y` , (`Cmd+Shift+Y` on Mac) runs Summarize on the active tab using the last-used preset, without opening the popup first — handled by `background.js` via the `commands` API. Change it at `chrome://extensions/shortcuts` or the button in Settings. Result lands in the same result history the popup shows, so open the popup afterward if it didn't pop open automatically.


----- Ollama note ----- 

Ollama blocks extension requests by default. Run it with by allowing unblocking requests from chrome-extension to the server. This is done by setting OLLAMA_ORIGINS as an environment variable and restarting or running: 

`OLLAMA_ORIGINS=chrome-extension://* ollama serve`


