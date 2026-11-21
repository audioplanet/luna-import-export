// Version Export: the window. Connects to LUNA, follows the focused session, shows every
// track's versions and what will be exported, and runs the export. Engine work is in logic.js.

const $ = (id) => document.getElementById(id);
const V = VersionLogic;
const STORE = 'com.audioplanet.version_export';

let luna;
let session = null;
let tracks = [];
let plan = null;
let off = []; // track ids the user unticked, kept per session
let folder = '';
let running = null; // { signal } while exporting
const fileStatus = new Map(); // `${trackId}|${number}` -> 'ok' | 'err' | 'now'
let releases = [];

function read(key, fallback) {
  try {
    const v = localStorage.getItem(`${STORE}.${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(`${STORE}.${key}`);
    else localStorage.setItem(`${STORE}.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
function log(text, isError = false) {
  const line = document.createElement('div');
  if (isError) line.className = 'err';
  line.textContent = `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}  ${text}`;
  $('log').prepend(line);
  while ($('log').childElementCount > 200) $('log').lastChild.remove();
}
const mode = () => document.querySelector('input[name=mode]:checked')?.value ?? 'names';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function fmtLength(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.round(seconds - m * 60)).padStart(2, '0')}`;
}
const fileCount = () => (plan ? plan.renders.reduce((n, r) => n + r.items.length, 0) : 0);

// ---- rendering ----

function render() {
  const body = $('rows');
  body.innerHTML = '';
  const items = new Map(); // trackId -> plan items
  for (const r of plan?.renders ?? []) for (const i of r.items) (items.get(i.trackId) ?? items.set(i.trackId, []).get(i.trackId)).push(i);
  for (const t of tracks) {
    const mine = items.get(t.id) ?? [];
    const unticked = off.includes(t.id);
    const hasClips = t.versions.some((x) => x.clips.length);
    const tr = document.createElement('tr');
    tr.className = !hasClips ? 'skip' : unticked ? 'off' : '';
    tr.innerHTML = '<td class="pick"><input type="checkbox"></td><td class="tname"></td><td class="vers"></td><td class="num"></td>';
    const box = tr.querySelector('input');
    box.checked = hasClips && !unticked;
    box.disabled = !hasClips || !!running;
    box.onchange = () => setTicked([t.id], box.checked);
    tr.querySelector('.tname').textContent = t.name;
    const cell = tr.querySelector('.vers');
    if (!hasClips) cell.textContent = 'no clips: skipped';
    else if (unticked) cell.textContent = 'not exported';
    else if (mine.length === 1 && mine[0].single) {
      cell.textContent = `one version: ${mine[0].fileName}`;
      const st = fileStatus.get(`${t.id}|${mine[0].number}`);
      if (st) cell.prepend(Object.assign(document.createElement('span'), { className: `chip ${st}`, textContent: { ok: '✓', err: '✕', now: '…' }[st] }));
    } else {
      for (const i of mine) {
        const chip = document.createElement('span');
        const st = fileStatus.get(`${t.id}|${i.number}`);
        chip.className = `chip ${st ?? ''}`;
        chip.textContent = `${i.label}${st === 'ok' ? ' ✓' : st === 'err' ? ' ✕' : ''}${i.number === t.active ? ' •' : ''}`;
        chip.title = (i.subfolder ? `${i.subfolder}/` : '') + i.fileName + (i.number === t.active ? ' (active now)' : '');
        cell.appendChild(chip);
      }
    }
    tr.querySelector('.num').textContent = mine.length || '';
    body.appendChild(tr);
  }
  $('table').hidden = !tracks.length;
  $('empty').hidden = !!tracks.length || !session;
  $('empty').textContent = 'No audio or instrument tracks in this session.';

  const n = fileCount();
  let summary = '';
  if (plan?.end != null && session) {
    const tl = session.musical.timeline;
    let len = '';
    try {
      len = ` · ${fmtLength(tl.seconds(plan.end) - tl.seconds(plan.start))} each`;
    } catch {
      /* tempo map loading */
    }
    const multi = new Set(plan.renders.flatMap((r) => r.items.filter((i) => !i.single).map((i) => i.trackId))).size;
    summary = `${plural(n, 'file')} · ${plural(multi, 'track')} with versions${len}`;
    if (plan.unticked?.length) summary += ` · ${plan.unticked.length} unticked`;
  } else if (session) summary = 'Nothing to export: no clips.';
  $('summary').textContent = summary;
  const busy = !!running;
  $('export').disabled = busy || !session || !folder || !n;
  $('export').textContent = n ? `Export ${plural(n, 'file')}` : 'Export';
  $('stop').disabled = !busy;
  for (const id of ['refresh', 'choose', 'all', 'none']) $(id).disabled = busy || !session;
  for (const r of document.querySelectorAll('input[name=mode]')) r.disabled = busy;
  $('reveal').disabled = !folder;
  $('folder').textContent = folder || 'choose a folder';
  $('folder').title = folder;
}

async function barOne() {
  try {
    return session.musical.timeline.tickAt({ bar: 1 });
  } catch {
    return 0;
  }
}

let refreshTimer;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 300);
}
async function refresh() {
  if (!session || running) return;
  const s = session;
  try {
    const t = await V.readTracks(s);
    if (s !== session) return;
    tracks = t;
    plan = V.plan(tracks, await barOne(), mode(), off);
    render();
  } catch (e) {
    log(`Could not read the tracks: ${e.message}`, true);
  }
}

// ---- picking tracks ----

function setTicked(ids, on) {
  if (!session || running) return;
  const set = new Set(off);
  for (const id of ids) on ? set.delete(id) : set.add(id);
  // Forget ids of tracks that are gone, so the list stays small.
  const known = new Set(tracks.map((t) => t.id));
  off = [...set].filter((id) => known.has(id));
  write(`off.${session.uid}`, off.length ? off : null);
  refresh();
}

// ---- folders ----

async function ensureFolder(path, what) {
  if (!(await luna.gui.available())) return path;
  if ((await V.folderExists(luna, path)) !== false) return path;
  const name = path.replace(/[\\/]+$/, '').split('/').pop();
  let start = V.parentFolder(path);
  while (start !== '/' && (await V.folderExists(luna, start)) === false) start = V.parentFolder(start);
  log(`${what}: “${name}” doesn’t exist. Make it with New Folder, or pick another folder.`, true);
  const [picked] = await luna.gui.chooseFolders({ title: `“${name}” doesn’t exist yet: use New Folder to make it`, defaultPath: start });
  return picked || null;
}

async function chooseFolder() {
  try {
    if (!(await luna.gui.available())) return log('Choosing a folder needs LUNA’s window: open Version Export from LUNA’s Add Ons menu.', true);
    const [picked] = await luna.gui.chooseFolders({ title: 'Export versions to…', defaultPath: folder || undefined });
    if (!picked || !session) return;
    folder = picked;
    write(`folder.${session.uid}`, folder);
    render();
  } catch (e) {
    log(`Could not choose a folder: ${e.message}`, true);
  }
}

// ---- exporting ----

function pendingKey() {
  return session ? `pending.${session.uid}` : null;
}
function showBanner() {
  $('banner').hidden = !(session && read(pendingKey(), null) && !running);
}

async function doExport() {
  if (!session || running) return;
  await refresh();
  if (!plan || plan.end == null || !fileCount()) return;

  const f = await ensureFolder(folder, 'Folder');
  if (!f) return log('Export cancelled: no folder chosen.', true);
  if (f !== folder) {
    folder = f;
    write(`folder.${session.uid}`, folder);
  }
  for (const sub of V.subfolders(plan)) {
    const want = V.joinPath(folder, sub);
    const got = await ensureFolder(want, `Folder for ${sub}`);
    if (!got) return log('Export cancelled: no folder chosen.', true);
    if (got !== want) return log(`Please name the new folder exactly “${sub}” inside ${folder}, then export again.`, true);
  }

  const signal = {};
  running = { signal };
  fileStatus.clear();
  $('prog').hidden = false;
  showBanner();
  render();
  const total = fileCount();
  log(`Exporting ${plural(total, 'file')} to ${folder}`);
  const started = Date.now();
  const gui = await luna.gui.available();
  const pk = pendingKey();
  let done = 0;
  try {
    const out = await V.exportPlan(session, plan, folder, {
      signal,
      verify: gui ? (path) => luna.gui.serveMediaFile(V.ADD_ON_ID, path).then(() => true, () => false) : undefined,
      onSnapshot: (snap) => write(pk, snap),
      onEvent: (e) => {
        if (e.type === 'render') {
          for (const i of e.render.items) fileStatus.set(`${i.trackId}|${i.number}`, 'now');
          log(`— V${e.render.number}: ${plural(e.render.items.length, 'track')}`);
        } else if (e.type === 'progress') {
          $('prog').value = (done + e.progress * 0.999) / Math.max(1, plan.renders.length);
          return;
        } else if (e.type === 'done') {
          fileStatus.set(`${e.item.trackId}|${e.item.number}`, 'ok');
          log((e.item.subfolder ? `${e.item.subfolder}/` : '') + e.item.fileName);
        } else if (e.type === 'failed') {
          fileStatus.set(`${e.item.trackId}|${e.item.number}`, 'err');
          log(`${e.item.trackName} ${e.item.label}: ${e.error?.message ?? e.error}`, true);
        }
        if (e.type === 'done' || e.type === 'failed') done = plan.renders.findIndex((r) => r.items.includes(e.item)) + 1;
        render();
      },
    });
    if (out.notRestored.length) log(`Could not put back the versions of ${out.notRestored.join(', ')}. Use Restore versions.`, true);
    log(`${out.written.length} of ${plural(total, 'file')} exported in ${fmtLength((Date.now() - started) / 1000)}`, out.written.length < total);
  } catch (e) {
    log(`Export stopped: ${e.message}`, true);
  } finally {
    running = null;
    $('prog').hidden = true;
    showBanner();
    render();
  }
}

function stop() {
  if (!running) return;
  running.signal.stop = true;
  running.signal.render?.abort().catch(() => {});
  log('Stopping…');
}

async function restorePending() {
  const saved = session && read(pendingKey(), null);
  if (!saved) return showBanner();
  try {
    const stuck = await V.restoreVersions(session, saved);
    if (stuck.length) log(`Could not put back: ${stuck.join(', ')}.`, true);
    else {
      write(pendingKey(), null);
      log('Tracks are back on the versions they were on.');
    }
  } catch (e) {
    log(`Restore failed: ${e.message}`, true);
  }
  showBanner();
  refresh();
}

// ---- session ----

let bindQueue = Promise.resolve();
function bindSession() {
  bindQueue = bindQueue.then(bindSessionNow, bindSessionNow);
  return bindQueue;
}
async function bindSessionNow() {
  const next = luna.sessions.current();
  if (next && next === session) return;
  for (const off of releases) off();
  releases = [];
  session = next;
  tracks = [];
  off = [];
  plan = null;
  fileStatus.clear();
  if (!session) {
    $('session').textContent = 'no session open';
    folder = '';
    render();
    showBanner();
    return;
  }
  const s = session;
  await s.ready();
  if (s !== session) return;
  $('session').textContent = s.name.value ?? '';
  let exp = '';
  try {
    const r = await luna.raw.get(`/sessions/${s.uid}`, { propfilter: 'export_folder_path', children: false, commands: false, flatvalue: true });
    exp = r?.properties?.export_folder_path ?? '';
  } catch {
    /* no export folder known */
  }
  folder = read(`folder.${s.uid}`, '') || exp;
  off = read(`off.${s.uid}`, []);
  showBanner();
  releases.push(s.tracks.onChange(refreshSoon));
  releases.push(s.playlists.onChange(refreshSoon));
  await refresh();
}

async function connect() {
  $('ver').textContent = `v${V.VERSION}`;
  const m = read('mode', 'names');
  for (const r of document.querySelectorAll('input[name=mode]')) {
    r.checked = r.value === m;
    r.onchange = () => {
      write('mode', mode());
      refresh();
    };
  }
  $('export').onclick = doExport;
  $('stop').onclick = stop;
  $('refresh').onclick = refresh;
  $('all').onclick = () => setTicked(tracks.map((t) => t.id), true);
  $('none').onclick = () => setTicked(tracks.map((t) => t.id), false);
  $('choose').onclick = chooseFolder;
  $('reveal').onclick = async () => {
    if (folder && (await luna.gui.available())) luna.gui.revealPath(folder).catch(() => {});
  };
  $('restoreBtn').onclick = restorePending;
  $('forgetBtn').onclick = () => {
    write(pendingKey(), null);
    showBanner();
  };
  render();
  for (;;) {
    try {
      luna = await Luna.connect();
      break;
    } catch (e) {
      $('session').textContent = e instanceof Luna.NotRunning ? 'waiting for LUNA…' : e.message;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts(luna);
  luna.status.onChange(() => {
    if (luna.status.value === 'disconnected') $('session').textContent = 'reconnecting…';
    if (luna.status.value === 'connected') {
      session = null;
      bindSession();
    }
  });
  await luna.sessions.ready();
  luna.sessions.focused.onChange(bindSession);
  luna.sessions.items.onChange(bindSession);
  await bindSession();
}

connect();
