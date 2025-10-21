import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  getReplicateVideoJob,
  ReplicateConfigurationError,
  ReplicateValidationError,
} from "../../../../lib/providers/replicate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Server is missing OPENAI_API_KEY configuration.");
  }
  return new OpenAI({ apiKey });
};

const normalizeProvider = (request) => {
  const providerParam = request.nextUrl.searchParams.get("provider");
  if (providerParam && providerParam.toLowerCase() === "replicate") {
    return "replicate";
  }
  return "openai";
};

export async function GET(request, { params }) {
  const { id } = params ?? {};

  if (!id) {
    return NextResponse.json({ error: "Video id is required." }, { status: 400 });
  }

  const provider = normalizeProvider(request);

  if (provider === "replicate") {
    try {
      const { normalized } = await getReplicateVideoJob(id);
      return NextResponse.json(normalized);
    } catch (error) {
      const status =
        error instanceof ReplicateValidationError ? 400 :
        error instanceof ReplicateConfigurationError ? 500 :
        error?.status ?? 500;
      const message =
        error?.message ??
        "Failed to retrieve Replicate prediction.";
      return NextResponse.json({ error: message }, { status });
    }
  }

  let client;
  try {
    client = getClient();
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const job = await client.videos.retrieve(id);
    return NextResponse.json({
      ...job,
      provider: "openai",
    });
  } catch (error) {
    const status = error?.status ?? 500;
    const message =
      error?.response?.data?.error?.message ??
      error?.error?.message ??
      error?.message ??
      "Failed to retrieve video status.";
    return NextResponse.json({ error: message }, { status });
  }
}
