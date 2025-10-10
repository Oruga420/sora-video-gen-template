import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

let openaiClient = null;
if (!process.env.OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY is not set. API routes will return errors until it is provided.');
} else {
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const ensureClient = (res) => {
  if (!openaiClient) {
    res.status(500).json({ error: 'Server is missing OPENAI_API_KEY configuration.' });
    return false;
  }
  return true;
};

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/videos', async (req, res) => {
  if (!ensureClient(res)) return;

  const {
    prompt,
    model = 'sora-2',
    size = '1280x720',
    seconds = 8,
    remix_video_id,
    input_reference,
  } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  const payload = {
    model,
    prompt: prompt.trim(),
    size,
    seconds,
  };

  if (remix_video_id) {
    payload.remix_video_id = remix_video_id;
  }

  if (input_reference) {
    payload.input_reference = input_reference;
  }

  try {
    const job = await openaiClient.videos.create(payload);
    res.status(202).json(job);
  } catch (error) {
    console.error('Failed to create video job', error);
    const status = error.status ?? 500;
    const message =
      error?.response?.data?.error?.message ??
      error?.error?.message ??
      error?.message ??
      'Failed to start video generation.';
    res.status(status).json({ error: message });
  }
});

app.get('/api/videos/:id', async (req, res) => {
  if (!ensureClient(res)) return;

  try {
    const job = await openaiClient.videos.retrieve(req.params.id);
    res.json(job);
  } catch (error) {
    console.error(`Failed to retrieve job ${req.params.id}`, error);
    const status = error.status ?? 500;
    const message =
      error?.response?.data?.error?.message ??
      error?.error?.message ??
      error?.message ??
      'Failed to retrieve video status.';
    res.status(status).json({ error: message });
  }
});

app.get('/api/videos/:id/content', async (req, res) => {
  if (!ensureClient(res)) return;

  try {
    const variant = req.query.variant ?? 'video';
    const content = await openaiClient.videos.downloadContent(req.params.id, { variant });

    const contentType = content.headers.get('content-type') ?? 'video/mp4';
    const contentLength = content.headers.get('content-length');
    const disposition = content.headers.get('content-disposition');

    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    if (disposition) {
      res.setHeader('Content-Disposition', disposition);
    }

    const arrayBuffer = await content.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error(`Failed to download content for ${req.params.id}`, error);
    const status = error.status ?? 500;
    const message =
      error?.response?.data?.error?.message ??
      error?.error?.message ??
      error?.message ??
      'Failed to download video content.';
    res.status(status).json({ error: message });
  }
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Sora video generator server listening on http://localhost:${PORT}`);
  });
}

export default app;
