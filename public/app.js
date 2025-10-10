const form = document.querySelector('#prompt-form');
const promptInput = document.querySelector('#prompt-input');
const generateButton = document.querySelector('#generate-btn');
const statusLed = document.querySelector('.status-led');
const logFeed = document.querySelector('#log-feed');
const videoGrid = document.querySelector('#video-grid');
const videoTemplate = document.querySelector('#video-card-template');
const videoCount = document.querySelector('#video-count');
const titleGlitch = document.querySelector('.title-glitch');

const POLL_INTERVAL = 3500;

const state = {
  videos: new Map(),
};

const formatStatus = (status = '') =>
  status
    .toString()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatTime = () => {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const log = (message, type = 'info') => {
  const entry = document.createElement('article');
  entry.classList.add('log-entry');
  entry.dataset.type = type;
  entry.innerHTML = `
    <span class="log-entry__time">${formatTime()}</span>
    <span class="log-entry__message">${message}</span>
  `;
  logFeed.prepend(entry);
};

const setStatusLed = (mode) => {
  statusLed.dataset.state = mode;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const updateVideoCounter = () => {
  const count = state.videos.size;
  const label = count === 1 ? 'Video Armed' : 'Videos Armed';
  videoCount.textContent = `${count} ${label}`;
};

const createVideoCard = (job, prompt) => {
  const fragment = videoTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.video-card');
  card.dataset.id = job.id;

  card.querySelector('.video-card__title').textContent = `Operation ${job.id.slice(-6).toUpperCase()}`;
  const statusChip = card.querySelector('.video-card__status');
  statusChip.dataset.status = job.status;
  statusChip.textContent = formatStatus(job.status);
  card.querySelector('.video-card__prompt').textContent = prompt;

  const retryBtn = card.querySelector('.retry-btn');
  retryBtn.addEventListener('click', () => {
    promptInput.value = prompt;
    card.classList.add('video-card--retrying');
    promptInput.focus({ preventScroll: false });
    log(`Prompt loaded back into the command deck for retry.`, 'info');
  });

  return card;
};

const getCardState = (id) => state.videos.get(id);

const setCardState = (id, data) => {
  state.videos.set(id, data);
  updateVideoCounter();
  return data;
};

const patchCardState = (id, patch) => {
  const previous = state.videos.get(id) ?? {};
  const next = { ...previous, ...patch };
  state.videos.set(id, next);
  updateVideoCounter();
  return next;
};

const updateCardStatus = (id, job) => {
  const cardState = getCardState(id);
  if (!cardState) return;
  const { element } = cardState;

  const statusChip = element.querySelector('.video-card__status');
  statusChip.dataset.status = job.status;
  statusChip.textContent = formatStatus(job.status);

  const progressFill = element.querySelector('.progress-bar__fill');
  const progressPercent = element.querySelector('.progress-percent');
  const rawProgress = Number(job.progress ?? 0);
  const progress = Number.isFinite(rawProgress) ? rawProgress : 0;

  progressFill.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
  progressPercent.textContent = `${progress.toFixed(0)}%`;
};

const renderVideoMedia = (id, objectUrl) => {
  const cardState = getCardState(id);
  if (!cardState) return;
  const { element } = cardState;
  const screen = element.querySelector('.video-shell__screen');

  screen.innerHTML = '';
  const video = document.createElement('video');
  video.src = objectUrl;
  video.controls = true;
  video.playsInline = true;
  video.loop = true;
  video.preload = 'metadata';

  screen.appendChild(video);

  const downloadButton = element.querySelector('.btn--download');
  downloadButton.href = objectUrl;
  downloadButton.download = `${id}.mp4`;
  downloadButton.hidden = false;

  patchCardState(id, { objectUrl, status: 'completed' });
};

const handleJobFailure = (id, message) => {
  const cardState = getCardState(id);
  if (!cardState) return;
  const { element } = cardState;

  const progressFill = element.querySelector('.progress-bar__fill');
  const progressPercent = element.querySelector('.progress-percent');
  const retryBtn = element.querySelector('.retry-btn');

  progressFill.style.background = 'linear-gradient(90deg, rgba(255, 68, 102, 0.8), rgba(255, 68, 102, 0.45))';
  progressFill.style.width = '100%';
  progressPercent.textContent = 'ERR';
  retryBtn.hidden = false;

  log(`Job ${id} failed: ${message}`, 'error');
  patchCardState(id, { status: 'failed' });
};

const fetchVideoBlobUrl = async (id) => {
  const response = await fetch(`/api/videos/${encodeURIComponent(id)}/content`);
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

const pollJob = async (jobId) => {
  let keepPolling = true;

  while (keepPolling) {
    await delay(POLL_INTERVAL);
    let job;
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(jobId)}`);
      if (!response.ok) {
        throw new Error(`Status fetch failed with code ${response.status}`);
      }
      job = await response.json();
    } catch (error) {
      setStatusLed('error');
      log(`Lost contact with job ${jobId}: ${error.message}`, 'error');
      return;
    }

    updateCardStatus(jobId, job);

    if (job.status === 'completed') {
      try {
        const objectUrl = await fetchVideoBlobUrl(jobId);
        renderVideoMedia(jobId, objectUrl);
        log(`Job ${jobId} completed. Video secured.`, 'success');
        setStatusLed('done');
      } catch (downloadError) {
        handleJobFailure(jobId, downloadError.message);
        setStatusLed('error');
      }
      keepPolling = false;
    } else if (job.status === 'failed') {
      handleJobFailure(jobId, job.error ?? 'Unknown failure');
      setStatusLed('error');
      keepPolling = false;
    } else {
      setStatusLed('busy');
    }
  }
};

const submitPrompt = async (prompt) => {
  setStatusLed('busy');
  generateButton.disabled = true;
  generateButton.classList.add('is-loading');
  generateButton.innerHTML = '<span class="btn__icon">||</span> Calibrating';

  try {
    const response = await fetch('/api/videos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error ?? `Request failed with status ${response.status}`);
    }

    const job = await response.json();
    log(`Job ${job.id} queued. Tracking progress.`, 'info');

    const card = createVideoCard(job, prompt);
    videoGrid.prepend(card);

    setCardState(job.id, {
      element: card,
      prompt,
      status: job.status,
      objectUrl: null,
    });

    updateVideoCounter();
    updateCardStatus(job.id, job);
    pollJob(job.id);
  } catch (error) {
    log(`Launch aborted: ${error.message}`, 'error');
    setStatusLed('error');
  } finally {
    promptInput.value = '';
    promptInput.focus({ preventScroll: false });
    generateButton.disabled = false;
    generateButton.classList.remove('is-loading');
    generateButton.innerHTML = '<span class="btn__icon">>></span> Launch Generation';
  }
};

if (titleGlitch) {
  titleGlitch.dataset.text = titleGlitch.textContent.trim();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) {
    log('Cannot launch without mission intel. Provide a prompt.', 'error');
    return;
  }

  log(`Dispatching prompt: "${prompt}"`, 'info');
  submitPrompt(prompt);
});

form.addEventListener('reset', () => {
  setStatusLed('idle');
  log('Prompt buffer purged.', 'info');
});

window.addEventListener('focus', () => {
  document.body.classList.add('focused');
});

window.addEventListener('blur', () => {
  document.body.classList.remove('focused');
});

window.addEventListener('beforeunload', () => {
  for (const { objectUrl } of state.videos.values()) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
});
