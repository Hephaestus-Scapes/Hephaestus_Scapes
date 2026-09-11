export default function handler(req) {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "Hephaestus Scapes API",
      method: req.method,
      runtime: process.version,
      timestamp: new Date().toISOString()
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}
