// Runs against Luna.MockEngine: no LUNA needed. `npm test`.
import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';

globalThis.Luna = Luna; // logic.js is a classic script that reads the Luna global
await import('../logic.js');
const V = globalThis.VersionLogic;
V.RENDER_POLL_MS = 20;

const BAR = Luna.WHOLE_NOTE;
const v = (number, name, clips) => ({ number, name, playlistId: `p${number}`, clips: clips.map(([a, b]) => ({ start: a * BAR, stop: b * BAR })) });
const track = (id, name, active, versions) => ({ id, name, active, versions });
const files = (plan) => plan.renders.map((r) => [r.number, r.items.map((i) => (i.subfolder ? `${i.subfolder}/` : '') + i.fileName)]);

describe('names', () => {
  it('keeps the names users give versions', () => {
    expect(V.versionLabel({ number: 3, name: 'V3' })).toBe('V3');
    expect(V.versionLabel({ number: 3, name: 'v3' })).toBe('V3');
    expect(V.versionLabel({ number: 3, name: '' })).toBe('V3');
    expect(V.versionLabel({ number: 3, name: ' groove take ' })).toBe('V3 - groove take');
  });
});

describe('plan', () => {
  const tracks = [
    track('b', 'Bass', 3, [v(1, 'V1', [[0, 4]]), v(2, 'tight', [[0, 6]]), v(3, 'V3', [[1, 5]])]),
    track('g', 'Guitar', 1, [v(1, 'V1', [[2, 8]]), v(2, 'V2', [])]), // V2 empty: Guitar counts as one version
    track('k', 'Keys', 1, [v(1, 'V1', [[0, 12]])]),
    track('e', 'Empty', 1, [v(1, 'V1', [])]),
  ];

  it('exports every version of multi-version tracks and the rest once, all over the same range', () => {
    const p = V.plan(tracks, 0, 'names');
    expect([p.start, p.end / BAR]).toEqual([0, 12]);
    expect(files(p)).toEqual([
      [1, ['Bass - V1.wav', 'Guitar.wav', 'Keys.wav']],
      [2, ['Bass - V2 - tight.wav']],
      [3, ['Bass - V3.wav']],
    ]);
    expect(p.skipped).toEqual(['Empty']);
  });

  it('puts versions in folders when asked, single tracks at the top', () => {
    const p = V.plan(tracks, 0, 'folders');
    expect(files(p)).toEqual([
      [1, ['V1/Bass.wav', 'Guitar.wav', 'Keys.wav']],
      [2, ['V2/Bass - tight.wav']],
      [3, ['V3/Bass.wav']],
    ]);
    expect(V.subfolders(p)).toEqual(['V1', 'V2', 'V3']);
  });

  it('leaves out unticked tracks but keeps the full range, so later exports line up', () => {
    const p = V.plan(tracks, 0, 'names', ['k', 'e']);
    expect(files(p)).toEqual([
      [1, ['Bass - V1.wav', 'Guitar.wav']],
      [2, ['Bass - V2 - tight.wav']],
      [3, ['Bass - V3.wav']],
    ]);
    expect(p.end / BAR).toBe(12); // Keys is unticked but still sets the end
    expect(p.unticked).toEqual(['Keys']);
    expect(p.skipped).toEqual(['Empty']);
    expect(V.plan(tracks, 0, 'names', ['b', 'g', 'k']).renders).toEqual([]);
  });

  it('starts at bar 1, or earlier when a clip does', () => {
    expect(V.plan(tracks, 2 * BAR).start).toBe(0);
    expect(V.plan([track('x', 'X', 1, [v(1, 'V1', [[3, 4]])])], 2 * BAR).start).toBe(2 * BAR);
  });

  it('numbers tracks with the same name', () => {
    const p = V.plan([track('a', 'Gtr', 1, [v(1, 'V1', [[0, 1]])]), track('b', 'Gtr', 1, [v(1, 'V1', [[0, 1]])])], 0);
    expect(files(p)).toEqual([[1, ['Gtr.wav', 'Gtr (2).wav']]]);
  });

  it('has nothing to do in a session without clips', () => {
    expect(V.plan([track('e', 'Empty', 1, [v(1, 'V1', [])])], 0).end).toBe(null);
  });
});

