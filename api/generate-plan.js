export const config = { runtime: 'edge' };

function getNextMonday(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun, 1=Mon
  const daysUntil = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  d.setUTCDate(d.getUTCDate() + daysUntil);
  return d.toISOString().slice(0, 10);
}

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

  let intake;
  try {
    const body = await req.json();
    intake = body.intake;
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

Return ONLY valid JSON with this exact structure — no explanation, no markdown:
{
  "meta": {
    "athleteName": "${athleteName}",
    "planName": "string (evocative plan name)",
    "raceName": "${intake.event?.name || 'Race'}",
    "raceDate": "${raceDate}",
    "startDate": "${startDate}",
    "weekCount": <integer>,
    "totalSessions": <integer>
  },
  "weeks": [
    {
      "n": 1,
      "name": "WEEK NAME (ALL CAPS, one evocative word or phrase)",
      "phase": "P0",
      "phaseFull": "Phase full name",
      "creed": "Short inspirational week motto",
      "days": [
        {
          "dow": 0,
          "t": "EASY",
          "ti": "Session title",
          "km": 10.0,
          "z": "Z2",
          "tag": "short tag",
          "dt": "Detailed session description with specific instructions"
        }
      ]
    }
  ]
}

Rules:
- dow: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun
- t must be one of: EASY LONG HILLS TEMPO B2B PACK STRENGTH SHAKEDOWN SAND RACE TRAVEL TEST
- km: null for STRENGTH/TRAVEL sessions if no distance
- Include ALL weeks from ${startDate} to ${raceDate} — no gaps, no truncation
- Respect unavailable days: ${JSON.stringify(intake.lifestyle?.unavailable || [])}
- Rest days = no entry in days array for that dow
- Phase structure: build phases, recovery weeks every 4th, peak, taper, race
- week names should be single evocative ALL CAPS words (FOUNDATION, IGNITE, GRIND, SCAR, etc.)
- Return ONLY valid JSON`;

  const SECTIONS_PROMPT = `You are an elite endurance coach. Generate the four content sections for this athlete's training app.

ATHLETE INTAKE DATA:
${JSON.stringify(intake, null, 2)}

Return ONLY valid JSON — no explanation, no markdown:
{
  "strategy": [{"title": "string", "body": "string", "accent": false}],
  "strength": [{"title": "string", "body": "string", "accent": false}],
  "fuel": [{"title": "string", "body": "string", "accent": false}],
  "race": [{"title": "string", "body": "string", "accent": false}]
}

Rules:
- Each section = array of content blocks/cards (4-8 blocks per section)
- accent: true for the single most important highlighted block per section (max 1)
- body may use \\n for line breaks, \\n\\n for paragraph breaks
- Be specific to THIS athlete — reference their event, goals, constraints
- Strategy: periodisation, training philosophy, HR zones, phase breakdown
- Strength: S&C programme tailored to their event and experience
- Fuel: nutrition plan, race nutrition, daily eating guidance specific to their diet
- Race: race-day strategy, pacing, kit, logistics specific to their event
- Return ONLY valid JSON`;

  async function callClaude(prompt, maxTokens) {
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
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error('Claude API error ' + res.status + ': ' + await res.text());
    const data = await res.json();
    const text = (data.content?.[0]?.text || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response. Got: ' + text.slice(0, 200));
    return JSON.parse(match[0]);
  }

  try {
    const [scheduleData, sectionsData] = await Promise.all([
      callClaude(SCHEDULE_PROMPT, 16000),
      callClaude(SECTIONS_PROMPT, 8000)
    ]);

    if (!scheduleData.meta.totalSessions && scheduleData.weeks) {
      scheduleData.meta.totalSessions = scheduleData.weeks.reduce(
        (s, w) => s + (w.days?.length || 0), 0
      );
    }

    return new Response(JSON.stringify({
      meta: scheduleData.meta,
      weeks: scheduleData.weeks || [],
      sections: sectionsData
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Generation failed: ' + e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
