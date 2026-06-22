export const config = { runtime: 'edge' };

function uint8ToBase64(bytes) {
  let binary = '';
  const CHUNK = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(binary);
}

const SCHEDULE_PROMPT = `You are extracting structured data from a marathon/ultra training plan PDF.

Extract:
1. Plan metadata (name, start date, race date, total weeks)
2. The complete weekly schedule with every session

Return ONLY valid JSON with this exact structure — no explanation, no markdown, just JSON:
{
  "meta": {
    "planName": "string",
    "startDate": "YYYY-MM-DD",
    "raceDate": "YYYY-MM-DD",
    "weekCount": 41,
    "totalSessions": 185
  },
  "weeks": [
    {
      "n": 1,
      "name": "WEEK NAME",
      "phase": "P0",
      "phaseFull": "Full phase name",
      "creed": "Week motto or theme",
      "days": [
        {
          "dow": 0,
          "t": "EASY",
          "ti": "Session title",
          "km": 10.0,
          "z": "Z2",
          "tag": "short tag",
          "dt": "Full session description"
        }
      ]
    }
  ]
}

Rules:
- dow: 0=Monday 1=Tuesday 2=Wednesday 3=Thursday 4=Friday 5=Saturday 6=Sunday
- t must be one of: EASY LONG HILLS TEMPO B2B PACK STRENGTH SHAKEDOWN SAND RACE TRAVEL TEST
- km: null for STRENGTH/TRAVEL/TEST sessions if no distance
- Include ALL weeks without truncation
- startDate: Monday of Week 1 in YYYY-MM-DD format`;

const SECTIONS_PROMPT = `From this training plan PDF, extract the key content for four sections.

Return ONLY valid JSON — no explanation, no markdown:
{
  "strategy": [{"title": "string", "body": "string", "accent": true}],
  "strength": [{"title": "string", "body": "string", "accent": false}],
  "fuel": [{"title": "string", "body": "string", "accent": false}],
  "race": [{"title": "string", "body": "string", "accent": false}]
}

Rules:
- Each array contains content blocks/cards from that section
- accent: true for the single most important/highlighted block per section
- body may use \\n for line breaks, \\n\\n for paragraph breaks
- Be thorough — extract all key information from the source document`;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  let pdfBase64;
  try {
    const formData = await req.formData();
    const file = formData.get('pdf');
    if (!file) {
      return new Response(JSON.stringify({ error: 'No PDF file provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    const buf = await file.arrayBuffer();
    pdfBase64 = uint8ToBase64(new Uint8Array(buf));
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to read PDF: ' + e.message }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const docBlock = {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
  };

  async function callClaude(textPrompt, maxTokens = 16000) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [docBlock, { type: 'text', text: textPrompt }]
        }]
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude returned no JSON. Raw: ' + text.slice(0, 300));
    return JSON.parse(match[0]);
  }

  try {
    // Run both extractions in parallel to save time
    const [scheduleData, sectionsData] = await Promise.all([
      callClaude(SCHEDULE_PROMPT, 16000),
      callClaude(SECTIONS_PROMPT, 8000)
    ]);

    // Compute totalSessions if not provided
    if (!scheduleData.meta.totalSessions && scheduleData.weeks) {
      scheduleData.meta.totalSessions = scheduleData.weeks.reduce((s, w) => s + (w.days?.length || 0), 0);
    }

    const result = {
      meta: scheduleData.meta,
      weeks: scheduleData.weeks || [],
      sections: sectionsData
    };

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Parse failed: ' + e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
