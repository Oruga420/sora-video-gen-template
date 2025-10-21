import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  createReplicateVideoJob,
  ReplicateConfigurationError,
  ReplicateValidationError,
} from "../../../lib/providers/replicate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_DEFAULT_MODEL = "sora-2";
const OPENAI_ALLOWED_MODELS = new Set(["sora-2", "sora-2-pro"]);
const OPENAI_ALLOWED_SECONDS = ["4", "8", "12"];
const OPENAI_DEFAULT_SECONDS = "8";
const OPENAI_DEFAULT_SIZE = "1280x720";
const REPLICATE_DEFAULT_MODEL = "bytedance/seedance-1-pro";

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Server is missing OPENAI_API_KEY configuration.");
  }
  return new OpenAI({ apiKey });
};

const normalizeProvider = (value) => {
  if (typeof value !== "string") {
    return "openai";
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed === "replicate" ? "replicate" : "openai";
};

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const {
    prompt,
    model,
    size = OPENAI_DEFAULT_SIZE,
    seconds = OPENAI_DEFAULT_SECONDS,
    remix_video_id,
    input_reference,
    provider: requestedProvider,
  } = payload ?? {};

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const provider = normalizeProvider(requestedProvider);
  const trimmedPrompt = prompt.trim();
  const trimmedInputReference =
    typeof input_reference === "string" ? input_reference.trim() : input_reference;

  if (provider === "replicate") {
    const replicateModel =
      typeof model === "string" && model.trim() ? model.trim() : REPLICATE_DEFAULT_MODEL;
    try {
      const job = await createReplicateVideoJob({
        model: replicateModel,
        prompt: trimmedPrompt,
        seconds,
        size,
        inputReference: trimmedInputReference || undefined,
      });
      return NextResponse.json(job, { status: 202 });
    } catch (error) {
      const status =
        error instanceof ReplicateValidationError ? 400 :
        error instanceof ReplicateConfigurationError ? 500 :
        error?.status ?? 500;
      const message = error?.message ?? "Failed to start video generation.";
      return NextResponse.json({ error: message }, { status });
    }
  }

  let client;
  try {
    client = getClient();
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const normalizedSeconds =
    seconds != null ? String(seconds) : OPENAI_DEFAULT_SECONDS;
  const normalizedSize = size != null ? String(size) : OPENAI_DEFAULT_SIZE;
  const normalizedModel =
    typeof model === "string" && model.trim() ? model.trim() : OPENAI_DEFAULT_MODEL;

  if (!OPENAI_ALLOWED_MODELS.has(normalizedModel)) {
    return NextResponse.json(
      {
        error: `Invalid model value. Allowed options: ${Array.from(OPENAI_ALLOWED_MODELS).join(", ")}.`,
      },
      { status: 400 }
    );
  }

  if (!OPENAI_ALLOWED_SECONDS.includes(normalizedSeconds)) {
    return NextResponse.json(
      {
        error: `Invalid seconds value. Allowed options: ${OPENAI_ALLOWED_SECONDS.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  const requestBody = {
    model: normalizedModel,
    prompt: trimmedPrompt,
    size: normalizedSize,
    seconds: normalizedSeconds,
  };

  const trimmedRemixId =
    typeof remix_video_id === "string" ? remix_video_id.trim() : remix_video_id;
  if (trimmedRemixId) {
    requestBody.remix_video_id = trimmedRemixId;
  }

  if (trimmedInputReference) {
    requestBody.input_reference = trimmedInputReference;
  }

  try {
    const job = await client.videos.create(requestBody);
    return NextResponse.json(
      {
        ...job,
        provider: "openai",
      },
      { status: 202 }
    );
  } catch (error) {
    const status = error?.status ?? 500;
    const message =
      error?.response?.data?.error?.message ??
      error?.error?.message ??
      error?.message ??
      "Failed to start video generation.";
    return NextResponse.json({ error: message }, { status });
  }
}
