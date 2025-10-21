import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  downloadReplicateVideoContent,
  ReplicateConfigurationError,
  ReplicateValidationError,
} from "../../../../../lib/providers/replicate";

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
      const result = await downloadReplicateVideoContent(id);
      if (!result.ready) {
        return NextResponse.json(
          { error: "Prediction output is not ready yet." },
          { status: 404 }
        );
      }

      const headers = new Headers();
      headers.set("Content-Type", result.contentType);
      headers.set("Content-Length", String(result.contentLength ?? result.buffer.length));
      headers.set(
        "Content-Disposition",
        result.contentDisposition ?? `attachment; filename=${id}.mp4`
      );

      return new NextResponse(result.buffer, { headers });
    } catch (error) {
      const status =
        error instanceof ReplicateValidationError ? 400 :
        error instanceof ReplicateConfigurationError ? 500 :
        error?.status ?? 500;
      const message = error?.message ?? "Failed to download Replicate output.";
      return NextResponse.json({ error: message }, { status });
    }
  }

  let client;
  try {
    client = getClient();
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const variant = request.nextUrl.searchParams.get("variant") ?? "video";

  try {
    const content = await client.videos.downloadContent(id, { variant });
    const contentType = content.headers.get("content-type") ?? "video/mp4";
    const contentLength = content.headers.get("content-length");
    const contentDisposition = content.headers.get("content-disposition");

    const arrayBuffer = await content.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }
    if (contentDisposition) {
      headers.set("Content-Disposition", contentDisposition);
    }

    return new NextResponse(buffer, { headers });
  } catch (error) {
    const status = error?.status ?? 500;
    const message =
      error?.response?.data?.error?.message ??
      error?.error?.message ??
      error?.message ??
      "Failed to download video content.";
    return NextResponse.json({ error: message }, { status });
  }
}
