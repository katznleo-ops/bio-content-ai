# EduCator

EduCator is a responsive tutoring website framework for exploring questions across subjects. This branch turns the original single-question page into a welcome page, study dashboard, and multi-turn chat experience.

## What's included

- A branded entry page describing the tutoring experience.
- A dashboard with subject starters, prompt ideas, and an open-ended composer.
- Multi-turn chat with a tutor-style system prompt, loading state, retry option, and copy-answer control.
- Conversation history saved in the current browser using `localStorage`, with search, rename, delete, and clear controls. There is no account or cloud sync in this starter framework.
- Responsive layout and basic accessible labels/keyboard behavior.
- A serverless endpoint at `api/solve.js` that accepts conversation history and calls the model service from the server. It never exposes the API credential to frontend code.

## Site structure

- `index.html` + `landing.css` — the public landing page.
- `educator/app/index.html` + `app.css` + `app.js` — the study app. Routes live in the URL hash (`#/chat/<id>`, `#/nb/<id>/plan`, `#/nb/<id>/quiz/<id>`, …), so refreshing keeps the learner where they were on any static host.
- `markdown.js` — safe Markdown + math renderer for answers; `vendor/katex/` — self-hosted KaTeX.

### Notebooks

Notebooks are private study spaces. Each has a goal, level, pace, optional target date, an AI-generated learning plan (lessons with objectives that can be started as guided sessions and marked complete), AI-generated multiple-choice quizzes with saved attempts, and its own chat sessions that never appear in the general chat list. Notebook sessions send the notebook's goal, plan progress, and recent quiz misses to the tutor as context.

## Run the frontend locally

Because the site calls a serverless endpoint, opening `index.html` directly will not provide a working chat API. Serve the static files locally and run the API in a compatible serverless development environment, or deploy the project to a platform that serves the `api/` function.

The frontend defaults to the same-origin endpoint `/api/solve`. If your frontend and API are deployed on different domains, set `window.EDUCATOR_API_URL` to the full API URL before `app.js` loads, and add the frontend origin to the server's allowed origins (or `EXTRA_ORIGINS`). Do not put an API key in `index.html`, `app.js`, or any other browser-delivered file.

## API contract

`POST /api/solve`

```json
{
  "messages": [
    { "role": "user", "text": "Can you explain fractions?" },
    { "role": "model", "text": "A fraction represents part of a whole…" },
    { "role": "user", "text": "Can you show an example?" }
  ]
}
```

Returns `{ "answer": "…", "model": "…" }`. Optional fields: `"stream": true` streams newline-delimited JSON (`{"t":"text"}` chunks, then `{"done":true}`); `"format": "json"` asks the model for a single JSON object (used for plans and quizzes; never streamed); `"context"` (string, up to 6000 characters) is appended to the system prompt as learner context. The existing `{ "prompt": "…" }` input shape remains accepted for compatibility. The backend reads `GEMINI_API_KEY` and optional `GEMINI_MODEL` from the server environment; those deployment settings are intentionally kept separate from the website framework.

## Chat history and privacy

Conversation history is stored in this browser only. Clearing site data or using a different browser/device removes or does not show that history. Messages sent to the chat are sent to the configured backend for a response. Add authentication, a database, rate limits, privacy disclosures, and abuse protection before opening this as a public service.

## Next steps

- Choose and configure the hosting/API deployment.
- Add sign-in and cloud-synced chat history if needed.
- Add per-user data controls, rate limiting, and clear privacy/education-safety policies before public launch.
- Add tests and monitoring for the API and frontend.
