export const config = { runtime: 'edge' };

function getNextMonday(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDay();
  const daysUntil = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  d.setUTCDate(d.getUTCDate() + daysUntil);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  let intake;
  try {
    const body = await req.json();
    intake = body?.intake;
    if (!intake) throw new Error('missing intake');
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request: ' + e.message }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const startDate = getNextMonday(today);
  const raceDate = intake.event?.date || '';
  const athleteName = intake.about?.name || 'Athlete';

  const SCHEDULE_PROMPT = `You are an elite endurance coach. Generate a complete, personalised training plan.

ATHLETE INTAKE DATA:
${JSON.stringify(intake, null, 2)}

Plan start date (Monday Week 1): ${startDate}
Race date: ${raceDate}

Return ONLY valid JSON — no markdown, no explanation:
{
  "meta": {
    "athleteName": "${athleteName}",
    "planName": "string",
    "raceName": "${intake.event?.name || 'Race'}",
    "raceDate": "${raceDate}",
    "startDate": "${startDate}",
    "weekCount": 0,
    "totalSessions": 0
  },
  "weeks": [
    {
      "n": 1,
      "name": "FOUNDATION",
      "phase": "P1",
      "phaseFull": "Phase name",
      "creed": "Week motto",
      "days": [
        { "dow": 0, "t": "EASY", "ti": "Title", "km": 10, "z": "Z2", "tag": "tag", "dt": "Description" }
      ]
    }
  ]
}

Rules:
- dow: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun
- t: EASY LONG HILLS TEMPO B2B PACK STRENGTH SHAKEDOWN SAND RACE TRAVEL TEST
- km: null for STRENGTH/TRAVEL
- ALL weeks from ${startDate} to ${raceDate}, no gaps
- Unavailable days (skip): ${JSON.stringify(intake.lifestyle?.unavailable || [])}
- Recovery week every 4th, taper last 2-3
- Return ONLY valid JSON`;

  const SECTIONS_PROMPT = `You are an elite endurance coach. Write four training app content sections for this athlete.

INTAKE: ${JSON.stringify(intake)}

Return ONLY valid JSON:
{
  "strategy": [{"title":"string","body":"string","accent":false}],
  "strength": [{"title":"string","body":"string","accent":false}],
  "fuel":     [{"title":"string","body":"string","accent":false}],
  "race":     [{"title":"string","body":"string","accent":false}]
}

4-6 blocks per section. accent:true for one key block per section.
body: use \\n for line breaks. Be specific to this athlete's event and goals.
Return ONLY valid JSON`;

  async function callClaude(prompt, maxTokens) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!r.ok) throw new Error('Claude ' + r.status + ': ' + await r.text());
    const d = await r.json();
    const text = (d.content?.[0]?.text || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON. Got: ' + text.slice(0, 150));
    return JSON.parse(match[0]);
  }

  try {
    const [schedule, sections] = await Promise.all([
      callClaude(SCHEDULE_PROMPT, 12000),
      callClaude(SECTIONS_PROMPT, 6000)
    ]);

    if (!schedule.meta.totalSessions && schedule.weeks) {
      schedule.meta.totalSessions = schedule.weeks.reduce((s, w) => s + (w.days?.length || 0), 0);
    }

    return new Response(JSON.stringify({
      meta: schedule.meta,
      weeks: schedule.weeks || [],
      sections
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Generation failed: ' + e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
