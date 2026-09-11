export function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}

export function text(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function readFormBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};

  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}
