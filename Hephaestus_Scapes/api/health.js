export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({
    ok: true,
    service: "Hephaestus Scapes API",
    method: req.method,
    runtime: process.version,
    timestamp: new Date().toISOString()
  }));
}
