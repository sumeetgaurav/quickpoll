const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://poll:poll@db:5432/poll";
const REDIS_URL = process.env.REDIS_URL || "redis://cache:6379";
const OPTIONS = ["kubernetes", "docker", "terraform", "ansible"];

const pool = new Pool({ connectionString: DATABASE_URL });
const redis = createClient({ url: REDIS_URL });
redis.on("error", (e) => console.error("[redis]", e.message));

let ready = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function init() {
  for (let i = 1; ; i++) {
    try {
      await pool.query(
        "CREATE TABLE IF NOT EXISTS results (option TEXT PRIMARY KEY, count BIGINT NOT NULL DEFAULT 0)"
      );
      for (const o of OPTIONS) {
        await pool.query("INSERT INTO results (option) VALUES ($1) ON CONFLICT DO NOTHING", [o]);
      }
      if (!redis.isOpen) await redis.connect();
      ready = true;
      console.log("[api] ready");
      return;
    } catch (e) {
      console.log(`[api] dependencies not ready (attempt ${i}): ${e.message}`);
      await sleep(2000);
    }
  }
}

const app = express();
app.use(express.json());

// liveness: process is up. readiness: dependencies reachable.
app.get("/api/healthz", (_req, res) => res.json({ status: "alive" }));
app.get("/api/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    await redis.ping();
    if (!ready) throw new Error("still initialising");
    res.json({ status: "ready" });
  } catch (e) {
    res.status(503).json({ status: "not ready", error: e.message });
  }
});

// Votes are NOT written to Postgres here: they are queued in Redis, a worker persists them.
app.post("/api/vote", async (req, res) => {
  const option = req.body && req.body.option;
  if (!OPTIONS.includes(option)) {
    return res.status(400).json({ error: `option must be one of ${OPTIONS.join(", ")}` });
  }
  try {
    await redis.lPush("votes", option);
    res.status(202).json({ queued: option });
  } catch (e) {
    res.status(503).json({ error: "queue unavailable" });
  }
});

app.get("/api/results", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT option, count::int AS count FROM results ORDER BY option");
    const queued = await redis.lLen("votes");
    res.json({ results: rows, queued });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`[api] listening on ${PORT}`));
init();
