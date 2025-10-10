"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL = 3500;

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

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [videos, setVideos] = useState([]);
  const [logs, setLogs] = useState([]);
  const [statusLed, setStatusLed] = useState("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollersRef = useRef(new Map());
  const objectUrlsRef = useRef(new Set());
  const promptRef = useRef(null);

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
    const timeoutId = pollersRef.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      pollersRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    return () => {
      pollersRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      pollersRef.current.clear();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);

  const startPolling = useCallback(
    (jobId) => {
      const poll = async () => {
        try {
          const response = await fetch(`/api/videos/${encodeURIComponent(jobId)}`);
          if (!response.ok) {
            throw new Error(`Status fetch failed with code ${response.status}`);
          }
          const job = await response.json();
          const rawProgress = Number(job.progress ?? 0);
          const progress = Number.isFinite(rawProgress) ? rawProgress : 0;

          mutateVideo(jobId, (video) => ({
            ...video,
            status: job.status,
            progress,
          }));

          if (job.status === "completed") {
            try {
              const contentResponse = await fetch(
                `/api/videos/${encodeURIComponent(jobId)}/content`
              );
              if (!contentResponse.ok) {
                throw new Error(`Download failed with status ${contentResponse.status}`);
              }
              const blob = await contentResponse.blob();
              const objectUrl = URL.createObjectURL(blob);
              objectUrlsRef.current.add(objectUrl);

              mutateVideo(jobId, (video) => {
                if (video.objectUrl) {
                  URL.revokeObjectURL(video.objectUrl);
                  objectUrlsRef.current.delete(video.objectUrl);
                }
                return {
                  ...video,
                  status: "completed",
                  progress: 100,
                  objectUrl,
                  errorMessage: null,
                };
              });

              emitLog(`Job ${jobId} completed. Video secured.`, "success");
              setStatusLed("done");
            } catch (downloadError) {
              mutateVideo(jobId, (video) => ({
                ...video,
                status: "failed",
                errorMessage: downloadError.message,
              }));
              emitLog(`Job ${jobId} download failed: ${downloadError.message}`, "error");
              setStatusLed("error");
            }

            clearPoller(jobId);
            return;
          }

          if (job.status === "failed") {
            const message = job.error ?? "Unknown failure";
            mutateVideo(jobId, (video) => ({
              ...video,
              status: "failed",
              errorMessage: message,
              progress: 100,
            }));
            emitLog(`Job ${jobId} failed: ${message}`, "error");
            setStatusLed("error");
            clearPoller(jobId);
            return;
          }

          setStatusLed("busy");
        } catch (error) {
          emitLog(`Lost contact with job ${jobId}: ${error.message}`, "error");
          setStatusLed("error");
          clearPoller(jobId);
          return;
        }

        clearPoller(jobId);
        const timeoutId = setTimeout(poll, POLL_INTERVAL);
        pollersRef.current.set(jobId, timeoutId);
      };

      clearPoller(jobId);
      const timeoutId = setTimeout(poll, POLL_INTERVAL);
      pollersRef.current.set(jobId, timeoutId);
    },
    [emitLog, mutateVideo, clearPoller]
  );

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
        emitLog("Cannot launch without mission intel. Provide a prompt.", "error");
        return;
      }

      setStatusLed("busy");
      setIsSubmitting(true);
      emitLog(`Dispatching prompt: "${trimmedPrompt}"`, "info");

      try {
        const response = await fetch("/api/videos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt: trimmedPrompt }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const message = errorBody?.error ?? `Request failed with status ${response.status}`;
          throw new Error(message);
        }

        const job = await response.json();
        emitLog(`Job ${job.id} queued. Tracking progress.`, "info");

        setVideos((prev) => [
          {
            id: job.id,
            prompt: trimmedPrompt,
            status: job.status,
            progress: Number(job.progress ?? 0) || 0,
            objectUrl: null,
            errorMessage: null,
          },
          ...prev,
        ]);

        startPolling(job.id);
        setPrompt("");
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
    [prompt, emitLog, startPolling]
  );

  const handleReset = useCallback(() => {
    setPrompt("");
    setStatusLed("idle");
    emitLog("Prompt buffer purged.", "info");
    if (promptRef.current) {
      promptRef.current.focus();
    }
  }, [emitLog]);

  const handleRetry = useCallback((videoPrompt) => {
    setPrompt(videoPrompt);
    setStatusLed("idle");
    emitLog("Prompt loaded back into the command deck for retry.", "info");
    if (promptRef.current) {
      promptRef.current.focus();
    }
  }, [emitLog]);

  const activeVideoCountLabel = `${videos.length} ${videos.length === 1 ? "Video Armed" : "Videos Armed"}`;

  return (
    <>
      <div className="scanlines" />
      <div className="pixel-overlay" />
      <header className="hero">
        <div className="hero__content">
          <h1 className="hero__title">
            <span className="title-glitch" data-text="Contra Cutscene Lab">
              {"Contra\u00A0Cutscene\u00A0Lab"}
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
                      <p className="video-card__prompt">{video.prompt}</p>
                      <div className="video-card__progress">
                        <div className="progress-bar">
                          <span
                            className="progress-bar__fill"
                            style={{ width: `${Math.max(0, Math.min(video.progress ?? 0, 100))}%` }}
                          />
                        </div>
                        <span className="progress-percent">{progressLabel}</span>
                      </div>
                    </div>
                  </div>
                  <footer className="video-card__footer">
                    <button
                      type="button"
                      className="btn btn--mini btn--ghost"
                      onClick={() => handleRetry(video.prompt)}
                      hidden={!isFailed}
                    >
                      Retry
                    </button>
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
