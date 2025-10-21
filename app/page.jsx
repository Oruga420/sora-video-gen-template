"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL = 60000; // 60 seconds between polls
const COUNTDOWN_TICK_MS = 1000;
const STALLED_WARN_MS = 10 * 60 * 1000; // 10 minutes

const PROVIDER_LABELS = {
  openai: "OpenAI",
  replicate: "Replicate",
};

const MODEL_CATALOG = [
  {
    category: "OpenAI",
    options: [
      {
        id: "openai:sora-2",
        provider: "openai",
        apiModel: "sora-2",
        label: "Sora 2 (fast iteration)",
        secondsOptions: ["4", "8", "12"],
        defaultSeconds: "8",
        sizeOptions: ["1280x720"],
        defaultSize: "1280x720",
      },
      {
        id: "openai:sora-2-pro",
        provider: "openai",
        apiModel: "sora-2-pro",
        label: "Sora 2 Pro (high fidelity)",
        secondsOptions: ["4", "8", "12"],
        defaultSeconds: "8",
        sizeOptions: ["1280x720"],
        defaultSize: "1280x720",
      },
    ],
  },
  {
    category: "Replicate",
    options: [
      {
        id: "replicate:bytedance/seedance-1-pro",
        provider: "replicate",
        apiModel: "bytedance/seedance-1-pro",
        label: "Seedance 1 Pro (5-10s, 1080p/480p)",
        secondsOptions: ["5", "10"],
        defaultSeconds: "5",
        sizeOptions: ["1080p", "480p"],
        defaultSize: "1080p",
      },
    ],
  },
];

const ALL_MODEL_OPTIONS = MODEL_CATALOG.flatMap((group) =>
  group.options.map((option) => ({
    ...option,
    category: group.category,
  }))
);

const MODEL_LOOKUP = Object.fromEntries(ALL_MODEL_OPTIONS.map((option) => [option.id, option]));
const DEFAULT_MODEL_ID = ALL_MODEL_OPTIONS[0].id;

const MODEL_LABEL_LOOKUP = Object.fromEntries(
  ALL_MODEL_OPTIONS.map((option) => [option.id, option.label])
);

const formatStatus = (status = "") =>
  status
    .toString()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatTime = (date) =>
  date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const formatCountdown = (seconds) => {
  if (seconds == null) {
    return "";
  }
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
  }
  return `${remainder}s`;
};

const formatSizeLabel = (value) => {
  switch (value) {
    case "1280x720":
      return "1280 x 720 - HD landscape";
    case "1080p":
      return "1080p - Full HD";
    case "480p":
      return "480p - SD";
    default:
      return value;
  }
};

