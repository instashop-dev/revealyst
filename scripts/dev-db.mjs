// Dev-only Postgres: PGlite behind a wire-protocol socket so `wrangler dev`
// can hit a real(ish) database with zero external credentials.
//   node scripts/dev-db.mjs   → postgres://postgres:postgres@127.0.0.1:5432/postgres
// Applies the drizzle migrations on boot. Data is in-memory, gone on exit.
//
// The socket layer is hand-rolled here instead of using
// @electric-sql/pglite-socket's PGLiteSocketServer: that server enqueues each
// wire-protocol MESSAGE individually onto one shared PGlite session, so with
// two concurrent connections (any authenticated page render: the layout's
// client + the page's client) one connection's extended-protocol sequence
// interleaves with the other's. PGlite is a single SESSION, and the unnamed
// prepared statement ("" — what postgres.js uses with prepare:false) is
// session state: connection A's Parse("") gets clobbered by connection B's
// before A's Bind arrives, and postgres.js surfaces it as `08P01 bind
// message supplies N parameters, but prepared statement "" requires M` on
// the heaviest pages (/dashboard reproduced it ~100% after PR #266's
// concurrent reads). Batching per TCP packet is NOT enough — postgres.js
// legitimately splits one query into Parse…Flush, await, Bind…Sync — so the
// fix is a SESSION MUTEX: a connection acquires the (single) PGlite session
// on its first buffered message and releases it only at a protocol
// quiescence point — a batch ending in Sync/Query/password — AND with no
// transaction left open, so neither an extended-protocol sequence nor an
// explicit BEGIN…COMMIT can ever be interleaved by another connection.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const db = await PGlite.create();

const migrationsDir = "drizzle";
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const file of migrations) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    await db.exec(statement);
  }
  console.log(`applied ${file}`);
}

const SSL_REQUEST_CODE = 80877103;
const CANCEL_REQUEST_CODE = 80877102;
// Front-end message types after which the backend responds. 'H' (Flush) is
// deliberately NOT a release point — it sits mid-sequence between Parse and
// Bind, exactly where the session must stay owned. KNOWN LIMITATION: the
// COPY sub-protocol ('d'/'c'/'f' CopyData/Done/Fail) is unsupported — a
// COPY FROM STDIN would hang (its data never forms a batch). Nothing in the
// dev loop COPYes (migrations run in-process; postgres.js doesn't), and the
// replaced pglite-socket server only supported it by the same interleaving
// that corrupted regular queries.
const EXEC_TYPES = new Set(["Q", "S", "H", "p", "X"]);
const RELEASE_TYPES = new Set(["Q", "S", "p", "X"]);

// ── The session mutex ──────────────────────────────────────────────────────
let lockHolder = null;
const lockWaiters = [];
function acquireSession(owner) {
  if (lockHolder === owner) return Promise.resolve();
  if (lockHolder === null) {
    lockHolder = owner;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    lockWaiters.push({ owner, resolve });
  });
}
function releaseSession(owner) {
  if (lockHolder !== owner) return;
  const next = lockWaiters.shift();
  if (next) {
    lockHolder = next.owner;
    next.resolve();
  } else {
    lockHolder = null;
  }
}

function handleConnection(socket) {
  socket.setNoDelay(true);
  let buffer = Buffer.alloc(0);
  let startupDone = false;
  // Per-connection execution chain keeps THIS connection's batches in order;
  // the session mutex serializes across connections.
  let chain = Promise.resolve();
  let closed = false;

  const execBatch = (batch, releaseAfter) => {
    chain = chain
      .then(async () => {
        // A batch queued before its client died is skipped: its mutations
        // would land invisibly (responses go nowhere) — the old per-handler
        // queue rejected these on disconnect too. `cleanup` is chained AFTER
        // every already-queued batch, so lock release/rollback still runs.
        if (closed) return;
        await acquireSession(socket);
        await db.execProtocolRawStream(new Uint8Array(batch), {
          onRawData: (data) => {
            if (!closed && socket.writable && data.length > 0) {
              socket.write(Buffer.from(data));
            }
          },
        });
        // Release only at quiescence: batch ended in Sync/Query/password AND
        // no transaction is open (BEGIN…COMMIT spans several Sync points and
        // must not admit another connection into the shared session).
        if (releaseAfter && !db.isInTransaction()) {
          releaseSession(socket);
        }
      })
      .catch(async (error) => {
        console.error("dev db: batch failed:", error?.message ?? error);
        // Never hand the session to the next connection mid-transaction: an
        // open (possibly aborted) transaction would swallow the next
        // client's writes or fail its every statement with 25P02 — and by
        // the time this socket's cleanup runs, the lock has moved on, so
        // ONLY this path can roll it back.
        if (lockHolder === socket && db.isInTransaction()) {
          await db.exec("ROLLBACK").catch(() => {});
        }
        releaseSession(socket);
        socket.destroy();
      });
  };

  socket.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);

    while (buffer.length > 0) {
      if (!startupDone) {
        // Untyped startup-phase messages: int32 length prefix at offset 0.
        if (buffer.length < 8) return;
        const len = buffer.readInt32BE(0);
        if (buffer.length < len) return;
        const code = buffer.readInt32BE(4);
        const message = buffer.subarray(0, len);
        buffer = buffer.subarray(len);
        if (code === SSL_REQUEST_CODE) {
          socket.write(Buffer.from("N")); // no TLS on the local loop
          continue;
        }
        if (code === CANCEL_REQUEST_CODE) continue; // not supported
        startupDone = true;
        execBatch(message, true); // StartupMessage → auth/ReadyForQuery round
        continue;
      }

      // Typed messages: 1-byte type + int32 length. Collect complete
      // messages up to the LAST backend-response point in the buffer and
      // execute them as one atomic unit under the session mutex.
      let offset = 0;
      let batchEnd = 0;
      let releaseAfter = false;
      while (buffer.length >= offset + 5) {
        const len = 1 + buffer.readInt32BE(offset + 1);
        if (buffer.length < offset + len) break;
        const type = String.fromCharCode(buffer[offset]);
        offset += len;
        if (EXEC_TYPES.has(type)) {
          batchEnd = offset;
          releaseAfter = RELEASE_TYPES.has(type);
        }
      }
      if (batchEnd === 0) return; // nothing executable yet — keep buffering
      const batch = buffer.subarray(0, batchEnd);
      buffer = buffer.subarray(batchEnd);
      execBatch(batch, releaseAfter);
    }
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    // A connection that vanished mid-sequence (or mid-transaction) must not
    // wedge the shared session for every other client.
    chain = chain.then(async () => {
      if (lockHolder === socket) {
        if (db.isInTransaction()) {
          await db.exec("ROLLBACK").catch(() => {});
        }
        releaseSession(socket);
      }
    });
  };
  socket.on("close", cleanup);
  socket.on("error", (error) => {
    if (error?.code !== "ECONNRESET") {
      console.error("dev db: socket error:", error?.message ?? error);
    }
    cleanup();
  });
}

const server = createServer(handleConnection);
server.maxConnections = 32;
server.listen(5432, "127.0.0.1", () => {
  console.log(
    "dev db listening on postgres://postgres:postgres@127.0.0.1:5432/postgres",
  );
});
