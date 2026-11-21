// Import/Export: logic with no DOM, so tests can exercise it against Luna.MockEngine.
//
// LUNA keeps each take of a track as a playlist "version" (V1, V2, ... in the VERSIONS
// column; the user may rename them). This exports every version of every track as a raw file
// (before the track's plugins and fader), all from the same start to the same end, so they line
// up in any DAW. Tracks with one version are exported once. Each track is put back on the
// version it was on.

const VersionLogic = {
  /** Shown in the window, so it is clear which version LUNA has loaded. Keep in step with manifest.json. */
  VERSION: '0.3.0',
  ADD_ON_ID: 'com.audioplanet.version_export',

  // ---- names ----

  /** A file name safe on macOS and Windows. */
  safeFileName(name) {
    let n = String(name ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '');
    if (!n) n = 'Untitled';
    return n.slice(0, 120);
  },

  joinPath(folder, file) {
    return `${folder.replace(/[\\/]+$/, '')}/${file}`;
  },

  /** True when a version still has LUNA's own name ("V3"), not one the user gave it. */
  isDefaultName(name, number) {
    const n = String(name ?? '').trim();
    return !n || n.toUpperCase() === `V${number}`;
  },

  /** "V3", or "V3 - groove take" when the user named it. */
  versionLabel(v) {
    return VersionLogic.isDefaultName(v.name, v.number) ? `V${v.number}` : `V${v.number} - ${String(v.name).trim()}`;
  },

  // ---- reading the session ----

  /**
   * Every audio and instrument track with its versions, read from LUNA:
   * `[{ id, name, active, versions: [{ number, name, playlistId, clips: [{ start, stop }] }] }]`,
   * versions in number order; muted clips are left out (they make no sound).
   */
  async readTracks(session) {
    await session.playlists.load();
    await session.playlists.membersReady();
    const out = [];
    for (const track of session.visibleTracks) {
      const type = track.trackType.value;
      if (type !== 'audio' && type !== 'instrument') continue;
      const lists = session.playlists.items
        .filter((p) => p.trackUid.value === track.id)
        .sort((a, b) => (a.version.value ?? 0) - (b.version.value ?? 0));
      const versions = [];
      for (const p of lists) {
        await p.clips.load();
        await p.clips.membersReady();
        const clips = p.clips.items
          .filter((c) => !c.muted.value && typeof c.start.value === 'number' && typeof c.stop.value === 'number' && c.stop.value > c.start.value)
          .map((c) => ({ start: c.start.value, stop: c.stop.value }));
        versions.push({ number: p.version.value, name: p.name.value ?? '', playlistId: p.id, clips });
      }
      const active = lists.find((p) => p.id === track.playlistUid.value)?.version.value;
      out.push({ id: track.id, name: (track.name.value ?? '').trim() || 'Track', active, versions });
    }
    return out;
  },

  // ---- planning ----

  /**
   * What to bounce. Pure. `tracks` as readTracks gives them; `barOneTick` is where bar 1 is.
   * `mode` is 'names' (one folder, "Bass - V3.wav") or 'folders' ("V3/Bass.wav").
   * Returns `{ start, end, renders: [{ number, items: [{ trackId, trackName, number, label,
   * fileName, subfolder }] }], skipped: [names] }`, or `end: null` when nothing has clips.
   * Versions without clips are left out; a track with clips on only one version is exported
   * once, without a version in its name. Every file covers the same start and end.
   * `off` lists track ids the user unticked: they are left out, but the range still covers
   * every track, so files exported now and later line up and have the same length.
   */
  plan(tracks, barOneTick, mode = 'names', off = []) {
    const withClips = tracks.map((t) => ({ ...t, versions: t.versions.filter((v) => v.clips.length) }));
    const all = withClips.flatMap((t) => t.versions.flatMap((v) => v.clips));
    if (!all.length) return { start: barOneTick, end: null, renders: [], skipped: tracks.map((t) => t.name), unticked: [] };
    const start = Math.min(barOneTick, ...all.map((c) => c.start));
    const end = Math.max(...all.map((c) => c.stop));
    const byNumber = new Map();
    const used = new Map();
    const unique = (folder, file) => {
      const key = `${folder}/${file}`.toLowerCase();
      const n = (used.get(key) ?? 0) + 1;
      used.set(key, n);
      return n === 1 ? file : `${file} (${n})`;
    };
    const skipped = [];
    const unticked = [];
    const offSet = new Set(off);
    for (const t of withClips) {
      if (t.versions.length && offSet.has(t.id)) {
        unticked.push(t.name);
        continue;
      }
      if (!t.versions.length) {
        skipped.push(t.name);
        continue;
      }
      const single = t.versions.length === 1;
      for (const v of t.versions) {
        const label = VersionLogic.versionLabel(v);
        const track = VersionLogic.safeFileName(t.name);
        let subfolder = '';
        let stem;
        if (single) stem = track;
        else if (mode === 'folders') {
          subfolder = `V${v.number}`;
          stem = VersionLogic.isDefaultName(v.name, v.number) ? track : `${track} - ${VersionLogic.safeFileName(String(v.name).trim())}`;
        } else stem = `${track} - ${VersionLogic.safeFileName(label)}`;
        const fileName = `${unique(subfolder, stem)}.wav`;
        if (!byNumber.has(v.number)) byNumber.set(v.number, []);
        byNumber.get(v.number).push({ trackId: t.id, trackName: t.name, number: v.number, label, fileName, subfolder, single });
      }
    }
    const renders = [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([number, items]) => ({ number, items }));
    return { start, end, renders, skipped, unticked };
  },

  /** The subfolders a plan writes to ('' is the chosen folder itself). */
  subfolders(plan) {
    return [...new Set(plan.renders.flatMap((r) => r.items.map((i) => i.subfolder)).filter(Boolean))];
  },

  // ---- LUNA helpers (shared with Song Bounce) ----

  /**
   * Run `fn` with no tracks selected, then give the user's selection back. With LUNA's
   * selection grouping on, a change to one selected track is made to every selected track.
   */
  async withNothingSelected(session, fn) {
    const ctx = session.context;
    await ctx.load().catch(() => {});
    const saved = ctx.snapshot();
    await ctx.select({ trackUids: [], playlistUids: [] });
    try {
      return await fn();
    } finally {
      await ctx.restore(saved).catch(() => {});
    }
  },

  async waitFor(test, ms = 3000) {
    const until = Date.now() + ms;
    for (;;) {
      if (test()) return true;
      if (Date.now() > until) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
  },

  /** The active version number of a track, as LUNA reports it now. */
  activeNumber(session, trackId) {
    const track = session.tracks.byId(trackId);
    return session.playlists.byId(track?.playlistUid.value)?.version.value;
  },

  /** Switch tracks to versions: `{ [trackId]: number }`. Resolves to the track names that did not switch. */
  async setVersions(session, wanted) {
    for (const [id, number] of Object.entries(wanted)) {
      if (VersionLogic.activeNumber(session, id) !== number) await session.setPlaylist(id, number);
    }
    const ok = () => Object.entries(wanted).every(([id, n]) => VersionLogic.activeNumber(session, id) === n);
    await VersionLogic.waitFor(ok);
    return Object.entries(wanted)
      .filter(([id, n]) => VersionLogic.activeNumber(session, id) !== n)
      .map(([id]) => session.tracks.byId(id)?.name.value ?? id);
  },

  RENDER_POLL_MS: 2000,

  /** Resolve when a render has completed; reject when aborted or failed. See Song Bounce. */
  waitForRender(render) {
    return new Promise((resolve, reject) => {
      let over = false;
      const end = (fn, v) => {
        if (over) return;
        over = true;
        clearInterval(timer);
        fn(v);
      };
      const check = () => {
        const s = render.state.value;
        if (s === 'completed') end(resolve);
        else if (s === 'aborted' || s === 'failed') {
          const msg = render.errorMessage.value;
          end(reject, Object.assign(new Error(`bounce ${s}${msg ? `: ${msg}` : ''}`), { code: s }));
        }
      };
      render.done(6 * 60 * 60 * 1000).then(
        () => end(resolve),
        (e) => (e?.code === 'removed' ? end(resolve) : end(reject, e)),
      );
      const timer = setInterval(async () => {
        try {
          await render.reload();
          check();
        } catch {
          end(resolve); // the node is gone: the render settled and was dropped
        }
      }, VersionLogic.RENDER_POLL_MS);
      check();
    });
  },

  /** `verify(path)` with a few retries, for a file system that is slow to show a new file. */
  async verifyFile(verify, path, tries = 4) {
    for (let i = 0; i < tries; i++) {
      if (await verify(path)) return true;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
    return false;
  },

  /** Whether a folder exists, asked through LUNA: true, false, or null when LUNA cannot tell. */
  async folderExists(luna, path) {
    try {
      await luna.gui.serveMediaFile(VersionLogic.ADD_ON_ID, path);
      return false; // a file, not a folder
    } catch (e) {
      if (e?.code === 'uasrv.invalid_value') return true;
      if (e?.code === 'uasrv.filesystem_error') return false;
      return null;
    }
  },

  parentFolder(path) {
    const i = path.replace(/[\\/]+$/, '').lastIndexOf('/');
    return i > 0 ? path.slice(0, i) : '/';
  },

  // ---- exporting ----

  /**
   * Export a plan into `folder`. For each version number, switch the tracks that have it to it
   * and bounce them all raw ('pre_effects': before plugins and fader) in one render, one file
   * per track. Afterwards every track is put back on the version it was on. Nothing is
   * selected while versions change. `onSnapshot({ [trackId]: number })` is called before
   * anything changes and `onSnapshot(null)` once put back, for a crash-safe restore.
   * Events: `{ type: 'render', render: r }`, `progress`, `done` (per file, with `path`),
   * `failed` (per file, with `error`), `stopped`. Resolves to
   * `{ written: [paths], failed: [{ item, error }], notRestored: [names] }`.
   */
  async exportPlan(session, plan, folder, { onEvent = () => {}, signal = {}, verify, onSnapshot = () => {} } = {}) {
    return VersionLogic.withNothingSelected(session, async () => {
      const ids = [...new Set(plan.renders.flatMap((r) => r.items.map((i) => i.trackId)))];
      const original = {};
      for (const id of ids) original[id] = VersionLogic.activeNumber(session, id);
      onSnapshot(original);
      const written = [];
      const failed = [];
      let notRestored = [];
      try {
        for (const r of plan.renders) {
          if (signal.stop) {
            onEvent({ type: 'stopped', render: r });
            break;
          }
          onEvent({ type: 'render', render: r });
          const fail = (items, error) => {
            for (const item of items) {
              failed.push({ item, error });
              onEvent({ type: 'failed', item, error });
            }
          };
          const wanted = Object.fromEntries(r.items.map((i) => [i.trackId, i.number]));
          const stuck = await VersionLogic.setVersions(session, wanted);
          if (stuck.length) {
            fail(r.items, new Error(`could not switch ${stuck.join(', ')} to V${r.number}`));
            continue;
          }
          const paths = r.items.map((i) => VersionLogic.joinPath(i.subfolder ? VersionLogic.joinPath(folder, i.subfolder) : folder, i.fileName));
          try {
            const { render } = await session.bounce({
              channelUids: r.items.map((i) => i.trackId),
              name: `Import/Export V${r.number}`,
              outputPaths: paths,
              recordPoint: 'pre_effects',
              range: { startTick: plan.start, stopTick: plan.end },
            });
            signal.render = render;
            const off = render.progress.onChange(() => onEvent({ type: 'progress', render: r, progress: render.progress.value ?? 0 }));
            try {
              await VersionLogic.waitForRender(render);
            } finally {
              off();
              signal.render = null;
            }
          } catch (error) {
            fail(r.items, error);
            continue;
          }
          for (let k = 0; k < paths.length; k++) {
            const item = r.items[k];
            // Once one file is missing, check the rest of this render once each, not with retries.
            if (verify && !(await VersionLogic.verifyFile(verify, paths[k], signal.stop ? 1 : 4))) {
              const error = Object.assign(new Error(`LUNA did not write ${item.fileName}. Check the folder exists: LUNA does not create folders.`), { code: 'not_written' });
              fail([item], error);
              signal.stop = true;
            } else {
              written.push(paths[k]);
              onEvent({ type: 'done', item, path: paths[k] });
            }
          }
        }
      } finally {
        notRestored = await VersionLogic.setVersions(session, Object.fromEntries(Object.entries(original).filter(([, n]) => typeof n === 'number')));
        if (!notRestored.length) onSnapshot(null);
      }
      return { written, failed, notRestored };
    });
  },

  /** Put tracks back on saved versions (after a crash), with nothing selected. */
  async restoreVersions(session, saved) {
    return VersionLogic.withNothingSelected(session, () =>
      VersionLogic.setVersions(session, Object.fromEntries(Object.entries(saved).filter(([id, n]) => session.tracks.byId(id) && typeof n === 'number'))),
    );
  },
};

globalThis.VersionLogic = VersionLogic;