export default function HomePage() {
  const defaultModelOption = MODEL_LOOKUP[DEFAULT_MODEL_ID] ?? ALL_MODEL_OPTIONS[0];
  const defaultSeconds = defaultModelOption?.defaultSeconds ?? "8";
  const defaultSize = defaultModelOption?.defaultSize ?? "1280x720";
  const defaultModelId = defaultModelOption?.id ?? DEFAULT_MODEL_ID;

  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(defaultModelId);
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [size, setSize] = useState(defaultSize);
  const [remixVideoId, setRemixVideoId] = useState("");
  const [inputReference, setInputReference] = useState("");

  const selectedModelOption = MODEL_LOOKUP[modelId] ?? defaultModelOption;
  const selectedProvider = selectedModelOption?.provider ?? "openai";
  const selectedProviderLabel = PROVIDER_LABELS[selectedProvider] ?? selectedProvider;
  const secondsOptions = selectedModelOption?.secondsOptions ?? [defaultSeconds];
  const sizeOptions = selectedModelOption?.sizeOptions ?? [defaultSize];
  const [videos, setVideos] = useState([]);
  const [logs, setLogs] = useState([]);
  const [statusLed, setStatusLed] = useState("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollersRef = useRef(new Map());
  const objectUrlsRef = useRef(new Set());
  const promptRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const videosRef = useRef([]);

  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  const emitLog = useCallback((message, type = "info") => {
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message,
        type,
        timestamp: new Date(),
      },
      ...prev,
    ]);
  }, []);

  const mutateVideo = useCallback((id, updater) => {
    setVideos((prev) =>
      prev.map((video) => {
        if (video.id !== id) {
          return video;
        }
        const nextVideo = updater(video) ?? video;
        return nextVideo;
      })
    );
  }, []);

  const clearPoller = useCallback((id) => {
    const poller = pollersRef.current.get(id);
    if (poller?.timeoutId) {
      clearTimeout(poller.timeoutId);
    }
    if (poller) {
      pollersRef.current.delete(id);
    }
  }, []);

  const attemptDownload = useCallback(
    async (jobId, provider, { markCompleted = false, reason = "poll" } = {}) => {
      try {
        const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
        const response = await fetch(
          `/api/videos/${encodeURIComponent(jobId)}/content${query}`
        );

        if (response.status === 404) {
          if (reason === "fallback") {
            mutateVideo(jobId, (video) => ({
              ...video,
              fallbackTriggered: true,
              fallbackAttempts: (video?.fallbackAttempts ?? 0) + 1,
              lastFallbackAttemptAt: Date.now(),
            }));
            emitLog(`Fallback download for ${jobId} not ready yet (404).`, "info");
          }
          return false;
        }

        if (!response.ok) {
          throw new Error(`Download failed with status ${response.status}`);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.add(objectUrl);

        mutateVideo(jobId, (video) => {
          if (video.objectUrl) {
            URL.revokeObjectURL(video.objectUrl);
            objectUrlsRef.current.delete(video.objectUrl);
          }
          return {
            ...video,
            status: markCompleted ? "completed" : video.status,
            progress: markCompleted ? 100 : video.progress,
            objectUrl,
            errorMessage: null,
            nextPollAt: null,
            timeUntilNextPoll: null,
            fallbackTriggered:
              reason === "fallback" ? true : video?.fallbackTriggered ?? false,
            fallbackAttempts:
              reason === "fallback"
                ? (video?.fallbackAttempts ?? 0) + 1
                : video?.fallbackAttempts ?? 0,
            lastFallbackAttemptAt:
              reason === "fallback" ? Date.now() : video?.lastFallbackAttemptAt ?? null,
          };
        });

        emitLog(
          reason === "fallback"
            ? `Job ${jobId} content fetched via fallback download.`
            : `Job ${jobId} completed. Video secured.`,
          "success"
        );
        setStatusLed("done");
        clearPoller(jobId);
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown download error";

        if (reason === "fallback") {
          emitLog(`Fallback download for ${jobId} hit an error: ${message}`, "error");
          mutateVideo(jobId, (video) => ({
            ...video,
            fallbackTriggered: true,
            fallbackAttempts: (video?.fallbackAttempts ?? 0) + 1,
            lastFallbackAttemptAt: Date.now(),
            errorMessage: video.errorMessage ?? message,
          }));
          return false;
        }

        mutateVideo(jobId, (video) => ({
          ...video,
          status: "failed",
          errorMessage: message,
          nextPollAt: null,
          timeUntilNextPoll: null,
        }));
        emitLog(`Job ${jobId} download failed: ${message}`, "error");
        setStatusLed("error");
        clearPoller(jobId);
        return false;
      }
    },
    [clearPoller, emitLog, mutateVideo]
  );

  useEffect(() => {
    return () => {
      pollersRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      pollersRef.current.clear();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    countdownIntervalRef.current = setInterval(() => {
      setVideos((prev) =>
        prev.map((video) => {
          if (!video.nextPollAt || video.status === "completed" || video.status === "failed") {
            if (video.timeUntilNextPoll != null) {
              return {
                ...video,
                timeUntilNextPoll: null,
              };
            }
            return video;
          }

          const remaining = Math.max(0, Math.ceil((video.nextPollAt - Date.now()) / 1000));
          if (remaining === video.timeUntilNextPoll) {
            return video;
          }

          return {
            ...video,
            timeUntilNextPoll: remaining,
          };
        })
      );
    }, COUNTDOWN_TICK_MS);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  const startPolling = useCallback(
    (jobId, providerHint = "openai") => {
      const baseProvider = providerHint ?? "openai";
      const schedulePoll = (pollFn, delayMs) => {
        const nextAt = Date.now() + delayMs;
        mutateVideo(jobId, (video) => ({
          ...video,
          nextPollAt: nextAt,
          timeUntilNextPoll: Math.ceil(delayMs / 1000),
        }));

        const existing = pollersRef.current.get(jobId);
        if (existing?.timeoutId) {
          clearTimeout(existing.timeoutId);
        }

        const timeoutId = setTimeout(pollFn, delayMs);
        pollersRef.current.set(jobId, { poll: pollFn, timeoutId, provider: baseProvider });
      };

      const poll = async () => {
        try {
          mutateVideo(jobId, (video) => ({
            ...video,
            nextPollAt: Date.now(),
            timeUntilNextPoll: null,
          }));

          const snapshotBeforeFetch =
            videosRef.current.find((video) => video.id === jobId) ?? null;
          const effectiveProvider =
            snapshotBeforeFetch?.provider ?? baseProvider ?? "openai";
          const providerQuery = effectiveProvider
            ? `?provider=${encodeURIComponent(effectiveProvider)}`
            : "";

          const response = await fetch(
            `/api/videos/${encodeURIComponent(jobId)}${providerQuery}`
          );
          if (!response.ok) {
            throw new Error(`Status fetch failed with code ${response.status}`);
          }
          const job = await response.json();
          const rawProgress = Number(job.progress ?? 0);
          const progress = Number.isFinite(rawProgress) ? rawProgress : 0;
          const createdAtMs = ((job.created_at ?? Math.floor(Date.now() / 1000)) * 1000);
          let shouldWarn = false;

          const currentPoller = pollersRef.current.get(jobId);
          if (currentPoller) {
            pollersRef.current.set(jobId, {
              ...currentPoller,
              provider: job.provider ?? currentPoller.provider ?? effectiveProvider,
            });
          }

          mutateVideo(jobId, (video) => {
            const effectiveCreatedAt = video?.createdAt ?? createdAtMs;
            const stalled =
              job.status === "in_progress" &&
              Date.now() - effectiveCreatedAt > STALLED_WARN_MS &&
              !(video?.notifiedStall);

            if (stalled) {
              shouldWarn = true;
            }

            const providerForVideo =
              job.provider ?? video?.provider ?? effectiveProvider;
            const inferredModelId =
              job.model
                ? ALL_MODEL_OPTIONS.find(
                    (option) =>
                      option.apiModel === job.model &&
                      option.provider === providerForVideo
                  )?.id ?? video?.modelId
                : video?.modelId;

            return {
              ...video,
              provider: providerForVideo,
              model: job.model ?? video?.model,
              modelId: inferredModelId,
              status: job.status,
              progress,
              createdAt: effectiveCreatedAt,
              notifiedStall: video?.notifiedStall || stalled,
            };
          });

          if (shouldWarn) {
            emitLog(
              `Job ${jobId} is still in progress after ${Math.round(STALLED_WARN_MS / 60000)} minutes. Consider retrying the prompt.`,
              "error"
            );
            setStatusLed("error");
          }

          if (job.status === "completed") {
            const downloaded = await attemptDownload(jobId, effectiveProvider, {
              markCompleted: true,
              reason: "poll",
            });

            if (!downloaded) {
              schedulePoll(poll, Math.min(10000, POLL_INTERVAL));
            }
            return;
          }

          if (job.status === "failed") {
            const message = job.error ?? "Unknown failure";
            mutateVideo(jobId, (video) => ({
              ...video,
              status: "failed",
              errorMessage: message,
              progress: 100,
              nextPollAt: null,
              timeUntilNextPoll: null,
            }));
            emitLog(`Job ${jobId} failed: ${message}`, "error");
            setStatusLed("error");
            clearPoller(jobId);
            return;
          }

          setStatusLed("busy");
          let fallbackHandled = false;
          const snapshot = videosRef.current.find((video) => video.id === jobId);
          if (snapshot && !snapshot.objectUrl) {
            const fallbackAt =
              snapshot.downloadFallbackAt ??
              ((snapshot.createdAt ?? Date.now()) + 3 * 60 * 1000);
            const lastAttemptAt = snapshot.lastFallbackAttemptAt ?? 0;
            if (Date.now() >= fallbackAt && Date.now() - lastAttemptAt >= 30000) {
              emitLog(
                `Forcing fallback download for ${jobId} after waiting 3 minutes.`,
                "info"
              );
              const downloaded = await attemptDownload(
                jobId,
                snapshot.provider ?? effectiveProvider,
                {
                  markCompleted: true,
                  reason: "fallback",
                }
              );
              fallbackHandled = true;
              if (downloaded) {
                return;
              }
            }
          }

          if (fallbackHandled) {
            schedulePoll(poll, Math.min(15000, POLL_INTERVAL));
          } else {
            schedulePoll(poll, POLL_INTERVAL);
          }
        } catch (error) {
          emitLog(`Lost contact with job ${jobId}: ${error.message}`, "error");
          setStatusLed("error");
          mutateVideo(jobId, (video) => ({
            ...video,
            nextPollAt: null,
            timeUntilNextPoll: null,
          }));
          clearPoller(jobId);
        }
      };

      const existing = pollersRef.current.get(jobId);
      if (existing?.timeoutId) {
        clearTimeout(existing.timeoutId);
      }
      pollersRef.current.set(jobId, { poll, timeoutId: null, provider: baseProvider });
      poll();
    },
    [emitLog, mutateVideo, clearPoller, attemptDownload]
  );

  const forcePollNow = useCallback(
    (jobId, provider) => {
      const poller = pollersRef.current.get(jobId);
      if (poller?.timeoutId) {
        clearTimeout(poller.timeoutId);
        pollersRef.current.set(jobId, {
          poll: poller.poll,
          timeoutId: null,
          provider: poller.provider ?? provider ?? "openai",
        });
      }

      if (poller?.poll) {
        poller.poll();
      } else {
        const fallbackProvider = provider ?? "openai";
        startPolling(jobId, fallbackProvider);
      }
    },
    [startPolling]
  );

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
        emitLog("Cannot launch without mission intel. Provide a prompt.", "error");
        return;
      }

      const modelConfig = selectedModelOption ?? defaultModelOption;
      const provider = modelConfig?.provider ?? "openai";
      const providerLabel = PROVIDER_LABELS[provider] ?? provider;
      const apiModel = modelConfig?.apiModel ?? modelConfig?.id ?? "sora-2";
      const normalizedSeconds = String(seconds ?? modelConfig?.defaultSeconds ?? "8");
      const normalizedSize = String(size ?? modelConfig?.defaultSize ?? "1280x720");
      const payloadRemixId =
        provider === "openai" ? remixVideoId.trim() || undefined : undefined;
      const payloadInputReference = inputReference.trim() || undefined;

      setStatusLed("busy");
      setIsSubmitting(true);
      emitLog(
        `Dispatching ${providerLabel} :: ${modelConfig?.label ?? apiModel} prompt: "${trimmedPrompt}"`,
        "info"
      );

      try {
        const response = await fetch("/api/videos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: trimmedPrompt,
            provider,
            model: apiModel,
            seconds: normalizedSeconds,
            size: normalizedSize,
            remix_video_id: payloadRemixId,
            input_reference: payloadInputReference,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const message = errorBody?.error ?? `Request failed with status ${response.status}`;
          throw new Error(message);
        }

        const job = await response.json();
        const createdAtMs = ((job.created_at ?? Math.floor(Date.now() / 1000)) * 1000);
        emitLog(`Job ${job.id} queued. Tracking progress.`, "info");

        setVideos((prev) => [
          {
            id: job.id,
            prompt: trimmedPrompt,
            provider,
            model: apiModel,
            modelId: modelConfig?.id ?? modelId,
            seconds: normalizedSeconds,
            size: normalizedSize,
            status: job.status,
            progress: Number(job.progress ?? 0) || 0,
            objectUrl: null,
            errorMessage: null,
            createdAt: createdAtMs,
            notifiedStall: false,
            downloadFallbackAt: createdAtMs + 3 * 60 * 1000,
            fallbackAttempts: 0,
            fallbackTriggered: false,
            lastFallbackAttemptAt: null,
            nextPollAt: null,
            timeUntilNextPoll: null,
          },
          ...prev,
        ]);

        startPolling(job.id, provider);
        setPrompt("");
        setRemixVideoId("");
        setInputReference("");
      } catch (error) {
        emitLog(`Launch aborted: ${error.message}`, "error");
        setStatusLed("error");
      } finally {
        setIsSubmitting(false);
        if (promptRef.current) {
          promptRef.current.focus();
        }
      }
    },
    [
      prompt,
      selectedModelOption,
      defaultModelOption,
      modelId,
      seconds,
      size,
      remixVideoId,
      inputReference,
      emitLog,
      startPolling,
    ]
  );

  const handleReset = useCallback(() => {
    setPrompt("");
    setModelId(defaultModelId);
    setSeconds(defaultModelOption?.defaultSeconds ?? defaultSeconds);
    setSize(defaultModelOption?.defaultSize ?? defaultSize);
    setRemixVideoId("");
    setInputReference("");
    setStatusLed("idle");
    emitLog("Prompt buffer purged.", "info");
    if (promptRef.current) {
      promptRef.current.focus();
    }
  }, [defaultModelId, defaultModelOption, defaultSeconds, defaultSize, emitLog]);

  const handleRetry = useCallback(
    (video) => {
      setPrompt(video?.prompt ?? "");

      const inferredModelId =
        video?.modelId ??
        ALL_MODEL_OPTIONS.find(
          (option) =>
            option.apiModel === video?.model &&
            (video?.provider ? option.provider === video.provider : true)
        )?.id ??
        defaultModelId;

      const nextModelOption = MODEL_LOOKUP[inferredModelId] ?? defaultModelOption;
      setModelId(nextModelOption?.id ?? defaultModelId);

      const desiredSeconds =
        video?.seconds != null ? String(video.seconds) : nextModelOption?.defaultSeconds;
      const desiredSize =
        video?.size != null ? String(video.size) : nextModelOption?.defaultSize;

      const safeSeconds = nextModelOption?.secondsOptions?.includes(desiredSeconds)
        ? desiredSeconds
        : nextModelOption?.defaultSeconds ?? defaultSeconds;
      const safeSize = nextModelOption?.sizeOptions?.includes(desiredSize)
        ? desiredSize
        : nextModelOption?.defaultSize ?? defaultSize;

      setSeconds(safeSeconds);
      setSize(safeSize);
      setStatusLed("idle");
      emitLog("Prompt loaded back into the command deck for retry.", "info");
      if (promptRef.current) {
        promptRef.current.focus();
      }
    },
    [defaultModelId, defaultModelOption, defaultSeconds, defaultSize, emitLog]
  );

  const activeVideoCountLabel = `${videos.length} ${videos.length === 1 ? "Video Armed" : "Videos Armed"}`;

  return (
    <>
      <div className="scanlines" />
      <div className="pixel-overlay" />
      <header className="hero">
        <div className="hero__content">
          <h1 className="hero__title">
            <span className="title-glitch" data-text="Sesh Video Gen">
              {"Sesh\u00A0Video\u00A0Gen"}
            </span>
          </h1>
          <p className="hero__subtitle">
            Fuse retro grit with Sora's video synth. Prompt, deploy, and remix neon explosions in pure pixel style.
          </p>
        </div>
        <div className="hero__badge">
          <span className="badge-label">Sora API</span>
          <span className="badge-light" />
        </div>
      </header>

      <main className="layout">
        <section className="panel panel--prompt">
          <header className="panel__header">
            <h2>Command Deck</h2>
            <span className="status-led" data-state={statusLed} />
          </header>
          <form className="prompt-form" onSubmit={handleSubmit} onReset={handleReset}>
            <label className="prompt-form__label" htmlFor="prompt-input">
              Mission Prompt
            </label>
            <textarea
              id="prompt-input"
              name="prompt"
              rows={4}
              maxLength={600}
              placeholder="Example: Wide shot of two pixel commandos sprinting through a neon jungle, explosive synth lighting, dynamic parallax."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              ref={promptRef}
              required
            />
            <div className="prompt-form__actions">
              <button
                type="submit"
                className={`btn btn--primary${isSubmitting ? " is-loading" : ""}`}
                disabled={isSubmitting}
              >
                <span className="btn__icon">{isSubmitting ? "||" : ">>"}</span>
                {isSubmitting ? "Calibrating" : "Launch Generation"}
              </button>
              <button type="reset" className="btn btn--ghost">
                <span className="btn__icon">X</span>
                Purge Prompt
              </button>
            </div>
            <section className="config-panel" aria-label="Render configuration">
              <header className="config-panel__header">
                <h3>Render Specs</h3>
                <span>Fine-tune how each engine composes the clip.</span>
              </header>
              <div className="config-grid">
                <label className="config-field">
                  <span>Model</span>
                  <select
                    value={modelId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      const nextOption = MODEL_LOOKUP[nextId] ?? defaultModelOption;
                      setModelId(nextOption?.id ?? nextId);

                      if (nextOption) {
                        const nextSeconds = nextOption.secondsOptions?.includes(String(seconds))
                          ? String(seconds)
                          : nextOption.defaultSeconds;
                        const nextSize = nextOption.sizeOptions?.includes(String(size))
                          ? String(size)
                          : nextOption.defaultSize;
                        setSeconds(nextSeconds);
                        setSize(nextSize);
                        if (nextOption.provider !== "openai") {
                          setRemixVideoId("");
                        }
                      }
                    }}
                  >
                    {MODEL_CATALOG.map((group) => (
                      <optgroup key={group.category} label={group.category}>
                        {group.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="config-field">
                  <span>Seconds</span>
                  <select
                    value={seconds}
                    onChange={(event) => setSeconds(event.target.value)}
                  >
                    {secondsOptions.map((optionValue) => (
                      <option key={optionValue} value={optionValue}>
                        {`${optionValue}s`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="config-field">
                  <span>Canvas</span>
                  <select
                    value={size}
                    onChange={(event) => setSize(event.target.value)}
                  >
                    {sizeOptions.map((optionValue) => (
                      <option key={optionValue} value={optionValue}>
                        {formatSizeLabel(optionValue)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="config-field config-field--wide">
                  <span>Remix video id</span>
                  <input
                    type="text"
                    placeholder="Optional: video_xxx to reuse structure"
                    value={remixVideoId}
                    disabled={selectedProvider !== "openai"}
                    title={
                      selectedProvider !== "openai"
                        ? "Remix is only available for OpenAI Sora models."
                        : undefined
                    }
                    onChange={(event) => setRemixVideoId(event.target.value)}
                  />
                </label>
                <label className="config-field config-field--wide">
                  <span>Input reference</span>
                  <input
                    type="text"
                    placeholder={
                      selectedProvider === "replicate"
                        ? "Optional: image URL for first frame"
                        : "Optional: hosted image URL or asset key"
                    }
                    value={inputReference}
                    onChange={(event) => setInputReference(event.target.value)}
                  />
                </label>
              </div>
            </section>
          </form>
          <div className="log-feed" id="log-feed" aria-live="polite">
            {logs.map((log) => (
              <article key={log.id} className="log-entry" data-type={log.type}>
                <span className="log-entry__time">{formatTime(log.timestamp)}</span>
                <span className="log-entry__message">{log.message}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel--videos">
          <header className="panel__header">
            <h2>Hangar Bay</h2>
            <div className="panel__meta">
              <span className="meta-chip" id="video-count">
                {activeVideoCountLabel}
              </span>
            </div>
          </header>
          <div id="video-grid" className="video-grid" role="list">
            {videos.map((video) => {
              const isFailed = video.status === "failed";
              const canDownload = Boolean(video.objectUrl);
              const progressLabel = isFailed ? "ERR" : `${Math.round(video.progress ?? 0)}%`;
              const providerLabel = PROVIDER_LABELS[video.provider] ?? video.provider ?? "OpenAI";
              const modelLabel =
                MODEL_LABEL_LOOKUP[video.modelId] ?? video.model ?? "Unknown model";
              const displaySeconds =
                video.seconds != null ? `${video.seconds}s` : null;
              const displaySize = video.size ? formatSizeLabel(video.size) : null;

              return (
                <article className="video-card" role="listitem" key={video.id}>
                  <header className="video-card__header">
                    <span className="video-card__title">Operation {video.id.slice(-6).toUpperCase()}</span>
                    <span className="video-card__status" data-status={video.status}>
                      {formatStatus(video.status)}
                    </span>
                  </header>
                  <div className="video-card__body">
                    <div className="video-shell">
                      <div className="video-shell__screen">
                        {video.objectUrl ? (
                          <video
                            src={video.objectUrl}
                            controls
                            playsInline
                            loop
                            preload="metadata"
                          />
                        ) : (
                          <div className="loading-scan">
                            <span className="loading-scan__bar" />
                            <span className="loading-scan__bar" />
                            <span className="loading-scan__bar" />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="video-card__details">
                      <div className="video-card__meta">
                        <span className="meta-chip meta-chip--compact">
                          {providerLabel}
                        </span>
                        <span className="meta-chip meta-chip--compact">
                          {modelLabel}
                        </span>
                        {displaySeconds ? (
                          <span className="meta-chip meta-chip--compact meta-chip--ghost">
                            {displaySeconds}
                          </span>
                        ) : null}
                        {displaySize ? (
                          <span className="meta-chip meta-chip--compact meta-chip--ghost">
                            {displaySize}
                          </span>
                        ) : null}
                      </div>
                      <p className="video-card__prompt">{video.prompt}</p>
                      <div className="video-card__progress">
                        <div className="progress-bar">
                          <span
                            className="progress-bar__fill"
                            style={{ width: `${Math.max(0, Math.min(video.progress ?? 0, 100))}%` }}
                          />
                        </div>
                        <span className="progress-percent">{progressLabel}</span>
                      {isFailed && video.errorMessage ? (
                        <p className="video-card__error">{video.errorMessage}</p>
                      ) : null}
                      </div>
                      {video.timeUntilNextPoll != null && !canDownload && !isFailed && (
                        <span className="next-poll">
                          Next check in {formatCountdown(video.timeUntilNextPoll)}
                        </span>
                      )}
                    </div>
                  </div>
                  <footer className="video-card__footer">
                    <button
                      type="button"
                      className="btn btn--mini btn--ghost"
                      onClick={() => handleRetry(video)}
                      hidden={!isFailed}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      className="btn btn--mini btn--ghost"
                      onClick={() => forcePollNow(video.id, video.provider)}
                      hidden={canDownload || isFailed}
                    >
                      Check now
                    </button>
                    <a
                      className="btn btn--mini btn--ghost"
                      href={`/api/videos/${video.id}?provider=${encodeURIComponent(video.provider ?? "openai")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Status JSON
                    </a>
                    <a
                      className="btn btn--mini btn--download"
                      href={canDownload ? video.objectUrl : "#"}
                      download={canDownload ? `${video.id}.mp4` : undefined}
                      hidden={!canDownload}
                    >
                      <span className="btn__icon">DL</span>
                      Download
                    </a>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>Built for high-octane experimentation. Videos persist until reload. Strap in.</p>
      </footer>
    </>
  );
}
