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

export async function GET(_request, { params }) {
  let client;
  try {
    client = getClient();
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { id } = params ?? {};

  if (!id) {
    return NextResponse.json({ error: "Video id is required." }, { status: 400 });
  }

  try {
    const job = await client.videos.retrieve(id);
    return NextResponse.json(job);
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
