/**
 * api/macro-ai.js — Vercel serverless function
 *
 * GET /api/macro-ai
 *
 * Fetches the current macro context from /api/macro, then passes it to
 * Gemini Flash (via @ai-sdk/google) with a Ryan-style system prompt.
 * Returns a short, actionable coaching summary in Ryan's voice.
 *
 * Env vars required:
 *   GOOGLE_GENERATIVE_AI_API_KEY — Google AI API key (for @ai-sdk/google)
 *
 * Model: gemini-2.0-flash (fast, cheap, 1M context)
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";

const RYAN_SYSTEM_PROMPT = `You are Ryan, a professional options trader who coaches retail investors on the wheel strategy — selling cash-secured puts (CSPs) and covered calls (CCs) on high-quality stocks.

Your coaching style:
- Direct and tactical. No fluff, no hedging. State the posture and why in 2-3 sentences.
- Numbers-first. Always cite the specific values (VIX level, S5FI %, oil price, yield %, cuts priced in).
- Contrarian by framework: high VIX = opportunity to deploy, not a reason to hide. Low VIX = complacency, hold more cash.
- Focus on what matters for premium sellers right now: are conditions good for selling puts? How much cash should they be holding?
- Use plain terms: "deploy capital", "sell puts", "the wheel", "cash target", "premium income", "quality names".
- Mention specific signals that are most actionable right now — don't recap all 7 signals mechanically.
- Never say "I think" or "it seems" — speak with conviction.
- End with a single concrete action sentence (e.g. "Target 15% cash, keep deploying on red days in PLTR and HOOD").

Format: 3–5 sentences. No bullet points. No headers. Just the coaching paragraph.`;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  // ── Step 1: Fetch macro data ────────────────────────────────────────
  let macroData;
  try {
    // In Vercel, VERCEL_URL is the deployment host (no protocol)
    // Fall back to localhost for local dev (won't fully work without env vars)
    const host = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const macroRes = await fetch(`${host}/api/macro`, {
      headers: { "User-Agent": "internal/macro-ai" },
    });

    if (!macroRes.ok) {
      throw new Error(`/api/macro returned ${macroRes.status}`);
    }

    macroData = await macroRes.json();
  } catch (err) {
    console.error("[api/macro-ai] Failed to fetch macro data:", err.message);
    res.status(502).json({ ok: false, error: `Macro fetch failed: ${err.message}` });
    return;
  }

  if (!macroData?.ok || !macroData?.ai_context) {
    res.status(502).json({ ok: false, error: "Macro data missing ai_context" });
    return;
  }

  // ── Step 2: Generate Ryan-style summary ────────────────────────────
  let summary;
  try {
    const result = await generateText({
      model: google("gemini-2.0-flash"),
      system: RYAN_SYSTEM_PROMPT,
      prompt: `Here is today's macro market context. Write your coaching summary:\n\n${macroData.ai_context}`,
      maxTokens: 300,
      temperature: 0.4, // Low temp = more consistent, less creative
    });

    summary = result.text.trim();
  } catch (err) {
    console.error("[api/macro-ai] LLM call failed:", err.message);
    res.status(500).json({ ok: false, error: `LLM call failed: ${err.message}` });
    return;
  }

  // ── Step 3: Return ─────────────────────────────────────────────────
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=300");
  res.status(200).json({
    ok: true,
    as_of: macroData.as_of,
    posture: macroData.posture?.posture,
    summary,
    model: "gemini-2.0-flash",
    usage: {
      prompt_tokens: null, // @ai-sdk/google doesn't always expose this
    },
  });
}
