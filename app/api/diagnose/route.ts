import { diagnose, type ChatTurn } from "@/lib/server/ai";

export const maxDuration = 40;

export async function POST(req: Request) {
  // Only this app's own pages may spend the AI quota
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return Response.json({ error: "Not allowed." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null;
  const turns = (Array.isArray(body?.messages) ? body!.messages : [])
    .map((m) => m as Partial<ChatTurn>)
    .filter((m): m is ChatTurn => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }))
    .slice(-10);
  if (!turns.some((t) => t.role === "user")) return Response.json({ error: "Tulis keluhanmu dulu." }, { status: 400 });

  return Response.json(await diagnose(turns));
}
