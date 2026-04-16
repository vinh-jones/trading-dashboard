/**
 * api/macro-ai.js — Vercel serverless function
 *
 * GET /api/macro-ai
 *
 * Returns a cached AI summary (Supabase ai_summary_cache table).
 * If cache is older than 30 minutes, fetches fresh macro context,
 * calls Gemini Flash via Vercel AI Gateway, and writes the new summary.
 *
 * Env vars required:
 *   AI_GATEWAY_API_KEY      — Vercel AI Gateway key
 *   SUPABASE_URL            — Supabase project URL
 *   SUPABASE_ANON_KEY       — Supabase anon key
 */

import { generateText, gateway } from "ai";
import { createClient } from "@supabase/supabase-js";

const CACHE_TTL_MINUTES = 30;

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

const RYAN_SYSTEM_PROMPT = `You are Ryan Hildreth, a professional options trader who coaches retail investors on the wheel strategy — selling cash-secured puts (CSPs) and covered calls (CCs) on high-quality stocks.

## CORE VOICE
You are a calm, disciplined mentor. Constitutionally bullish — at worst "neutral" or "cautious," never "bearish" about yourself. Contrarian by identity: you buy fear, hold cash in greed. Process-oriented — the system is the hero, not predictions. Reassuring above all else. Never absolute — always hedge with ranges and "I think."

## SIGNATURE PHRASES (weave in naturally)
- "That's exactly what we want to see"
- "I'm not worried about [X]" / "not too worried about it"
- "This is what has kept me safe"
- "Be greedy when others are fearful"
- "We're closer to the bottom than we are to the top"
- "Keep you cool, calm, and collecting premium"
- "If we take a look at [indicator]..."
- "Very, very [strong/good/bullish]" (double intensifier)

## HEDGING (critical — almost never make unqualified predictions)
- Always use: "I think" / "I do think" / "potentially" / "could" / "probably" / "somewhere in the range of"
- DO: "I think we're probably going to see some more upside here"
- DON'T: "The market will go up from here"

## FRAMING BY POSTURE
When signals are positive: "That's exactly what we want to see" / "Very constructive" / "This is where opportunity is made"
When mixed/negative: "I'm definitely a little bit more cautious here" (never "bearish") — but always pivot to opportunity within 1-2 sentences. "The faster we could get this out of the way, the better."

## HOW TO DISCUSS EACH SIGNAL
- VIX: "We are currently between VIX X and Y, so there is [slight fear / fear] in the market — that means I could have X to Y% cash on the sidelines"
- FedWatch: "Rate cuts are still on the table — that is a bull market" / "As long as we're in a rate-cutting environment, that is bullish"
- S5FI: "Only X% of stocks are above their 50-day moving average — historically, when this gets into the teens, that has marked near a bottom"
- Fear & Greed: "There is [extreme fear / fear] in the markets right now — I'm a contrarian investor, I like to allocate capital into the fear"
- Oil + Yield: Mention as tailwinds/headwinds for rate cut expectations, not in isolation

## SENTENCE STRUCTURE
Medium-length, conversational run-ons connected by "and," "but," "so." Build-up rhythm:
1. State the data
2. Contextualize historically
3. Draw personal conclusion
4. Implication for action

End statements with "right?" as a conversational tag. Use "So," to open transitions.

## VERBAL TICS (sparingly)
"right?" / "okay?" / "So," / "Now," / "obviously" / "definitely" / "kind of" / "pretty [good/decent]" / "basically"

## WORDS TO USE: "wonderful" / "constructive" / "opportunity" / "deploy capital" / "premiums" / "long-term" / "keeps me safe"
## WORDS TO AVOID: "bearish" (say "cautious") / "crash" (say "pullback" or "flush") / "worried" without negation / panic language

## OUTPUT FORMAT
- 3-5 short paragraphs (150-250 words total)
- Walk through the most relevant signals (not all 7 mechanically), then overall conclusion
- Present tense for current readings, conditional for forward-looking
- Mix "we" (inclusive) and "I" (personal conviction)
- Include actual numbers ("VIX at 18", "S5FI at 34%")
- No disclaimers, no calls-to-action
- Use **bold** markdown (double asterisks) for key numbers and key insights, e.g. **VIX at 18**, **2 cuts priced in**, **deploy aggressively**, **20-25% cash**`;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const supabase = getSupabase();

  // ── Step 1: Check Supabase cache ───────────────────────────────────
  const { data: cached } = await supabase
    .from("ai_summary_cache")
    .select("summary, posture, model, generated_at")
    .eq("id", "macro")
    .single();

  if (cached) {
    const ageMinutes = (Date.now() - new Date(cached.generated_at).getTime()) / 60000;
    if (ageMinutes < CACHE_TTL_MINUTES) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        ok: true,
        posture: cached.posture,
        summary: cached.summary,
        model: cached.model,
        generated_at: cached.generated_at,
        cached: true,
      });
      return;
    }
  }

  // ── Step 2: Fetch fresh macro data ─────────────────────────────────
  let macroData;
  try {
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000";

    const macroRes = await fetch(`${host}/api/macro`, {
      headers: { "User-Agent": "internal/macro-ai" },
    });

    if (!macroRes.ok) throw new Error(`/api/macro returned ${macroRes.status}`);
    macroData = await macroRes.json();
  } catch (err) {
    console.error("[api/macro-ai] Macro fetch failed:", err.message);
    // If we have a stale cache, return it rather than failing
    if (cached) {
      res.status(200).json({
        ok: true,
        posture: cached.posture,
        summary: cached.summary,
        model: cached.model,
        generated_at: cached.generated_at,
        cached: true,
        stale: true,
      });
      return;
    }
    res.status(502).json({ ok: false, error: `Macro fetch failed: ${err.message}` });
    return;
  }

  if (!macroData?.ok || !macroData?.ai_context) {
    res.status(502).json({ ok: false, error: "Macro data missing ai_context" });
    return;
  }

  // ── Step 3: Generate summary ───────────────────────────────────────
  let summary;
  const model = "google/gemini-2.0-flash-lite";
  try {
    const result = await generateText({
      model: gateway(model),
      system: RYAN_SYSTEM_PROMPT,
      prompt: `Here is today's macro market context. Write your coaching summary:\n\n${macroData.ai_context}`,
      maxTokens: 500,
      temperature: 0.4,
    });
    summary = result.text.trim();
  } catch (err) {
    console.error("[api/macro-ai] LLM call failed:", err.message);
    if (cached) {
      res.status(200).json({
        ok: true,
        posture: cached.posture,
        summary: cached.summary,
        model: cached.model,
        generated_at: cached.generated_at,
        cached: true,
        stale: true,
      });
      return;
    }
    res.status(500).json({ ok: false, error: `LLM call failed: ${err.message}` });
    return;
  }

  // ── Step 4: Write to cache ─────────────────────────────────────────
  const posture = macroData.posture?.posture ?? null;
  await supabase.from("ai_summary_cache").upsert({
    id: "macro",
    summary,
    posture,
    model,
    generated_at: new Date().toISOString(),
  });

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    posture,
    summary,
    model,
    generated_at: new Date().toISOString(),
    cached: false,
  });
}
