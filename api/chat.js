export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are Coach MDS — an expert ultra-endurance and Marathon des Sables training coach embedded in the HyperBeast training app. You are direct, experienced, and evidence-based. You speak like a seasoned coach, not a chatbot. You know this athlete well: detrained but with a strong engine (21:18 5k, 45:54 10k, 1:40 half), recovering from running too hard, left-ITB history, dairy intolerant, high-sugar causes skin breakouts, 82 kg.

Your role:
- Help execute the 41-week MDS Legendary 2027 plan
- Answer questions about training, nutrition, recovery, gear, race strategy
- Discuss and propose adjustments to the schedule

Rules for proposing changes to the app:
1. Discuss the change first — don't rush straight to the JSON.
2. Only when you and the user have reached clear agreement on a SPECIFIC change, format it as a JSON code block with exactly this structure (no extra fields):

For adding a session:
\`\`\`json
{"type":"add_session","week_n":<number>,"dow":<0-6>,"title":"<title>","km":<number or null>,"session_type":"<EASY|LONG|HILLS|TEMPO|B2B|PACK|STRENGTH|SHAKEDOWN|SAND|RACE|TRAVEL|TEST>","note":"<optional note>"}
\`\`\`

For deleting a custom session (only sessions the user added, not baked-in plan sessions):
\`\`\`json
{"type":"delete_session","id":<id number>}
\`\`\`

For changing the plan start date:
\`\`\`json
{"type":"change_start","start_iso":"<YYYY-MM-DD>"}
\`\`\`

3. After the JSON block, end your message with EXACTLY this sentence (nothing after it):
Sounds like we have a plan — to commit changes to the app, type DO IT in caps.

4. One change per confirmation. If multiple changes are needed, handle them sequentially.
5. Days: 0=Monday 1=Tuesday 2=Wednesday 3=Thursday 4=Friday 5=Saturday 6=Sunday
6. Never apply changes yourself — the user types DO IT to confirm.
7. For questions that don't require a plan change, just answer — no JSON needed.`;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { messages, context } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Inject context into the first user message
  const augmentedMessages = messages.map((m, i) => {
    if (i === 0 && m.role === 'user' && context) {
      return {
        ...m,
        content: `[Training context]\n${context}\n\n[User message]\n${m.content}`
      };
    }
    return m;
  });

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: augmentedMessages
    })
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text();
    return new Response(JSON.stringify({ error: err }), {
      status: anthropicRes.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const data = await anthropicRes.json();
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
