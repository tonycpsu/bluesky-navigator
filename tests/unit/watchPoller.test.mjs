import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INTERVAL_MS, WatchPoller } from '../../src/watch/WatchPoller.js';

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function makeTimers() {
  let t = 0;
  let nextId = 1;
  const queue = [];
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      queue.push({ id, at: t + ms, fn });
      return id;
    },
    clearTimeout(id) {
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    now: () => t,
    pending: () => queue.length,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await flush();
        queue.sort((a, b) => a.at - b.at);
        if (!queue.length || queue[0].at > end) break;
        const q = queue.shift();
        t = Math.max(t, q.at);
        q.fn();
      }
      t = end;
      await flush();
    },
  };
}

function makeVisibility(hidden = false) {
  const v = {
    hidden,
    cbs: [],
    isHidden: () => v.hidden,
    onChange(cb) {
      v.cbs.push(cb);
      return () => (v.cbs = v.cbs.filter((c) => c !== cb));
    },
    set(h) {
      v.hidden = h;
      v.cbs.slice().forEach((cb) => cb());
    },
  };
  return v;
}

function makeApi(overrides = {}) {
  const api = {
    calls: [],
    limited: false,
    agent: { session: { did: 'did:me' } },
    isRateLimited: () => api.limited,
    login: async () => {
      api.agent.session = { did: 'did:me' };
    },
    getThread: async (uri, opts) => {
      api.calls.push({ uri, opts });
      return { post: { uri }, replies: [] };
    },
    ...overrides,
  };
  return api;
}

function quietWarn(fn) {
  return async () => {
    const orig = console.warn;
    console.warn = () => {};
    try {
      await fn();
    } finally {
      console.warn = orig;
    }
  };
}

const rec = (id, extra = {}) => ({ postId: id, ...extra });

function setup({
  watches = [rec('a')],
  api = makeApi(),
  hidden = false,
  onResult,
  onRoundDone,
} = {}) {
  const timers = makeTimers();
  const visibility = makeVisibility(hidden);
  const results = [];
  let rounds = 0;
  const poller = new WatchPoller({
    api,
    getWatches: () => watches,
    resolveUri: async (r) => `at://x/app.bsky.feed.post/${r.postId}`,
    onResult: (id, res) => {
      results.push([id, res]);
      onResult?.(id, res);
    },
    onRoundDone: () => {
      rounds++;
      onRoundDone?.();
    },
    intervalMs: 180000,
    timers,
    visibility,
  });
  return { poller, api, timers, visibility, results, rounds: () => rounds };
}

test('no api: start schedules nothing', async () => {
  const timers = makeTimers();
  const poller = new WatchPoller({
    api: null,
    getWatches: () => [],
    timers,
    visibility: makeVisibility(),
  });
  poller.start();
  await flush();
  assert.equal(timers.pending(), 0);
});

test('start checks right away, then every intervalMs', async () => {
  const s = setup();
  s.poller.start();
  await flush();
  assert.equal(s.api.calls.length, 1);
  await s.timers.advance(179999);
  assert.equal(s.api.calls.length, 1);
  await s.timers.advance(1);
  assert.equal(s.api.calls.length, 2);
  assert.equal(s.rounds(), 2);
  s.poller.stop();
});

test('checks one watch at a time with a 2000 ms gap', async () => {
  const s = setup({ watches: [rec('a'), rec('b')] });
  s.poller.start();
  await flush();
  assert.equal(s.api.calls.length, 1);
  await s.timers.advance(1999);
  assert.equal(s.api.calls.length, 1);
  await s.timers.advance(1);
  assert.equal(s.api.calls.length, 2);
  s.poller.stop();
});

test('passes depth 50 and parentHeight 0', async () => {
  const s = setup();
  s.poller.start();
  await flush();
  assert.deepEqual(s.api.calls[0].opts, { depth: 50, parentHeight: 0 });
  assert.equal(s.results[0][1].status, 'ok');
  s.poller.stop();
});

