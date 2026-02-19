import { NextRequest, NextResponse } from "next/server";
import { listCollections, upsertCollections } from "@/lib/dynamo";

function requireUsername(req: NextRequest): string | null {
  return req.headers.get("X-Username") || req.headers.get("x-username");
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const username = requireUsername(request);
  if (!username) {
    return NextResponse.json({ error: "X-Username is required" }, { status: 400 });
  }
  const items = await listCollections(username);
  return NextResponse.json(items);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const username = requireUsername(request);
  if (!username) {
    return NextResponse.json({ error: "X-Username is required" }, { status: 400 });
  }

  const body = await request.json();
  const words = Array.isArray(body?.words) ? body.words : [];
  const synced = await upsertCollections(
    username,
    words.map((item: any) => ({
      username,
      word: String(item.word || "").toLowerCase(),
      data: item.data,
      collectedAt: Number(item.collectedAt || Date.now())
    }))
  );

  return NextResponse.json(synced);
}
