import { NextRequest, NextResponse } from "next/server";
import { deleteCollection } from "@/lib/dynamo";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ word: string }> }
): Promise<NextResponse> {
  const username = request.headers.get("X-Username") || request.headers.get("x-username");
  if (!username) {
    return NextResponse.json({ error: "X-Username is required" }, { status: 400 });
  }

  const { word } = await context.params;
  await deleteCollection(username, word);
  return NextResponse.json({ ok: true });
}
