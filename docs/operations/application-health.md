---
type: "runbook"
status: "current"
last_updated: "2026-08-01"
description: "Application liveness and traffic-readiness probe contracts, deployment guidance, and failure handling."
---

# Application Health Probes

The web application exposes separate public probes for process liveness and
traffic readiness. Both return minimal JSON with `Cache-Control: no-store` and
never expose secrets, versions, environment names, database errors, or other
dependency details.

## Liveness

`GET /api/health/live` returns HTTP 200 with:

```json
{ "status": "ok" }
```

Liveness only proves that the application process can handle an HTTP request.
It never checks the database or any external dependency. Configure a failed
liveness probe to restart the process after the deployment platform's normal
failure threshold.

## Readiness

`GET /api/health/ready` returns HTTP 200 with `{"status":"ready"}` when the
application can receive traffic. It returns HTTP 503 with
`{"status":"not_ready"}` otherwise.

Readiness requires:

- a nonblank `AUTH_SECRET` in production; and
- a successful bounded query against the expected Prisma `User` schema, which
  validates database connectivity and schema availability without returning
  user data.

The probe response is bounded to two seconds. Database work is single-flight,
so concurrent or repeated public requests cannot multiply an unresolved query.
A successful result is cached for five seconds and a failed result for one
second. Required configuration is checked on every request, including while a
database success is cached.

Configure readiness separately from liveness. A readiness failure should remove
the instance from traffic; it should not automatically restart an otherwise
healthy process. This separation avoids restart loops during a database outage
while still preventing requests from reaching an instance that cannot serve
them.

Do not add AI providers, Stripe, object storage, or similar optional services to
application readiness. Those integrations support features that can fail in a
controlled or degraded mode and should not take the entire application out of
traffic.

## Deployment Check

After deployment, verify both contracts against the same origin that receives
application traffic:

```bash
curl --fail-with-body https://example.com/api/health/live
curl --fail-with-body https://example.com/api/health/ready
```

Use the liveness URL for process restart decisions and the readiness URL for
load-balancer or orchestrator traffic admission.
