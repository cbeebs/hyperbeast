export const config = { runtime: 'edge' };

export default async function handler(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return new Response(JSON.stringify({
    ok: true,
    method: req.method,
    hasApiKey: !!apiKey,
    keyPrefix: apiKey ? apiKey.slice(0, 14) + '...' : null,
    ts: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
