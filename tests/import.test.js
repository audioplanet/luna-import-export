// Import and Sort, against Luna.MockEngine: no LUNA needed. `npm test`.
import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';

globalThis.Luna = Luna;
await import('../logic.js');
await import('../importer.js');
const I = globalThis.ImportLogic;
const S = globalThis.SortLogic;
const V = globalThis.VersionLogic;

describe('reading take names', () => {
  it('understands Export’s names and the usual variants', () => {
    const p = (path) => I.parseTake(path);
    expect(p('/x/Bass - V2 - tight.wav')).toEqual({ track: 'Bass', number: 2, name: 'tight' });
    expect(p('/x/Bass - V2.wav')).toEqual({ track: 'Bass', number: 2, name: '' });
    expect(p('/x/V3/Bass - tight.wav')).toEqual({ track: 'Bass', number: 3, name: 'tight' });
    expect(p('/x/V3/Bass.wav')).toEqual({ track: 'Bass', number: 3, name: '' });
    expect(p('/x/Gtr_V4.aif')).toEqual({ track: 'Gtr', number: 4, name: '' });
    expect(p('/x/Lead Vox Take 2.wav')).toEqual({ track: 'Lead Vox', number: 2, name: '' });
    expect(p('/x/KICK OUT 2 FH - V1.wav')).toEqual({ track: 'KICK OUT 2 FH', number: 1, name: '' });
    expect(p('/x/Keys.wav')).toEqual({ track: 'Keys', number: null, name: '' });
    expect(p('/x/TOM HI.wav')).toEqual({ track: 'TOM HI', number: null, name: '' }); // "HI" is no take
    expect(p('/x/Take 2/Piano.wav')).toEqual({ track: 'Piano', number: 2, name: '' });
  });

  it('groups files into tracks with a version per take', () => {
    const plan = I.planTakes([
      '/x/Bass - V10.wav',
      '/x/Bass - V2 - tight.wav',
      '/x/Bass - V1.wav',
      '/x/Keys.wav',
      '/x/bass - V2 - again.wav', // same take twice: the first wins
      '/x/notes.txt',
      '/x/Gtr.wav',
      '/x/Gtr - V3.wav', // Gtr.wav has no number: V1 is free, so it is V1
    ]);
    expect(plan.tracks.map((t) => [t.name, t.takes.map((k) => `V${k.number}${k.name ? ` ${k.name}` : ''}`)])).toEqual([
      ['Bass', ['V1', 'V2 tight', 'V10']],
      ['Gtr', ['V1', 'V3']],
      ['Keys', ['V1']],
    ]);
    expect(plan.ignored).toEqual(['/x/bass - V2 - again.wav']);
  });
});

describe('album names', () => {
  it('drops track numbers and keeps the order', () => {
    const items = I.planAlbum(['/m/10 - Last.wav', '/m/02 Second.wav', '/m/01 - First Song.wav', '/m/cover.jpg', '/m/1999.wav']);
    expect(items.map((i) => i.title)).toEqual(['First Song', 'Second', 'Last', '1999']);
  });
});

describe('sort rules', () => {
  const R = S.DEFAULT_RULES;
  const where = (name) => S.match(name, R)?.folder ?? null;
  it('matches words at the start of a word, deepest folder first', () => {
    expect(where('Kick IN')).toBe('Drums/Kick');
    expect(where('KICK OUT 2 FH')).toBe('Drums/Kick');
    expect(where('Bass Drum')).toBe('Drums/Kick');
    expect(where('SN TOP1')).toBe('Drums/Sn');
    expect(where('Snare2')).toBe('Drums/Sn');
    expect(where('TOM HI')).toBe('Drums/Tom');
    expect(where('OH LULU')).toBe('Drums');
    expect(where('BASS DI')).toBe('Bass');
    expect(where('RHODES')).toBe('Keys');
    expect(where('HAMMOND ROOM')).toBe('Keys'); // the first word decides between equals
    expect(where('Vocal Room')).toBe('Vocals');
    expect(where('ROOM')).toBe('Drums');
    expect(where('0 Lead Vocals')).toBe('Vocals');
    expect(where('EL GTR 2')).toBe('Guitars');
    expect(where('Snapper')).toBe(null);
    expect(where('CLICK 1')).toBe(null);
  });

  it('finds folders by path and plans moves', () => {
    const folders = [
      { id: 'd', name: 'Drums', path: ['Drums'], parentId: null },
      { id: 'k', name: 'Kick', path: ['Drums', 'Kick'], parentId: 'd' },
      { id: 'b', name: 'Bass', path: ['Bass'], parentId: null },
    ];
    expect(S.findFolder(folders, 'kick')?.id).toBe('k');
    expect(S.findFolder(folders, 'Drums / Kick')?.id).toBe('k');
    expect(S.findFolder(folders, 'Bass/Kick')).toBe(null);
    const plan = S.plan(
      [
        { id: '1', name: 'Kick IN', folderId: null },
        { id: '2', name: 'SN TOP', folderId: null },
        { id: '3', name: 'Bass DI', folderId: 'd' }, // already in a folder: left alone
        { id: '4', name: 'Tambourine', folderId: null },
      ],
      folders,
      R,
    );
    expect(plan.map((m) => [m.name, m.folder?.path.join('/') ?? null, m.missing])).toEqual([
      ['Kick IN', 'Drums/Kick', null],
      ['SN TOP', null, 'Drums/Sn'],
      ['Bass DI', null, null],
      ['Tambourine', null, null],
    ]);
  });
});

