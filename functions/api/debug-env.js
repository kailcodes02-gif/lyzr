// Temporary environment variable diagnostic helper
export async function onRequestGet(context) {
  const { env } = context;
  const keys = Object.keys(env);
  const details = {};
  for (const key of keys) {
    details[key] = {
      defined: !!env[key],
      length: env[key] ? String(env[key]).length : 0
    };
  }
  return new Response(JSON.stringify({
    success: true,
    available_keys: keys,
    details
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
