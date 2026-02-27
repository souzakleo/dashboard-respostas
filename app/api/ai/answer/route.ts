import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt ?? "").trim();

    if (!prompt) {
      return NextResponse.json({ error: "prompt vazio" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY não configurada" }, { status: 500 });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Você é um atendente do Detran. Seja direto, correto e não invente informação. Se faltar dado, faça 1 pergunta objetiva.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };

    if (!response.ok) {
      return NextResponse.json({ error: payload?.error?.message ?? "Falha ao gerar resposta" }, { status: response.status });
    }

    const answer = payload.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ answer });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Falha";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
