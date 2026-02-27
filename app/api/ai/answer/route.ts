import { NextResponse } from "next/server";
import OpenAI from "openai";

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

    const client = new OpenAI({ apiKey });

    const completion = await client.chat.completions.create({
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
    });

    const answer = completion.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ answer });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Falha" }, { status: 500 });
  }
}