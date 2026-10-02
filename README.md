# quickpoll - 4-component, 3-tier voting app

frontend (nginx) -> api (Express) -> Redis list "votes" -> worker (Node) -> Postgres (results)

Run:     docker compose up --build   ->  http://localhost:8081
Health:  /api/healthz (liveness), /api/readyz (readiness)
Env:     DATABASE_URL, REDIS_URL (api + worker), PORT (api)
