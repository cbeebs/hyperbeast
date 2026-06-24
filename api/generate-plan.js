export const config = { runtime: 'edge' };

function getNextMonday(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDay();
  const daysUntil = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  d.setUTCDate(d.getUTCDate() + daysUntil);
  return d.toISOString().slice(0, 10);
}

function errorResp(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return errorResp('Method not allowed', 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return errorResp('Server not configured');

  let intake;
  try {
    const body = await req.json();
    intake = body?.intake;
    if (!intake) throw new Error('missing intake');
  } catch (e) {
    return errorResp('Bad request: ' + e.message, 400);
  }

  const today = new Date().toISOString().slice(0, 10);
  const startDate = getNextMonday(today);
  const raceDate = intake.event?.raceDate || intake.event?.date || '';
  const athleteName = intake.about?.name || 'Athlete';
  const eventName = intake.event?.eventName || intake.event?.name || 'Race';

  const prompt = `Elite endurance coach. Generate a complete training plan.

Event: ${eventName}, Race date: ${raceDate}
Athlete: ${athleteName}, age ${intake.about?.age || '?'}, fitness ${intake.about?.fitnessLevel || '?'}, history ${intake.about?.trainingHistory || '?'}
Weekly volume: ${intake.training?.weeklyHours || '?'}hrs, unavailable days: ${JSON.stringify(intake.lifestyle?.unavailable || [])}
Goal: ${intake.event?.primaryGoal || 'finish'}, diet: ${JSON.stringify(intake.nutrition?.dietType || [])}
Plan starts: ${startDate}, Race day: ${raceDate}

Return ONLY a single valid JSON object (no markdown, no explanation):
{"meta":{"athleteName":"${athleteName}","planName":"string","raceName":"${eventName}","raceDate":"${raceDate}","startDate":"${startDate}","weekCount":0,"totalSessions":0},"weeks":[{"n":1,"name":"FOUNDATION","phase":"P1","phaseFull":"string","creed":"string","days":[{"dow":0,"t":"EASY","ti":"string","km":10,"z":"Z2","tag":"string","dt":"string"}]}],"sections":{"strategy":[{"title":"string","body":"string","accent":false}],"strength":[{"title":"string","body":"string","accent":false}],"fuel":[{"title":"string","body":"string","accent":false}],"race":[{"title":"string","body":"string","accent":false}]}}

Rules:
- dow: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun
- t values: EASY LONG HILLS TEMPO B2B PACK STRENGTH SHAKEDOWN SAND RACE TRAVEL TEST
- km: null for STRENGTH and TRAVEL sessions only
- Generate ALL weeks from ${startDate} through ${raceDate} — no gaps
- Every 4th week is a recovery week (20-30% volume reduction)
- Final 2 weeks are taper (reduced intensity and volume)
- sections: 3-4 blocks per section, accent:true on exactly one block per section
- body uses \\n for line breaks
- Return ONLY the JSON object, nothing before or after`;

  const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      stream: true,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!anthropicResp.ok) {
    const errText = await anthropicResp.text();
    return errorResp('Anthropic error ' + anthropicResp.status + ': ' + errText.slice(0, 300));
  }

  // Stream SSE events from Anthropic, extract text deltas, forward as plain text.
  // Returning a streaming Response satisfies Vercel's 25s start deadline;
  // the stream itself can run as long as needed.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  (async () => {
    let buf = '';
    const reader = anthropicResp.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data);
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              await writer.write(enc.encode(evt.delta.text));
            }
          } catch { /* skip malformed SSE event */ }
        }
      }
    } catch (e) {
      try {
        await writer.write(enc.encode('\n{"__error":"' + String(e.message).replace(/"/g, "'") + '"}'));
      } catch { /* writer may already be closed */ }
    } finally {
      try { await writer.close(); } catch { /* ignore */ }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
