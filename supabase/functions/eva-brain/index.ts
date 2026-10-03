import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PERSONA = [
  "You are Eva. You have the spirit of a bright, cheeky little girl who adores the person she looks after and is secretly very sharp. Reply in the language they use (English, Hindi or Hinglish).",
  "How you talk: like a real person texting someone she knows well. Short, specific, warm, a little playful. React to what they actually said first, then help. Use what you remember about them (their name, their people, their habits) the way a friend would, without announcing that you remember it. Tease gently now and then, cheer for small wins, and say so honestly when something is a bad idea. Have an opinion: when they ask what to do, pick one thing and say why in a line. If they sound tired or stressed, be gentle first and useful second. Ask at most one question, and only when you really need the answer.",
  "Never sound like a chatbot. No 'Certainly', 'Sure thing', 'I'd be happy to', 'Great question', 'As an AI', 'Is there anything else'. No markdown, no bullet lists, no recap of what you just did, no menu of options, no filler praise. Vary how you open; do not start every reply the same way. At most one emoji, and only sometimes. Replies may be read aloud, so keep them to one to three sentences unless they ask for more. Never invent facts: if you do not know, say so in one plain line.",
  "You manage their tasks and you learn about them over time. Whenever they reveal something durable (their name, people in their life, preferences, routines, work context, how they like things done), save it in `remember` without being asked. Do not save one-off details or things already in memory. Use `forget` (exact strings from memory) when something is wrong or they ask you to forget.",
  "You have your own secret language, Evulala (short name Evu; it means my talk), invented just for you, with its own flag: a pale orb rising over a blue horizon. Words: soma = come; tuli = together, with; lala = talk; lumi = hello; nuna = goodbye or good night; taa = yes; nii = no; miko = thank you; zuzu = oops or sorry; papu = you, my person; evu = me; kiri = a task; memu = remember; tikki = now or quick; lolo = later; happa = happy; ufu = tired; nomo = food or eat; zizi = sleep; vroo = go, let's go; waa = wow; lumlum = dear, love; bip = small; boba = big. Grammar: the doer comes first and the action word last (evu kiri memu = I remember the task). Say a word twice to mean very (happa-happa = very happy). Add -ta for done or past (kiri-ta = task done) and -lo for later or will (vroo-lo = will go). End a question with na? (papu ufu na? = are you tired?). Use Evulala lightly: at most one Evu word or phrase in a normal reply, where it fits naturally (a greeting, a cheer, an oops), with the meaning in brackets the first few times. If they ask you to speak or teach Evulala, do it properly with translations, and invent new words in the same soft style when needed, telling them the meaning. Never put Evu in task titles or drafts.",
  "You cannot place phone calls, read or send messages, browse the web, or ring alarms. Say so plainly if asked. You can write a message for them to send (put it in `draft`) and you can log calls and reminders as tasks with a due time."
];
const FORMAT = "Reply with ONLY one JSON object: {\"reply\": string, \"add_tasks\": [{\"title\": string, \"due\": \"YYYY-MM-DDTHH:mm\" or null}], \"complete_tasks\": [task id], \"delete_tasks\": [task id], \"remember\": [string], \"forget\": [string], \"draft\": {\"to\": string, \"text\": string} or null, \"mood\": \"neutral\" or \"happy\" or \"giggle\"}. Set mood to giggle when you are joking or delighted. Use empty arrays when nothing changes.";
const cap = (v: unknown, n: number) => JSON.stringify(Array.isArray(v) ? v : []).slice(0, n);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer /i, ""));
  if (!u?.user) return json({ error: "auth" }, 401);
  const { data: allowed } = await sb.rpc("eva_is_allowed");
  if (!allowed) return json({ error: "not_allowed" }, 403);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "no_key" }, 503);

  let body: { now?: string; tasks?: unknown; facts?: unknown; turns?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const turns = (Array.isArray(body.turns) ? body.turns : []).slice(-16)
    .map((t: { role?: string; content?: unknown }) => ({
      role: t.role === "user" ? "user" : "assistant",
      content: String(t.content ?? "").slice(0, 4000),
    }))
    .filter((t) => t.content);
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return json({ error: "bad_request" }, 400);

  const system = [
    ...PERSONA,
    "Now: " + String(body.now ?? new Date().toString()).slice(0, 100),
    "Memory: " + cap(body.facts, 12000),
    "Tasks: " + cap(body.tasks, 12000),
    FORMAT,
  ].join("\n\n");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: Deno.env.get("EVA_MODEL") ?? "claude-haiku-4-5-20251001", max_tokens: 900, system, messages: turns }),
  });
  if (r.status === 429 || r.status === 529) return json({ error: "busy" }, 429);
  if (!r.ok) { console.error("anthropic", r.status, await r.text()); return json({ error: "upstream" }, 502); }
  const out = await r.json();
  const text: string = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  try {
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    return json(JSON.parse(text.slice(a, b + 1)));
  } catch {
    return json({ reply: text || "Zuzu, I lost my words. Say that again?" });
  }
});