async function session() {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { name: 'Takes', tracks: ['Bass', 'Keys'] });
  await engine.settled();
  // LUNA's set_playlists makes that version active on each track; the mock does nothing.
  engine.overrideCommand('/sessions/abc/set_playlists', (data) => {
    for (const t of data?.track_uid ?? []) {
      const pl = engine.children('/sessions/abc/playlists').find((p) => engine.value(`/sessions/abc/playlists/${p}`, 'track_uid') === t && engine.value(`/sessions/abc/playlists/${p}`, 'version') === data.version);
      if (pl) engine.setValue(`/sessions/abc/tracks/${t}`, 'playlist_uid', pl);
    }
    return null;
  });
  const luna = await Luna.connect({ port_: engine.port() });
  const s = await luna.session();
  await s.ready();
  const bass = s.tracks.items.find((t) => t.name.value === 'Bass');
  const keys = s.tracks.items.find((t) => t.name.value === 'Keys');
  engine.addMidiClip('abc', bass.id, { startTick: 0, stopTick: 4 * BAR });
  engine.addMidiClip('abc', keys.id, { startTick: 0, stopTick: 6 * BAR });
  await s.newPlaylists([bass.id]);
  await s.newPlaylists([bass.id]);
  await engine.settled();
  await s.playlists.load();
  await s.playlists.membersReady();
  // Clips on Bass V2 and V3, and Bass on V2 as the user left it.
  for (const n of [2, 3]) {
    await s.setPlaylist(bass.id, n);
    await engine.settled();
    engine.addMidiClip('abc', bass.id, { startTick: 0, stopTick: (4 + n) * BAR });
  }
  await s.setPlaylist(bass.id, 2);
  await engine.settled();
  return { engine, luna, s, bass, keys };
}

function autoFinish(engine) {
  const timer = setInterval(() => {
    for (const uid of engine.children('/renders')) {
      if (engine.value(`/renders/${uid}`, 'state') === 'running') engine.finishRender(uid, { state: 'completed' });
    }
  }, 5);
  return () => clearInterval(timer);
}

describe('against the mock engine', () => {
  it('reads tracks with their versions and the active one', async () => {
    const { s } = await session();
    const tracks = await V.readTracks(s);
    expect(tracks.map((t) => [t.name, t.active, t.versions.map((x) => [x.number, x.clips.length])])).toEqual([
      ['Bass', 2, [[1, 1], [2, 1], [3, 1]]],
      ['Keys', 1, [[1, 1]]],
    ]);
  });

  it('switches versions per render, bounces raw, and puts the versions back', async () => {
    const { engine, s, bass } = await session();
    const p = V.plan(await V.readTracks(s), 0, 'names');
    const stop = autoFinish(engine);
    const seen = [];
    let snaps = 0;
    try {
      const out = await V.exportPlan(s, p, '/out', {
        onSnapshot: (x) => x && snaps++,
        onEvent: (e) => e.type === 'render' && seen.push(V.activeNumber(s, bass.id)),
      });
      expect(out.written).toEqual(['/out/Bass - V1.wav', '/out/Keys.wav', '/out/Bass - V2.wav', '/out/Bass - V3.wav']);
      expect(out.failed).toEqual([]);
      expect(out.notRestored).toEqual([]);
    } finally {
      stop();
    }
    await engine.settled();
    expect(seen).toEqual([2, 1, 2]); // as each render starts, before switching
    expect(V.activeNumber(s, bass.id)).toBe(2); // back where the user left it
    expect(snaps).toBe(1);
    const news = engine.requests.filter((r) => r.path.endsWith('/renders/new')).map((r) => r.data ?? r.body ?? r);
    expect(news).toHaveLength(3);
    expect(JSON.stringify(news[0])).toContain('pre_effects');
  });

  it('stops when LUNA did not write a file, and still puts versions back', async () => {
    const { engine, s, bass } = await session();
    const p = V.plan(await V.readTracks(s), 0, 'names');
    const stop = autoFinish(engine);
    try {
      const out = await V.exportPlan(s, p, '/missing', { verify: async () => false });
      expect(out.written).toEqual([]);
      expect(out.failed[0].error.code).toBe('not_written');
      expect(engine.requests.filter((r) => r.path.endsWith('/renders/new'))).toHaveLength(1);
    } finally {
      stop();
    }
    await engine.settled();
    expect(V.activeNumber(s, bass.id)).toBe(2);
  });

  it('deselects tracks while switching and gives the selection back', async () => {
    const { engine, s } = await session();
    const ids = s.tracks.items.map((t) => t.id);
    await s.context.load();
    await s.context.select({ trackUids: ids });
    await engine.settled();
    const p = V.plan(await V.readTracks(s), 0, 'names');
    const stop = autoFinish(engine);
    const during = [];
    try {
      await V.exportPlan(s, p, '/out', { onEvent: (e) => e.type === 'render' && during.push(s.context.snapshot().selection_tracks) });
    } finally {
      stop();
    }
    await engine.settled();
    expect(during[0] ?? []).toEqual([]);
    expect(s.context.snapshot().selection_tracks).toEqual(ids);
  });
});
