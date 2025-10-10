## Contra Cutscene Lab

Dynamic pixel-inspired interface for launching Sora video generations with a neon Contra aesthetic. The app bridges a retro-styled front-end to the Sora API via a lightweight Express proxy, handles async job tracking, and surfaces completed renders for playback and download without clearing previous results until a page refresh.

### Prerequisites

- Node.js 18+
- A Sora-enabled OpenAI API key with access to the preview Video API

### Configuration

1. Install dependencies
   ```bash
   npm install
   ```
2. Copy and fill in environment variables
   ```bash
   cp .env.example .env
   # set OPENAI_API_KEY and optionally PORT
   ```

The server logs a warning and returns 500s on API routes until `OPENAI_API_KEY` is supplied.

### Usage

```bash
npm run start
# access http://localhost:3000
```

- Enter a prompt on the "Command Deck" form to launch a generation (`POST /api/videos`).
- The interface polls Sora for job status, visualizes progress, and downloads the completed MP4 once available.
- Videos persist on the page (playback + download) until you reload, meeting the acceptance requirement.
- Failed jobs expose a retry button that reloads the original prompt into the form.

### Implementation Notes

- `server.js` wraps the Sora API (`openai.videos.create`, `retrieve`, and `downloadContent`) and serves static assets from `public/`.
- The front-end (`public/index.html`, `styles.css`, `app.js`) delivers a responsive, animated Contra-inspired pixel experience using the specified purple, yellow, and toxic-green palette.
- Binary downloads are proxied through Express so the browser never exposes your API key.
