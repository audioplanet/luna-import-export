// Import/Export: Import and Sort, with no DOM so tests can run them against Luna.MockEngine.
//
// Import takes: files named the way Export names them ("Bass - V2 - tight.wav",
// "V2/Bass - tight.wav", "Keys.wav") become one track per name with a version per take.
// Album: files go on their own tracks one after another, with a gap and a marker per file.
// Sort: tracks move into the session's folders by name rules ("kick" goes to Drums/Kick).

const ImportLogic = {
  AUDIO: /\.(wav|wave|aif|aiff|aifc|caf|flac|mp3|m4a|aac|ogg|bwf)$/i,

  /** "Bass - V2 - tight.wav" -> "Bass - V2 - tight". */
  stem(path) {
    const file = String(path).split(/[\\/]/).pop();
    return file.replace(/\.[^.]+$/, '');
  },

  /** The folder a file is in, by name only: "/x/V2/Bass.wav" -> "V2". */
  parentName(path) {
    const parts = String(path).split(/[\\/]/);
    return parts.length > 1 ? parts[parts.length - 2] : '';
  },

  /** Natural order, as LUNA and Finder sort: "2 Song" before "10 Song", case ignored. */
  naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  },

  /**
   * Read a take from a file path: `{ track, number, name }`, `number` null for a file without
   * a version. Understands Export's names and the usual variants:
   * "Bass - V2 - tight", "Bass - V2", "Bass_V2", "Bass V2", "Bass Take 2", "Bass_T2",
   * "V2/Bass - tight", "V2/Bass", "Take 2/Bass".
   */
  parseTake(path) {
    const stem = ImportLogic.stem(path).trim();
    const folder = ImportLogic.parentName(path).trim();
    const folderMatch = folder.match(/^(?:v|version|take|tk|t)\s*[-_ ]?\s*(\d{1,3})$/i);
    if (folderMatch) {
      // In a version folder the file is "Track" or "Track - take name".
      const m = stem.match(/^(.*?)\s+-\s+(.+)$/);
      return { track: (m ? m[1] : stem).trim() || stem, number: Number(folderMatch[1]), name: m ? m[2].trim() : '' };
    }
    const m = stem.match(/^(.*?)(?:\s*[-_ ]\s*|\s+)(?:v|version|take|tk|t)\s*[-_ ]?\s*(\d{1,3})(?:\s*[-_]\s*(.*))?$/i);
    if (m && m[1].trim()) return { track: m[1].trim(), number: Number(m[2]), name: (m[3] ?? '').trim() };
    return { track: stem, number: null, name: '' };
  },

  /**
   * Group files into tracks with versions. Pure. `paths` are absolute file paths; non-audio
   * files are left out. Returns `{ tracks: [{ name, takes: [{ number, name, path }] }], ignored }`
   * in natural track-name order, takes by number. A file without a version is V1, or the next
   * free number when its track already has numbered takes. Two files for the same version
   * keep the first and list the second as ignored.
   */
  planTakes(paths) {
    const byTrack = new Map();
    const ignored = [];
    for (const path of paths) {
      if (!ImportLogic.AUDIO.test(path)) continue;
      const t = ImportLogic.parseTake(path);
      const key = t.track.toLowerCase();
      if (!byTrack.has(key)) byTrack.set(key, { name: t.track, takes: [], plain: [] });
      const entry = byTrack.get(key);
      if (t.number == null) entry.plain.push({ path, name: '' });
      else entry.takes.push({ number: t.number, name: t.name, path });
    }
    const tracks = [];
    for (const entry of byTrack.values()) {
      const seen = new Map();
      for (const take of entry.takes.sort((a, b) => a.number - b.number)) {
        if (seen.has(take.number)) ignored.push(take.path);
        else seen.set(take.number, take);
      }
      let next = seen.size ? Math.max(...seen.keys()) + 1 : 1;
      for (const p of entry.plain.sort((a, b) => ImportLogic.naturalCompare(a.path, b.path))) {
        const number = seen.has(1) ? next : 1;
        seen.set(number, { number, name: '', path: p.path });
        next = Math.max(next, number + 1);
      }
      tracks.push({ name: entry.name, takes: [...seen.values()].sort((a, b) => a.number - b.number) });
    }
    tracks.sort((a, b) => ImportLogic.naturalCompare(a.name, b.name));
    return { tracks, ignored };
  },

  /** "01 - Song Name.wav", "1. Song", "01_Song", "Track 03 Song" -> "Song Name". Keeps names that are only a number. */
  albumTitle(path) {
    const stem = ImportLogic.stem(path).trim();
    const cleaned = stem.replace(/^(?:track\s*)?\d{1,3}\s*(?:[-_.)]\s*|\s+)/i, '').trim();
    return cleaned || stem;
  },

  /** Album files in natural order: `[{ path, title }]`. Pure. */
  planAlbum(paths) {
    return paths
      .filter((p) => ImportLogic.AUDIO.test(p))
      .sort((a, b) => ImportLogic.naturalCompare(ImportLogic.stem(a), ImportLogic.stem(b)))
      .map((path) => ({ path, title: ImportLogic.albumTitle(path) }));
  },

  // ---- LUNA ----

  async waitFor(test, ms = 8000) {
    const until = Date.now() + ms;
    for (;;) {
      if (test()) return true;
      if (Date.now() > until) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
  },

  /** Wait for the tempo map: clip lengths come from it, and a guessed tempo would cut files short. */
  async ensureTempo(session) {
    const tl = session.musical.timeline;
    if (!(await ImportLogic.waitFor(() => tl.tempoLoaded, 5000))) throw new Error('LUNA has not loaded the session’s tempo yet. Try again in a moment.');
  },

  /** The tick `seconds` after `startTick`, on the session's tempo map. */
  ticksAfter(session, startTick, seconds) {
    const tl = session.musical.timeline;
    return Math.round(tl.tickAtSeconds(tl.seconds(startTick) + seconds));
  },

  /** Seconds of a source: from LUNA's length in nanoseconds. */
  sourceSeconds(source) {
    const ns = source.length?.value;
    return typeof ns === 'number' && ns > 0 ? ns / 1e9 : 0;
  },

  /** Import a file into the session: resolves to the source, waiting until its length is known. */
  async importSource(session, path) {
    const source = await session.importPath(path);
    await ImportLogic.waitFor(() => ImportLogic.sourceSeconds(source) > 0, 15000);
    if (!(ImportLogic.sourceSeconds(source) > 0)) throw new Error(`LUNA could not read ${ImportLogic.stem(path)}`);
    return source;
  },

  /** Put a whole source on a playlist from `startTick`; resolves to the clip. */
  async placeSource(session, { trackUid, playlistUid, source, startTick, name }) {
    const stopTick = ImportLogic.ticksAfter(session, startTick, ImportLogic.sourceSeconds(source));
    return session.insertClip({
      ...(playlistUid ? { playlistUid } : { trackUid }),
      sourceUid: source.id,
      startTick,
      stopTick: Math.max(stopTick, startTick + 1),
      sourceStartNs: 0,
      sourceStopNs: source.length.value,
      name,
    });
  },

  playlistOf(session, trackUid, number) {
    return session.playlists.items.find((p) => p.trackUid.value === trackUid && p.version.value === number);
  },

  maxVersion(session, trackUid) {
    return Math.max(0, ...session.playlists.items.filter((p) => p.trackUid.value === trackUid).map((p) => p.version.value ?? 0));
  },

  /**
   * Make the tracks of a takes plan: one track per name (stereo if any take is), a version
   * per take numbered as in the file, every clip from `startTick`. Each track ends on its
   * lowest version. Runs with nothing selected, because LUNA makes a version change on a
   * selected track on every selected track. Events: `{ type: 'track', track }`, `{ type:
   * 'take', track, take }`, `{ type: 'failed', track, take?, error }`. Resolves to
   * `{ made: [names], failed: [{ track, error }] }`.
   */
  async importTakes(session, plan, { startTick = 0, onEvent = () => {}, signal = {} } = {}) {
    await ImportLogic.ensureTempo(session);
    await session.playlists.load();
    await session.playlists.membersReady();
    return VersionLogic.withNothingSelected(session, async () => {
      const made = [];
      const failed = [];
      for (const t of plan.tracks) {
        if (signal.stop) break;
        onEvent({ type: 'track', track: t });
        try {
          const sources = [];
          for (const take of t.takes) {
            if (signal.stop) break;
            sources.push({ take, source: await ImportLogic.importSource(session, take.path) });
          }
          if (signal.stop) break;
          const stereo = sources.some((s) => s.source.stemFormat.value === 'stereo');
          const [track] = await session.newTrack({ name: t.name, stemFormat: stereo ? 'stereo' : 'mono' });
          await ImportLogic.waitFor(() => ImportLogic.maxVersion(session, track.id) >= 1);
          for (const { take, source } of sources) {
            while (ImportLogic.maxVersion(session, track.id) < take.number) {
              const before = ImportLogic.maxVersion(session, track.id);
              await session.newPlaylists([track.id]);
              if (!(await ImportLogic.waitFor(() => ImportLogic.maxVersion(session, track.id) > before))) throw new Error(`LUNA did not make V${before + 1}`);
            }
            const lane = ImportLogic.playlistOf(session, track.id, take.number);
            if (!lane) throw new Error(`no V${take.number} on ${t.name}`);
            await ImportLogic.placeSource(session, { playlistUid: lane.id, source, startTick, name: ImportLogic.stem(take.path) });
            onEvent({ type: 'take', track: t, take });
          }
          const first = t.takes[0]?.number ?? 1;
          if (ImportLogic.maxVersion(session, track.id) > 1) {
            await session.setPlaylist(track.id, first);
            await ImportLogic.waitFor(() => VersionLogic.activeNumber(session, track.id) === first, 3000);
          }
          made.push(t.name);
        } catch (error) {
          failed.push({ track: t.name, error });
          onEvent({ type: 'failed', track: t, error });
        }
      }
      return { made, failed };
    });
  },

  /**
   * Make an album: each file on its own track, one after another from `startTick` with
   * `gapSeconds` between them, and a marker named after each file at its start when
   * `markers` is on. Events: `{ type: 'song', item, index }`, `{ type: 'failed', item, error }`.
   * Resolves to `{ placed: [{ title, startTick, stopTick }], failed }`.
   */
  async importAlbum(session, items, { startTick = 0, gapSeconds = 2, markers = true, onEvent = () => {}, signal = {} } = {}) {
    await ImportLogic.ensureTempo(session);
    const placed = [];
    const failed = [];
    let at = startTick;
    for (let i = 0; i < items.length; i++) {
      if (signal.stop) break;
      const item = items[i];
      try {
        const source = await ImportLogic.importSource(session, item.path);
        const [track] = await session.newTrack({ name: item.title, stemFormat: source.stemFormat.value === 'stereo' ? 'stereo' : 'mono' });
        const clip = await ImportLogic.placeSource(session, { trackUid: track.id, source, startTick: at, name: item.title });
        const stopTick = clip.stop?.value ?? ImportLogic.ticksAfter(session, at, ImportLogic.sourceSeconds(source));
        if (markers) await session.addMarker(at, item.title);
        placed.push({ title: item.title, startTick: at, stopTick });
        onEvent({ type: 'song', item, index: i });
        at = ImportLogic.ticksAfter(session, stopTick, gapSeconds);
      } catch (error) {
        failed.push({ item, error });
        onEvent({ type: 'failed', item, error });
      }
    }
    return { placed, failed };
  },
};

