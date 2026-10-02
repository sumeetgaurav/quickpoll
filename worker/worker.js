const { Pool } = require("pg");
const { createClient } = require("redis");

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://poll:poll@db:5432/poll";
const REDIS_URL = process.env.REDIS_URL || "redis://cache:6379";

const pool = new Pool({ connectionString: DATABASE_URL });
const redis = createClient({ url: REDIS_URL });
redis.on("error", (e) => console.error("[redis]", e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  while (!redis.isOpen) {
    try { await redis.connect(); } catch (e) { console.log("[worker] waiting for redis"); await sleep(2000); }
  }
  for (;;) {
    try {
      await pool.query("CREATE TABLE IF NOT EXISTS results (option TEXT PRIMARY KEY, count BIGINT NOT NULL DEFAULT 0)");
      break;
    } catch (e) { console.log("[worker] waiting for postgres"); await sleep(2000); }
  }
  console.log("[worker] consuming queue 'votes'");

  for (;;) {
    let option;
    try {
      const item = await redis.brPop("votes", 0); // blocks until a vote arrives
      option = item.element;
      await pool.query(
        "INSERT INTO results (option, count) VALUES ($1, 1) ON CONFLICT (option) DO UPDATE SET count = results.count + 1",
        [option]
      );
      console.log(`[worker] counted vote for ${option}`);
    } catch (e) {
      console.error("[worker] error:", e.message);
      if (option) await redis.rPush("votes", option).catch(() => {}); // put it back, retry soon
      await sleep(2000);
    }
  }
}

main();
