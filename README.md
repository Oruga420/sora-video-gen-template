## Sesh Video Gen

Next.js (App Router) playground for launching Sora video generations in a Contra-inspired pixel interface. The UI runs fully on Vercel's serverless platform: React handles the neon control deck, while API routes proxy calls to the Sora Video API so the browser never sees your key.

### Stack

- **Next.js 14** with the app directory and React Server/Client components
- **Sora Video API** via `openai` SDK (`videos.create`, `videos.retrieve`, `videos.downloadContent`)
- **Neon pixel styling** ported from the original static build into `app/globals.css`

### Prerequisites

- Node.js 18+
- An OpenAI API key with access to Sora Video (set as `OPENAI_API_KEY`)

### Local Setup

```bash
npm install
cp .env.example .env
# populate OPENAI_API_KEY in .env
npm run dev
```

Visit `http://localhost:3000` and submit a prompt from the Command Deck. Jobs are polled server-side, completed videos stream back for inline playback/download, and failures keep their prompts handy for a one-click retry.

### Deploying on Vercel

1. Push this branch to GitHub (done) and import the repo in Vercel.
2. Set an `OPENAI_API_KEY` environment variable in the Vercel project (Project Settings -> Environment Variables).
3. Deploy. Vercel automatically detects the Next.js app; no custom builds or rewrites required.

> The API routes (`app/api/videos/*`) run in the Node.js serverless runtime, so each request spins up the OpenAI client on demand. Keep prompts within guardrail limits to avoid failed generations.

### Project Structure

```
app/
  api/
    videos/
      route.js              # POST /api/videos
      [id]/route.js         # GET /api/videos/:id
      [id]/content/route.js # GET /api/videos/:id/content
  globals.css               # pixel-styled theme
  layout.jsx                # global layout + fonts
  page.jsx                  # Contra control deck UI
public/                     # static assets placeholder
.env.example                # environment template
sora_guide.md               # original Sora API guide (verbatim)
```

### Notes

- Generated videos persist on the page until a full reload, satisfying the original acceptance criteria.
- Object URLs are reclaimed on cleanup to avoid leaking browser memory.
- Render specs are locked to sora-2 at 1280x720 for predictable performance, and the UI auto-attempts a direct download 3 minutes after launch if Sora is slow to publish the MP4.
- Status polling throttles to once per minute with an on-card countdown to keep the API load minimal, plus a manual 'Check now' button when you need an immediate refresh.
- If the UI stalls, check Vercel deployment logs for request errors (missing key, prompt violation, etc.).