test('skips the whole round during the rate-limit cooldown', async () => {
  const s = setup();
  s.api.limited = true;
  const res = await s.poller.runRound();
  assert.deepEqual(res, { checked: 0, skipped: 'rateLimited' });
  assert.equal(s.api.calls.length, 0);
  assert.equal(s.rounds(), 0);
});

test('a 429 mid-round stops the round', async () => {
  const api = makeApi();
  api.getThread = async (uri) => {
    api.calls.push({ uri });
    const e = new Error('slow down');
    e.status = 429;
    throw e;
  };
  const s = setup({ watches: [rec('a'), rec('b')], api });
  s.poller.start();
  await flush();
  await s.timers.advance(2000);
  assert.equal(api.calls.length, 1);
  assert.equal(s.results.length, 0);
  assert.equal(s.rounds(), 1);
  s.poller.stop();
});

test('NotFound error reports status notFound', async () => {
  const api = makeApi();
  api.getThread = async () => {
    const e = new Error('Post not found');
    e.error = 'NotFound';
    throw e;
  };
  const s = setup({ api });
  s.poller.start();
  await flush();
  assert.deepEqual(s.results, [['a', { status: 'notFound' }]]);
  s.poller.stop();
});

test('unavailable watches are never fetched', async () => {
  const s = setup({ watches: [rec('a', { unavailable: true }), rec('b')] });
  s.poller.start();
  await flush();
  assert.equal(s.api.calls.length, 1);
  assert.match(s.api.calls[0].uri, /b$/);
  s.poller.stop();
});

test('hidden tab: no rounds; becoming visible checks once', async () => {
  const s = setup({ hidden: true });
  s.poller.start();
  await s.timers.advance(600000);
  assert.equal(s.api.calls.length, 0);
  assert.equal(s.timers.pending(), 0);
  s.visibility.set(false);
  await flush();
  assert.equal(s.api.calls.length, 1);
  s.poller.stop();
});

test('flipping visibility within 60 s does not start another round', async () => {
  const s = setup();
  s.poller.start();
  await flush();
  await s.timers.advance(30000);
  s.visibility.set(true);
  assert.equal(s.timers.pending(), 0);
  s.visibility.set(false);
  await flush();
  assert.equal(s.api.calls.length, 1);
  assert.equal(s.timers.pending(), 1);
  s.poller.stop();
});

test(
  'logs in first when there is no session; a failed login skips the round',
  quietWarn(async () => {
    const api = makeApi();
    api.agent.session = null;
    let logins = 0;
    api.login = async () => {
      logins++;
      api.agent.session = { did: 'did:me' };
    };
    const s = setup({ api });
    await s.poller.runRound();
    assert.equal(logins, 1);
    assert.equal(api.calls.length, 1);

    const bad = makeApi();
    bad.agent.session = null;
    bad.login = async () => {
      throw new Error('nope');
    };
    const s2 = setup({ api: bad });
    const res = await s2.poller.runRound();
    assert.deepEqual(res, { checked: 0, skipped: 'login' });
    assert.equal(bad.calls.length, 0);
    assert.equal(s2.rounds(), 0);
  })
);

test('checkNow checks one watch without onRoundDone; unknown id is a no-op', async () => {
  const s = setup({ watches: [rec('a'), rec('b')] });
  await s.poller.checkNow('b');
  await s.poller.checkNow('zzz');
  assert.equal(s.api.calls.length, 1);
  assert.match(s.api.calls[0].uri, /b$/);
  assert.equal(s.rounds(), 0);
});

test('stop clears the timer and unsubscribes', async () => {
  const s = setup();
  s.poller.start();
  await flush();
  s.poller.stop();
  assert.equal(s.timers.pending(), 0);
  assert.equal(s.visibility.cbs.length, 0);
});

