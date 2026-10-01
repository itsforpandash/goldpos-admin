/**
 * Liveness probe.
 *
 * Deliberately touches NOTHING: no D1, no session, no secrets. A health check
 * that queries the database reports the database's opinion of itself and then
 * fails for reasons unrelated to whether the Worker is up.
 *
 * Reachable without a session (see the skip list in src/middleware.ts), which
 * is the whole point of a probe.
 */
export function GET(): Response {
  return new Response(JSON.stringify({ ok: true, service: "goldpos-admin" }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
