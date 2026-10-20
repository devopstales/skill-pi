import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureMnemonicServer,
  resolveMnemonicUrl,
} from "../lib/mnemonic.js";

test("resolveMnemonicUrl honors SKILL_GRID override", () => {
  const prev = process.env.SKILLGRID_MNEMONIC_HTTP_URL;
  try {
    delete process.env.SKILLGRID_MNEMONIC_HTTP_URL;
    assert.equal(resolveMnemonicUrl(), "http://127.0.0.1:7438");
    process.env.SKILLGRID_MNEMONIC_HTTP_URL = "http://127.0.0.1:9999";
    assert.equal(resolveMnemonicUrl(), "http://127.0.0.1:9999");
  } finally {
    if (prev === undefined) delete process.env.SKILLGRID_MNEMONIC_HTTP_URL;
    else process.env.SKILLGRID_MNEMONIC_HTTP_URL = prev;
  }
});

test("ensureMnemonicServer: healthy server, no spawn", async () => {
  const calls = [];
  const res = await ensureMnemonicServer({
    fetch: async (url) => {
      calls.push(["fetch", url]);
      return { ok: true, status: 200 };
    },
    spawn: () => {
      calls.push(["spawn"]);
      throw new Error("spawn must not be called when healthy");
    },
  });
  assert.equal(res, "ok");
  assert.deepEqual(calls, [["fetch", "http://127.0.0.1:7438/health"]]);
});

test("ensureMnemonicServer: down server, spawns and becomes healthy", async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(["fetch", url]);
    if (calls.filter((c) => c[0] === "fetch").length <= 2) {
      return { ok: false, status: 503 };
    }
    return { ok: true, status: 200 };
  };
  const res = await ensureMnemonicServer({
    fetch,
    spawn: (cmd, args) => {
      calls.push(["spawn", cmd, args]);
    },
    poll: () => {},
  });
  assert.equal(res, "spawned");
  const spawnCall = calls.find((c) => c[0] === "spawn");
  assert.ok(spawnCall, "spawn was called");
  assert.ok(calls.some((c) => c[0] === "fetch" && c[1] === "http://127.0.0.1:7438/health"));
});

test("ensureMnemonicServer: down and still down after timeout, warns without throwing", async () => {
  const calls = [];
  const stderr = [];
  const res = await ensureMnemonicServer({
    fetch: async () => {
      calls.push(["fetch"]);
      return { ok: false, status: 503 };
    },
    spawn: () => {
      calls.push(["spawn"]);
    },
    poll: () => {},
    warn: (msg) => stderr.push(msg),
  });
  assert.equal(res, "unavailable");
  assert.ok(calls.some((c) => c[0] === "spawn"), "spawned before giving up");
  assert.ok(stderr.length > 0, "warned");
});

test("ensureMnemonicServer: down, spawn error, warns without throwing", async () => {
  const stderr = [];
  const res = await ensureMnemonicServer({
    fetch: async () => {
      const e = new Error("connect ECONNREFUSED");
      e.code = "ECONNREFUSED";
      throw e;
    },
    spawn: () => {
      const e = new Error("ENOENT");
      e.code = "ENOENT";
      throw e;
    },
    poll: () => {},
    warn: (msg) => stderr.push(msg),
  });
  assert.equal(res, "unavailable");
  assert.ok(stderr.length > 0, "warned");
});

test("ensureMnemonicServer: fetch transport error counts as down", async () => {
  const calls = [];
  const res = await ensureMnemonicServer({
    fetch: async () => {
      const e = new Error("fetch failed");
      e.cause = { code: "ECONNREFUSED" };
      throw e;
    },
    spawn: () => calls.push(["spawn"]),
    poll: () => {},
  });
  assert.equal(res, "unavailable");
  assert.ok(calls.length > 0, "attempted a spawn");
});