test('stop() mid-round means no further getThread calls', async () => {
  const s = setup({ watches: [rec('a'), rec('b'), rec('c')] });
  s.poller.start();
  await flush();
  s.poller.stop();
  await s.timers.advance(10000);
  assert.equal(s.api.calls.length, 1);
});

test(
  'a throwing onRoundDone still reschedules',
  quietWarn(async () => {
    const s = setup({
      onRoundDone: () => {
        throw new Error('boom');
      },
    });
    s.poller.start();
    await flush();
    assert.equal(s.timers.pending(), 1);
    await s.timers.advance(180000);
    assert.equal(s.api.calls.length, 2);
    s.poller.stop();
  })
);

test(
  'a throwing onResult does not produce a second onResult',
  quietWarn(async () => {
    const s = setup({
      onResult: () => {
        throw new Error('Post not found');
      },
    });
    s.poller.start();
    await flush();
    assert.equal(s.results.length, 1);
    s.poller.stop();
  })
);

test('becoming hidden mid-round ends the round', async () => {
  const s = setup({ watches: [rec('a'), rec('b')] });
  s.poller.start();
  await flush();
  s.visibility.set(true);
  await s.timers.advance(2000);
  assert.equal(s.api.calls.length, 1);
  assert.equal(s.rounds(), 1);
  s.poller.stop();
});

test('rate limit turning on mid-round ends the round', async () => {
  const s = setup({ watches: [rec('a'), rec('b')] });
  s.poller.start();
  await flush();
  s.api.limited = true;
  await s.timers.advance(2000);
  assert.equal(s.api.calls.length, 1);
  assert.equal(s.rounds(), 1);
  s.poller.stop();
});

test(
  'a generic error skips one watch and the round continues',
  quietWarn(async () => {
    const api = makeApi();
    api.getThread = async (uri) => {
      api.calls.push({ uri });
      if (api.calls.length === 1) throw new Error('network');
      return { post: { uri }, replies: [] };
    };
    const s = setup({ watches: [rec('a'), rec('b')], api });
    s.poller.start();
    await flush();
    await s.timers.advance(2000);
    assert.equal(api.calls.length, 2);
    assert.deepEqual(
      s.results.map((r) => r[0]),
      ['b']
    );
    s.poller.stop();
  })
);

test('blocked status is reported without replies', async () => {
  const api = makeApi();
  api.getThread = async () => ({ $type: 'app.bsky.feed.defs#blockedPost', blocked: true });
  const s = setup({ api });
  s.poller.start();
  await flush();
  assert.deepEqual(s.results, [['a', { status: 'blocked' }]]);
  s.poller.stop();
});

test('becoming visible 60 s after a round runs a round', async () => {
  const s = setup();
  s.poller.start();
  await flush();
  s.visibility.set(true);
  await s.timers.advance(60000);
  s.visibility.set(false);
  await flush();
  assert.equal(s.api.calls.length, 2);
  s.poller.stop();
});

test('setIntervalMs reschedules from now', async () => {
  const s = setup();
  s.poller.start();
  await flush();
  s.poller.setIntervalMs(60000);
  await s.timers.advance(60000);
  assert.equal(s.api.calls.length, 2);
  s.poller.stop();
});

test('intervals that are not finite or under 60 s fall back to the default', () => {
  for (const bad of [0, 3000, -60000, NaN, Infinity, undefined, '180000']) {
    const poller = new WatchPoller({
      api: null,
      getWatches: () => [],
      intervalMs: bad,
      timers: makeTimers(),
      visibility: makeVisibility(),
    });
    assert.equal(poller.intervalMs, DEFAULT_INTERVAL_MS, `constructor ${String(bad)}`);
    poller.setIntervalMs(120000);
    assert.equal(poller.intervalMs, 120000);
    poller.setIntervalMs(bad);
    assert.equal(poller.intervalMs, DEFAULT_INTERVAL_MS, `setIntervalMs ${String(bad)}`);
  }
});