const SortLogic = {
  /** Folder path -> words. First the deepest folders, so "bass drum" finds Kick before Bass. */
  DEFAULT_RULES: [
    { folder: 'Drums/Kick', words: 'kick, kik, bd, bass drum' },
    { folder: 'Drums/Sn', words: 'snare, sn, snr' },
    { folder: 'Drums/Tom', words: 'tom, toms, floor tom, ft, rack' },
    { folder: 'Drums', words: 'drum, drums, kit, oh, overhead, overheads, hh, hat, hihat, hi-hat, ride, crash, cymbal, room, rooms, perc' },
    { folder: 'Bass', words: 'bass, db, sub bass, upright' },
    { folder: 'Guitars', words: 'gtr, guitar, guitars, gt, git, acoustic, ac gtr, el gtr' },
    { folder: 'Keys', words: 'keys, key, piano, pno, rhodes, wurli, wurlitzer, organ, hammond, b3, synth, synths, clav, mellotron, arturia, keyboard' },
    { folder: 'Vocals', words: 'vox, vocal, vocals, voc, vx, lead, bv, bvs, backing, harmony, harmonies, choir, adlib' },
  ],

  words(rule) {
    return String(rule.words ?? '')
      .split(/[,;\n]+/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
  },

  /** "Drums / Kick " -> ["Drums", "Kick"]. */
  pathParts(folder) {
    return String(folder ?? '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
  },

  /**
   * Where a word starts in a track name, or -1. It must start a word ("SN TOP1" has "sn",
   * "Snapper" has no "sn" word, "Kick2" has "kick"), and may be followed by digits.
   */
  wordAt(name, word) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]*');
    const m = new RegExp(`(^|[^a-z0-9])${esc}(?:\\d*)(?=$|[^a-z])`, 'i').exec(String(name ?? ''));
    return m ? m.index + m[1].length : -1;
  },

  hasWord(name, word) {
    return SortLogic.wordAt(name, word) >= 0;
  },

  /**
   * The rule a track name matches: the deepest folder ("Bass Drum" is Kick, not Bass); between
   * folders at the same depth, the word that comes first in the name ("Hammond Room" is Keys);
   * then the list's order.
   */
  match(name, rules) {
    let best = null;
    rules.forEach((r, i) => {
      const depth = SortLogic.pathParts(r.folder).length;
      if (!depth) return;
      const hits = SortLogic.words(r).map((w) => SortLogic.wordAt(name, w)).filter((x) => x >= 0);
      if (!hits.length) return;
      const at = Math.min(...hits);
      if (!best || depth > best.depth || (depth === best.depth && (at < best.at || (at === best.at && i < best.i)))) best = { r, depth, at, i };
    });
    return best?.r ?? null;
  },

  /**
   * The session's folders as `[{ id, name, path: ["Drums", "Kick"], parentId }]`, walking
   * folders inside folders.
   */
  folders(session) {
    const out = [];
    const walk = (folder, path) => {
      for (const ch of session.folderContents(folder)) {
        if (ch instanceof Luna.Bus && ch.isFolder) {
          const p = [...path, (ch.name.value ?? '').trim()];
          out.push({ id: ch.id, name: p[p.length - 1], path: p, parentId: folder?.id ?? null });
          walk(ch, p);
        }
      }
    };
    walk(null, []);
    return out;
  },

  /**
   * The folder a rule's path names: the folder whose path ends with it ("Kick" finds
   * Drums/Kick; "Drums/Kick" needs Kick inside Drums), case ignored; the shortest such path.
   */
  findFolder(folders, folderPath) {
    const want = SortLogic.pathParts(folderPath).map((s) => s.toLowerCase());
    if (!want.length) return null;
    const hits = folders.filter((f) => {
      if (f.path.length < want.length) return false;
      const tail = f.path.slice(f.path.length - want.length).map((s) => s.toLowerCase());
      return tail.every((s, i) => s === want[i]);
    });
    return hits.sort((a, b) => a.path.length - b.path.length)[0] ?? null;
  },

  /**
   * What Sort would do. Pure. `tracks`: `[{ id, name, folderId }]` in session order;
   * `folders` from {@link folders}. With `onlyLoose`, tracks already in a folder are left
   * where they are. Returns `[{ id, name, from, rule, folder, missing }]` per track:
   * `folder` the target (`{ id, path }`) or null, `missing` the rule's folder path when the
   * session has no such folder.
   */
  plan(tracks, folders, rules, { onlyLoose = true } = {}) {
    return tracks.map((t) => {
      const from = t.folderId ? folders.find((f) => f.id === t.folderId) ?? null : null;
      const base = { id: t.id, name: t.name, from, rule: null, folder: null, missing: null };
      if (onlyLoose && t.folderId) return base;
      const rule = SortLogic.match(t.name, rules);
      if (!rule) return base;
      const folder = SortLogic.findFolder(folders, rule.folder);
      if (!folder) return { ...base, rule, missing: SortLogic.pathParts(rule.folder).join('/') };
      if (folder.id === t.folderId) return { ...base, rule }; // already there
      return { ...base, rule, folder };
    });
  },

  /** The tracks a user sees, with the folder each is in: `[{ id, name, folderId }]`. */
  readTracks(session) {
    return session.visibleTracks.map((t) => ({ id: t.id, name: (t.name.value ?? '').trim(), folderId: t.folderUid?.value || null }));
  },

  /**
   * Make the folders a rule list names that the session lacks, inside each other as the
   * paths say (summing folders, as LUNA's own). Resolves to the paths made.
   */
  async makeFolders(session, paths) {
    const made = [];
    for (const path of paths) {
      const parts = SortLogic.pathParts(path);
      let parent = null;
      for (let i = 0; i < parts.length; i++) {
        const sub = parts.slice(0, i + 1).join('/');
        const found = SortLogic.findFolder(SortLogic.folders(session), sub);
        const here = found && (i === 0 ? found.path.length === 1 : found.parentId === parent) ? found : null;
        if (here) {
          parent = here.id;
          continue;
        }
        // LUNA puts a new folder first inside its parent; keep the rules' order instead by
        // moving it after what the parent already holds.
        const before = parent ? session.folderContents(parent) : [];
        const f = await session.newFolder({ name: parts[i], ...(parent ? { folderUid: parent } : {}) });
        const last = before[before.length - 1];
        if (last) await session.reorder([f.id], { after: last.id }).catch(() => {});
        made.push(sub);
        parent = f.id;
      }
    }
    return made;
  },

  /** The tracks inside a folder, its folders' tracks included, in session order. */
  tracksIn(session, folderId) {
    const inside = (id) => {
      for (let f = id, n = 0; f && n < 64; n++) {
        if (f === folderId) return true;
        f = session.buses.byId(f)?.folderUid.value || null;
      }
      return false;
    };
    return session.visibleTracks.filter((t) => inside(t.folderUid?.value || null)).map((t) => t.id);
  },

  /**
   * Select every track in a folder (and its folders), so one LUNA group command groups them.
   * Resolves to how many were selected.
   */
  async selectFolder(session, folderId) {
    const ids = SortLogic.tracksIn(session, folderId);
    await session.context.load().catch(() => {});
    await session.context.select({ trackUids: ids });
    return ids.length;
  },

  /**
   * Move the planned tracks into their folders, after what is already in each folder, keeping
   * the tracks' order. One move per folder. Resolves to `{ moved: n, failed: [{ path, error }] }`.
   */
  async apply(session, moves) {
    const byFolder = new Map();
    for (const m of moves) {
      if (!m.folder) continue;
      if (!byFolder.has(m.folder.id)) byFolder.set(m.folder.id, { folder: m.folder, ids: [] });
      byFolder.get(m.folder.id).ids.push(m.id);
    }
    let moved = 0;
    const failed = [];
    for (const { folder, ids } of byFolder.values()) {
      try {
        const inside = session.folderContents(folder.id);
        const last = inside[inside.length - 1];
        await session.moveToFolder(ids, folder.id, { after: last ? last.id : folder.id });
        moved += ids.length;
      } catch (error) {
        failed.push({ path: folder.path.join('/'), error });
      }
    }
    return { moved, failed };
  },
};

globalThis.ImportLogic = ImportLogic;
globalThis.SortLogic = SortLogic;
