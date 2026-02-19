import { NextRequest, NextResponse } from "next/server";
import { getWordCache, putWordCache } from "@/lib/dynamo";
import { queryDictionary } from "@/lib/dictionary";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const word = request.nextUrl.searchParams.get("word")?.trim();
  if (!word) {
    return NextResponse.json({ error: "word is required" }, { status: 400 });
  }

  const cached = await getWordCache(word);
  if (cached) return NextResponse.json(cached);

  const data = await queryDictionary(word);
  await putWordCache(word, data);
  return NextResponse.json(data);
}
