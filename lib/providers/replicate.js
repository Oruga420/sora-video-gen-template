import Replicate from "replicate";

const statusMap = {
  starting: "queued",
  pending: "queued",
  processing: "in_progress",
  running: "in_progress",
  succeeded: "completed",
  completed: "completed",
  failed: "failed",
  canceled: "failed",
};

export class ReplicateConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReplicateConfigurationError";
  }
}

export class ReplicateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReplicateValidationError";
  }
}

const REPLICATE_VIDEO_MODELS = {
  "bytedance/seedance-1-pro": {
    secondsOptions: ["5", "10"],
    defaultSeconds: "5",
    resolutionOptions: ["1080p", "480p"],
    defaultResolution: "1080p",
    aspectRatio: "16:9",
    supportsImageReference: true,
  },
};

let cachedClient = null;

const ensureToken = () => {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new ReplicateConfigurationError("Server is missing REPLICATE_API_TOKEN configuration.");
  }
  return token;
};

export const getReplicateClient = () => {
  if (!cachedClient) {
    cachedClient = new Replicate({
      auth: ensureToken(),
    });
  }
  return cachedClient;
};

const coerceSeconds = (value, allowed, fallback) => {
  const str = value != null ? String(value) : undefined;
  if (str && allowed.includes(str)) {
    return str;
  }
  return fallback;
};

const coerceResolution = (value, allowed, fallback) => {
  const str = value != null ? String(value) : undefined;
  if (str && allowed.includes(str)) {
    return str;
  }
  return fallback;
};

export const normalizeReplicatePrediction = (prediction, overrides = {}) => {
  if (!prediction || typeof prediction !== "object") {
    throw new ReplicateValidationError("Invalid prediction payload received from Replicate.");
  }

  const rawStatus = prediction.status ?? "queued";
  const normalizedStatus = statusMap[rawStatus] ?? rawStatus;

  const createdAt = prediction.created_at
    ? Math.floor(new Date(prediction.created_at).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  return {
    id: prediction.id,
    status: normalizedStatus,
    provider: "replicate",
    model: prediction.model ?? prediction.version ?? null,
    progress: normalizedStatus === "completed" ? 100 : 0,
    created_at: createdAt,
    error: prediction.error ?? null,
    raw_status: rawStatus,
    ...overrides,
  };
};

const buildInputPayload = (config, { prompt, seconds, size, inputReference }) => {
  const duration = coerceSeconds(seconds, config.secondsOptions, config.defaultSeconds);
  const resolution = coerceResolution(size, config.resolutionOptions, config.defaultResolution);

  const input = {
    prompt,
    duration: Number(duration),
    resolution,
  };

  if (config.aspectRatio) {
    input.aspect_ratio = config.aspectRatio;
  }

  if (inputReference && config.supportsImageReference) {
    input.image = inputReference;
  }

  return input;
};

export const createReplicateVideoJob = async ({
  model,
  prompt,
  seconds,
  size,
  inputReference,
}) => {
  const config = REPLICATE_VIDEO_MODELS[model];
  if (!config) {
    throw new ReplicateValidationError(`Unsupported Replicate model "${model}".`);
  }
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    throw new ReplicateValidationError("Prompt is required for Replicate generation.");
  }

  const client = getReplicateClient();
  const inputPayload = buildInputPayload(config, {
    prompt: prompt.trim(),
    seconds,
    size,
    inputReference,
  });

  const prediction = await client.predictions.create({
    model,
    input: inputPayload,
  });

  return normalizeReplicatePrediction(prediction, {
    seconds: String(inputPayload.duration),
    size: inputPayload.resolution,
  });
};

export const getReplicateVideoJob = async (id) => {
  if (!id) {
    throw new ReplicateValidationError("Prediction id is required.");
  }
  const client = getReplicateClient();
  const prediction = await client.predictions.get(id);
  const overrides = {};
  if (prediction?.input?.duration != null) {
    overrides.seconds = String(prediction.input.duration);
  }
  if (prediction?.input?.resolution) {
    overrides.size = prediction.input.resolution;
  }
  return {
    prediction,
    normalized: normalizeReplicatePrediction(prediction, overrides),
  };
};

const extractOutputUrl = (prediction) => {
  const { output } = prediction ?? {};
  if (!output) {
    return null;
  }

  const inspectItem = (item) => {
    if (!item) {
      return null;
    }
    if (typeof item === "string") {
      return item;
    }
    if (typeof item === "object") {
      if (typeof item.url === "string") {
        return item.url;
      }
      if (typeof item.uri === "string") {
        return item.uri;
      }
      if (typeof item.href === "string") {
        return item.href;
      }
    }
    return null;
  };

  if (Array.isArray(output)) {
    for (const item of output) {
      const candidate = inspectItem(item);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  return inspectItem(output);
};

export const downloadReplicateVideoContent = async (id) => {
  const { prediction, normalized } = await getReplicateVideoJob(id);

  if (normalized.status !== "completed") {
    return { ready: false, normalized };
  }

  const fileUrl = extractOutputUrl(prediction);
  if (!fileUrl) {
    throw new ReplicateValidationError("Prediction completed but no downloadable output was provided.");
  }

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download Replicate output. Status: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    ready: true,
    normalized,
    buffer,
    contentType: response.headers.get("content-type") ?? "video/mp4",
    contentLength: response.headers.get("content-length"),
    contentDisposition: response.headers.get("content-disposition"),
  };
};

export const replicateModelDefaults = (model) => {
  const config = REPLICATE_VIDEO_MODELS[model];
  if (!config) {
    return null;
  }
  return {
    seconds: config.defaultSeconds,
    size: config.defaultResolution,
  };
};
