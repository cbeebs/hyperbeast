export const config = { runtime: 'edge' };

function getNextMonday(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDay();
  const daysUntil = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  d.setUTCDate(d.getUTCDate() + daysUntil);
  return d.toISOString().slice(0, 10);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'Server not configured' }, 500);

  let intake;
  try {
    const body = await req.json();
    intake = body?.intake;
    if (!intake) throw new Error('missing intake');
  } catch (e) {
    return json({ error: 'Bad request: ' + e.message }, 400);
  }

  const today = new Date().toISOString().slice(0, 10);
  const startDate = getNextMonday(today);
  const raceDate = intake.event?.raceDate || intake.event?.date || '';
  const athleteName = intake.about?.name || 'Athlete';
  const eventName = intake.event?.eventName || intake.event?.name || 'Race';

  async function callClaude(prompt, maxTokens, label) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000); // 22s hard limit
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
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
      clearTimeout(timeout);
      if (!r.ok) throw new Error(label + ' API ' + r.status + ': ' + (await r.text()).slice(0, 200));
      const d = await r.json();
      const text = (d.content?.[0]?.text || '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(label + ': no JSON in response');
      return JSON.parse(match[0]);
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error(label + ' timed out after 22s');
      throw e;
    }
  }

  const SCHEDULE_PROMPT = `Elite endurance coach. Generate a training plan schedule.

Event: ${eventName}, Race date: ${raceDate}
Athlete: age ${intake.about?.age||'?'}, fitness ${intake.about?.fitnessLevel||'?'}, history ${intake.about?.trainingHistory||'?'}
Weekly volume: ${intake.training?.weeklyHours||'?'}, unavailable days: ${JSON.stringify(intake.lifestyle?.unavailable||[])}
Goal: ${intake.event?.primaryGoal||'finish'}

Start: ${startDate}  Race: ${raceDate}

Return ONLY valid JSON (no markdown):
{"meta":{"athleteName":"${athleteName}","planName":"string","raceName":"${eventName}","raceDate":"${raceDate}","startDate":"${startDate}","weekCount":0,"totalSessions":0},"weeks":[{"n":1,"name":"FOUNDATION","phase":"P1","phaseFull":"string","creed":"string","days":[{"dow":0,"t":"EASY","ti":"string","km":10,"z":"Z2","tag":"string","dt":"string"}]}]}

Rules: dow 0=Mon…6=Sun. t: EASY LONG HILLS TEMPO B2B PACK STRENGTH SHAKEDOWN SAND RACE TRAVEL TEST. km null for STRENGTH/TRAVEL. ALL weeks ${startDate}→${raceDate}. Recovery week every 4th. Taper 2wks. Return ONLY JSON.`;

  const SECTIONS_PROMPT = `Elite endurance coach. Four app content sections for: ${eventName}, goal: ${intake.event?.primaryGoal||'finish'}, athlete: ${intake.about?.age||'?'}yo ${intake.about?.fitnessLevel||'?'} fitness, diet: ${JSON.stringify(intake.nutrition?.dietType||[])}.

Return ONLY valid JSON (no markdown):
{"strategy":[{"title":"string","body":"string","accent":false}],"strength":[{"title":"string","body":"string","accent":false}],"fuel":[{"title":"string","body":"string","accent":false}],"race":[{"title":"string","body":"string","accent":false}]}

3-4 blocks each. accent:true for one key block per section. body uses \\n. Be specific to this event. Return ONLY JSON.`;

  try {
    // Sequential to avoid parallel timeout issues in edge runtime
    const schedule = await callClaude(SCHEDULE_PROMPT, 10000, 'schedule');
    const sections = await callClaude(SECTIONS_PROMPT, 4000, 'sections');

    if (!schedule.meta?.totalSessions && schedule.weeks) {
      schedule.meta.totalSessions = schedule.weeks.reduce((s, w) => s + (w.days?.length || 0), 0);
    }

    return json({ meta: schedule.meta, weeks: schedule.weeks || [], sections });
  } catch (e) {
    return json({ error: 'Generation failed: ' + e.message }, 500);
  }
}
