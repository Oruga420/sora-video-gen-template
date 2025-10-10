import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Server is missing OPENAI_API_KEY configuration.");
  }
  return new OpenAI({ apiKey });
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
    model = "sora-2",
    size = "1280x720",
    seconds = "8",
    remix_video_id,
    input_reference,
  } = payload ?? {};

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  let client;
  try {
    client = getClient();
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const allowedSeconds = ["4", "8", "12"];
  const normalizedSeconds = seconds != null ? String(seconds) : "8";
  const normalizedSize = size != null ? String(size) : "1280x720";

  if (!allowedSeconds.includes(normalizedSeconds)) {
    return NextResponse.json(
      {
        error: `Invalid seconds value. Allowed options: ${allowedSeconds.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  const requestBody = {
    model,
    prompt: prompt.trim(),
    size: normalizedSize,
    seconds: normalizedSeconds,
  };

  const trimmedRemixId =
    typeof remix_video_id === "string" ? remix_video_id.trim() : remix_video_id;
  if (trimmedRemixId) {
    requestBody.remix_video_id = trimmedRemixId;
  }

  const trimmedInputReference =
    typeof input_reference === "string" ? input_reference.trim() : input_reference;
  if (trimmedInputReference) {
    requestBody.input_reference = trimmedInputReference;
  }

  try {
    const job = await client.videos.create(requestBody);
    return NextResponse.json(job, { status: 202 });
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