async function session() {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { name: 'Import', tracks: [] });
  await engine.settled();
  // LUNA's set_playlists makes that version active on each track; the mock does nothing.
  engine.overrideCommand('/sessions/abc/set_playlists', (data) => {
    for (const t of data?.track_uid ?? []) {
      const pl = engine.children('/sessions/abc/playlists').find((p) => engine.value(`/sessions/abc/playlists/${p}`, 'track_uid') === t && engine.value(`/sessions/abc/playlists/${p}`, 'version') === data.version);
      if (pl) engine.setValue(`/sessions/abc/tracks/${t}`, 'playlist_uid', pl);
    }
    return null;
  });
  // Imported files: 3 s, stereo when the name says so.
  let n = 0;
  engine.overrideCommand('/workspace/import_file', (data) => {
    const uid = `file${++n}`;
    engine.addSource(data.session_package_uid, uid, { name: data.name, lengthNs: 3e9, stemFormat: /stereo/i.test(data.local_path ?? data.path ?? data.name ?? '') ? 'stereo' : 'mono', analysis: false });
    return { uid };
  });
  const luna = await Luna.connect({ port_: engine.port() });
  const s = await luna.session();
  await s.ready();
  await I.ensureTempo(s);
  return { engine, s };
}

describe('importing into the mock engine', () => {
  it('makes a track per name with a version per take, numbered as in the files', async () => {
    const { engine, s } = await session();
    const plan = I.planTakes(['/x/Bass - V1.wav', '/x/Bass - V3 - tight.wav', '/x/Keys stereo.wav']);
    const out = await I.importTakes(s, plan, { startTick: 0 });
    await engine.settled();
    expect(out.failed).toEqual([]);
    expect(out.made).toEqual(['Bass', 'Keys stereo']);
    const tracks = await V.readTracks(s);
    expect(tracks.map((t) => [t.name, t.active, t.versions.map((v) => [v.number, v.clips.length])])).toEqual([
      ['Bass', 1, [[1, 1], [2, 0], [3, 1]]],
      ['Keys stereo', 1, [[1, 1]]],
    ]);
    const bass = s.tracks.items.find((t) => t.name.value === 'Bass');
    const keys = s.tracks.items.find((t) => t.name.value === 'Keys stereo');
    expect(bass.stemFormat.value).toBe('mono');
    expect(keys.stemFormat.value).toBe('stereo');
    const clip = tracks[0].versions[2].clips[0];
    expect(s.musical.timeline.seconds(clip.stop) - s.musical.timeline.seconds(clip.start)).toBeCloseTo(3, 3);
  });

  it('puts album files one after another with a gap and a marker each', async () => {
    const { engine, s } = await session();
    const items = I.planAlbum(['/m/02 - Two.wav', '/m/01 - One.wav']);
    const out = await I.importAlbum(s, items, { startTick: 0, gapSeconds: 2 });
    await engine.settled();
    expect(out.failed).toEqual([]);
    const tl = s.musical.timeline;
    expect(out.placed.map((p) => [p.title, +tl.seconds(p.startTick).toFixed(3), +tl.seconds(p.stopTick).toFixed(3)])).toEqual([
      ['One', 0, 3],
      ['Two', 5, 8],
    ]);
    await s.markers.load?.();
    await engine.settled();
    expect(s.markers.items.map((m) => m.name.value)).toEqual(['One', 'Two']);
    expect(s.tracks.items.filter((t) => t.trackType.value === 'audio').map((t) => t.name.value)).toEqual(['One', 'Two']);
  });

  it('sorts tracks into folders, making missing ones when asked', async () => {
    const { engine, s } = await session();
    const drums = await s.newFolder({ name: 'Drums' });
    const [kick] = await s.newTrack({ name: 'Kick In' });
    const [oh] = await s.newTrack({ name: 'OH L' });
    const [bass] = await s.newTrack({ name: 'Bass DI' });
    await engine.settled();
    let plan = S.plan(S.readTracks(s), S.folders(s), S.DEFAULT_RULES);
    expect(plan.filter((m) => m.missing).map((m) => m.missing)).toEqual(['Drums/Kick', 'Bass']);
    const made = await S.makeFolders(s, [...new Set(plan.filter((m) => m.missing).map((m) => m.missing))]);
    expect(made).toEqual(['Drums/Kick', 'Bass']);
    await engine.settled();
    plan = S.plan(S.readTracks(s), S.folders(s), S.DEFAULT_RULES);
    const out = await S.apply(s, plan);
    await engine.settled();
    expect(out).toEqual({ moved: 3, failed: [] });
    const path = (t) => S.folders(s).find((f) => f.id === s.tracks.byId(t.id).folderUid.value)?.path.join('/');
    expect([path(kick), path(oh), path(bass)]).toEqual(['Drums/Kick', 'Drums', 'Bass']);
    expect(S.folders(s).find((f) => f.name === 'Kick').parentId).toBe(drums.id);
  });

  it('selects every track in a folder and its folders, for a LUNA group', async () => {
    const { engine, s } = await session();
    const drums = await s.newFolder({ name: 'Drums' });
    const kick = await s.newFolder({ name: 'Kick', folderUid: drums.id });
    const [k] = await s.newTrack({ name: 'Kick In', folderUid: kick.id });
    const [oh] = await s.newTrack({ name: 'OH', folderUid: drums.id });
    const [bass] = await s.newTrack({ name: 'Bass' });
    await engine.settled();
    expect(S.tracksIn(s, drums.id).sort()).toEqual([k.id, oh.id].sort());
    expect(await S.selectFolder(s, drums.id)).toBe(2);
    await engine.settled();
    expect(s.context.snapshot().selection_tracks.sort()).toEqual([k.id, oh.id].sort());
    expect(S.tracksIn(s, kick.id)).toEqual([k.id]);
    expect(S.tracksIn(s, drums.id)).not.toContain(bass.id);
  });
});
