// Import/Export: the Import and Sort tabs. Uses main.js's `luna`, `session`, `running`, `log`,
// `read`, `write`, `render` and `plural`; the engine work is in importer.js.

const Panels = (() => {
  const IL = ImportLogic;
  const SL = SortLogic;

  // ---- tabs ----

  let tab = read('tab', 'export');
  function showTab(name) {
    tab = ['export', 'import', 'sort'].includes(name) ? name : 'export';
    write('tab', tab);
    for (const b of document.querySelectorAll('nav button')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const id of ['export', 'import', 'sort']) $(`tab-${id}`).hidden = id !== tab;
    if (tab === 'sort') sortRefresh();
  }

  function busy() {
    return !!running;
  }
  function setBusy(job) {
    running = job;
    render(); // the Export tab
    importRender();
    sortRender();
  }

  // ---- import ----

  let files = []; // absolute paths
  let sourceLabel = '';
  const imode = () => document.querySelector('input[name=imode]:checked')?.value ?? 'takes';

  async function collect(paths) {
    const out = [];
    for (const p of paths) {
      if (IL.AUDIO.test(p)) {
        out.push(p);
        continue;
      }
      try {
        const { files: all, truncated } = await luna.gui.listAllFiles(p);
        for (const f of all) if (!f.isDirectory && IL.AUDIO.test(f.name)) out.push(f.path);
        if (truncated) log(`${p} has too many files: only the first ones are listed.`, true);
      } catch (e) {
        if (e?.code === 'uasrv.not_permitted') log(`LUNA did not allow reading ${p}. Choose it again and click Allow, or add it in Settings > Add Ons > FOLDERS.`, true);
        else if (e?.code !== 'uasrv.invalid_value') log(`Could not read ${p}: ${e.message}`, true);
      }
    }
    return [...new Set(out)];
  }

  async function setFiles(paths, label) {
    files = await collect(paths);
    sourceLabel = files.length ? `${plural(files.length, 'audio file')} ${label}` : 'no audio files there';
    importRender();
  }

  async function chooseFolder() {
    try {
      if (!(await luna.gui.available())) return log('Choosing needs LUNA’s window: open Import/Export from LUNA’s Add Ons menu.', true);
      const [folder] = await luna.gui.chooseFolders({ title: 'Import the audio files in…', defaultPath: read('importFrom', undefined) });
      if (!folder) return;
      write('importFrom', folder);
      await setFiles([folder], `in ${folder.split('/').pop()}`);
    } catch (e) {
      log(`Could not choose a folder: ${e.message}`, true);
    }
  }

  async function chooseFiles() {
    try {
      if (!(await luna.gui.available())) return log('Choosing needs LUNA’s window: open Import/Export from LUNA’s Add Ons menu.', true);
      const picked = await luna.gui.chooseFiles({ title: 'Import…', allowMultiple: true, filters: ['*.wav', '*.aif', '*.aiff', '*.flac', '*.mp3', '*.m4a', '*.caf'], defaultPath: read('importFrom', undefined) });
      if (!picked.length) return;
      await setFiles(picked, 'chosen');
    } catch (e) {
      log(`Could not choose files: ${e.message}`, true);
    }
  }

  function takesPlan() {
    return IL.planTakes(files);
  }
  function albumPlan() {
    return IL.planAlbum(files);
  }

  function importRender() {
    const mode = imode();
    $('ialbum').hidden = mode !== 'album';
    $('isource').textContent = sourceLabel || 'none yet: choose or drop files or a folder here';
    const head = $('ihead');
    const body = $('irows');
    body.innerHTML = '';
    let summary = '';
    let count = 0;
    if (files.length && mode === 'takes') {
      const p = takesPlan();
      head.innerHTML = '<tr><th>New track</th><th>Versions</th><th style="text-align:right">Files</th></tr>';
      for (const t of p.tracks) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td></td><td></td><td class="num"></td>';
        tr.children[0].textContent = t.name;
        for (const k of t.takes) {
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.textContent = `V${k.number}${k.name ? ` - ${k.name}` : ''}`;
          chip.title = k.path;
          tr.children[1].appendChild(chip);
        }
        tr.children[2].textContent = t.takes.length;
        body.appendChild(tr);
      }
      count = p.tracks.length;
      const takes = p.tracks.reduce((n, t) => n + t.takes.length, 0);
      summary = `${plural(count, 'track')} · ${plural(takes, 'file')}`;
      if (p.ignored.length) summary += ` · ${p.ignored.length} left out (same version twice)`;
    } else if (files.length) {
      const items = albumPlan();
      head.innerHTML = '<tr><th style="text-align:right">#</th><th>Marker and track</th><th>File</th></tr>';
      items.forEach((it, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td class="num"></td><td></td><td class="dim"></td>';
        tr.children[0].textContent = i + 1;
        tr.children[1].textContent = it.title;
        tr.children[2].textContent = it.path.split('/').pop();
        body.appendChild(tr);
      });
      count = items.length;
      summary = `${plural(count, 'song')} in file-name order`;
    }
    $('itable').hidden = !count;
    $('ihint').hidden = !!count;
    $('isummary').textContent = summary;
    const b = busy();
    $('igo').disabled = b || !session || !count;
    $('igo').textContent = count ? (mode === 'takes' ? `Make ${plural(count, 'track')}` : `Import ${plural(count, 'song')}`) : 'Import';
    $('istop').disabled = !(b && running.importing);
    for (const id of ['ifolder', 'ifiles']) $(id).disabled = b || !session;
  }

  async function startTick() {
    if ($('istart').value === 'playhead') {
      const t = session.transport?.tick?.value;
      if (typeof t === 'number') return t;
    }
    try {
      return session.musical.timeline.tickAt({ bar: 1 });
    } catch {
      return 0;
    }
  }

  async function doImport() {
    if (!session || busy()) return;
    const mode = imode();
    const signal = {};
    setBusy({ signal, importing: true });
    $('iprog').hidden = false;
    $('iprog').value = 0;
    const started = Date.now();
    try {
      const at = await startTick();
      if (mode === 'takes') {
        const p = takesPlan();
        let n = 0;
        log(`Making ${plural(p.tracks.length, 'track')} from takes…`);
        const out = await IL.importTakes(session, p, {
          startTick: at,
          signal,
          onEvent: (e) => {
            if (e.type === 'take') $('iprog').value = ++n / p.tracks.reduce((k, t) => k + t.takes.length, 0);
            if (e.type === 'failed') log(`${e.track.name}: ${e.error?.message ?? e.error}`, true);
            if (e.type === 'track') log(`${e.track.name}: ${e.track.takes.map((k) => `V${k.number}`).join(', ')}`);
          },
        });
        log(`${plural(out.made.length, 'track')} made in ${fmtLength((Date.now() - started) / 1000)}${signal.stop ? ' (stopped)' : ''}`, out.failed.length > 0);
      } else {
        const items = albumPlan();
        const gap = Math.max(0, Number($('igap').value) || 0);
        log(`Importing ${plural(items.length, 'song')} with ${gap} s between them…`);
        const out = await IL.importAlbum(session, items, {
          startTick: at,
          gapSeconds: gap,
          markers: $('imarkers').checked,
          signal,
          onEvent: (e) => {
            if (e.type === 'song') {
              $('iprog').value = (e.index + 1) / items.length;
              log(`${e.index + 1}. ${e.item.title}`);
            }
            if (e.type === 'failed') log(`${e.item.title}: ${e.error?.message ?? e.error}`, true);
          },
        });
        log(`${plural(out.placed.length, 'song')} placed in ${fmtLength((Date.now() - started) / 1000)}${signal.stop ? ' (stopped)' : ''}`, out.failed.length > 0);
      }
    } catch (e) {
      log(`Import stopped: ${e.message}`, true);
    } finally {
      $('iprog').hidden = true;
      setBusy(null);
      refresh();
    }
  }

  // ---- sort ----

  let rules = read('rules', null) ?? SL.DEFAULT_RULES.map((r) => ({ ...r }));
  let moves = [];
  let folders = [];
  const choice = new Map(); // trackId -> folder path ('' = leave) the user picked
  const unticked = new Set();
  let movable = []; // ids of rows whose box can be ticked, in list order
  let sortAnchor = null; // where a Shift-click range starts

  function saveRules() {
    write('rules', rules);
  }

  function rulesRender() {
    const body = $('srules');
    body.innerHTML = '';
    rules.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="f"><input type="text"></td><td><input type="text"></td><td><button class="mini" title="Remove">✕</button></td>';
      const [f, w] = tr.querySelectorAll('input');
      f.value = r.folder;
      w.value = r.words;
      f.onchange = () => {
        r.folder = f.value.trim();
        saveRules();
        sortRefresh();
      };
      w.onchange = () => {
        r.words = w.value;
        saveRules();
        sortRefresh();
      };
      tr.querySelector('button').onclick = () => {
        rules.splice(i, 1);
        saveRules();
        rulesRender();
        sortRefresh();
      };
      body.appendChild(tr);
    });
  }

  /** The folder path a move goes to now: the user's pick, else the rule's. '' leaves it. */
  function target(m) {
    if (choice.has(m.id)) return choice.get(m.id);
    if (m.folder) return m.folder.path.join('/');
    if (m.missing && $('smake').checked) return m.missing;
    return '';
  }
  const exists = (path) => folders.some((f) => f.path.join('/').toLowerCase() === path.toLowerCase()) || !!SL.findFolder(folders, path);

  function sortRefresh() {
    if (!session) {
      moves = [];
      folders = [];
      return sortRender();
    }
    try {
      folders = SL.folders(session);
      moves = SL.plan(SL.readTracks(session), folders, rules, { onlyLoose: $('sloose').checked });
    } catch (e) {
      log(`Could not read the folders: ${e.message}`, true);
    }
    sortRender();
  }

  function sortRender() {
    const body = $('srows');
    body.innerHTML = '';
    const paths = [...new Set([...folders.map((f) => f.path.join('/')), ...($('smake').checked ? rules.map((r) => SL.pathParts(r.folder).join('/')).filter(Boolean) : [])])].sort(IL.naturalCompare);
    let going = 0;
    const b = busy();
    movable = [];
    for (const m of moves) {
      const to = target(m);
      const here = m.from ? m.from.path.join('/') : '';
      const moving = !!to && to.toLowerCase() !== here.toLowerCase() && !unticked.has(m.id);
      if (moving) going++;
      const tr = document.createElement('tr');
      if (!to || to.toLowerCase() === here.toLowerCase()) tr.className = 'skip';
      else if (unticked.has(m.id)) tr.className = 'off';
      tr.innerHTML = '<td class="pick"><input type="checkbox"></td><td></td><td class="dim"></td><td></td>';
      const box = tr.querySelector('input');
      box.checked = moving;
      box.disabled = b || !to || to.toLowerCase() === here.toLowerCase();
      if (!box.disabled) movable.push(m.id);
      // Shift-click ticks or unticks every track from the last one clicked to this one.
      box.onclick = (e) => {
        const ids = e.shiftKey && sortAnchor ? idsBetween(movable, sortAnchor, m.id) : [m.id];
        sortAnchor = m.id;
        for (const id of ids) {
          if (box.checked) unticked.delete(id);
          else unticked.add(id);
        }
        sortRender();
      };
      tr.children[1].textContent = m.name;
      tr.children[2].textContent = here || '–';
      const sel = document.createElement('select');
      sel.disabled = b;
      const opt = (value, text) => sel.appendChild(Object.assign(document.createElement('option'), { value, textContent: text }));
      opt('', m.rule && !m.folder && !m.missing ? 'already there' : m.missing && !$('smake').checked ? `stays (no ${m.missing} folder)` : 'stays');
      for (const p of paths) opt(p, p.replace(/\//g, ' / ') + (exists(p) ? '' : '  (new)'));
      sel.value = paths.includes(to) ? to : '';
      sel.onchange = () => {
        choice.set(m.id, sel.value);
        if (sel.value) unticked.delete(m.id);
        sortRender();
      };
      tr.children[3].appendChild(sel);
      body.appendChild(tr);
    }
    groupRender();
    $('stable').hidden = !moves.length;
    $('shint').hidden = !!moves.length || !session;
    $('shint').textContent = $('sloose').checked ? 'Every track is already in a folder. Untick “Only tracks not in a folder yet” to sort them again.' : 'No tracks in this session.';
    const making = [...new Set(moves.filter((m) => !unticked.has(m.id)).map(target).filter((p) => p && !exists(p)))];
    $('ssummary').textContent = moves.length ? `${plural(going, 'track')} to move${making.length ? ` · ${plural(making.length, 'new folder')}` : ''}` : '';
    $('sgo').disabled = b || !session || !going;
    $('sgo').textContent = going ? `Sort ${plural(going, 'track')}` : 'Sort';
    for (const id of ['srefresh', 'sadd', 'sreset']) $(id).disabled = b || (id === 'srefresh' && !session);
  }

  /** The folder list for "Select its tracks": Drums first picked when there is one. */
  function groupRender() {
    const sel = $('sgroupFolder');
    const want = sel.value || read('groupFolder', 'Drums');
    sel.innerHTML = '';
    for (const f of folders) sel.appendChild(Object.assign(document.createElement('option'), { value: f.id, textContent: f.path.join(' / ') }));
    const hit = folders.find((f) => f.id === want) ?? SL.findFolder(folders, want) ?? folders[0];
    if (hit) sel.value = hit.id;
    $('sselect').disabled = busy() || !session || !folders.length;
    sel.disabled = !folders.length;
    if (!folders.length) sel.appendChild(Object.assign(document.createElement('option'), { textContent: 'no folders' }));
  }

  async function selectGroup() {
    const f = folders.find((x) => x.id === $('sgroupFolder').value);
    if (!session || !f || busy()) return;
    write('groupFolder', f.path.join('/'));
    try {
      const n = await SL.selectFolder(session, f.id);
      log(n ? `${plural(n, 'track')} in ${f.path.join(' / ')} selected: now use LUNA’s group command.` : `${f.path.join(' / ')} has no tracks.`, !n);
    } catch (e) {
      log(`Could not select the tracks: ${e.message}`, true);
    }
  }

  async function doSort() {
    if (!session || busy()) return;
    setBusy({ signal: {} });
    try {
      const chosen = moves.map((m) => ({ ...m, to: target(m) })).filter((m) => m.to && !unticked.has(m.id) && m.to.toLowerCase() !== (m.from ? m.from.path.join('/') : '').toLowerCase());
      // Make missing folders in the rules' order, so Drums holds Kick, Sn, Tom in that order.
      const rank = (p) => {
        const i = rules.findIndex((r) => SL.pathParts(r.folder).join('/').toLowerCase() === p.toLowerCase());
        return i < 0 ? rules.length : i;
      };
      const missing = [...new Set(chosen.map((m) => m.to).filter((p) => !exists(p)))].sort((a, b) => rank(a) - rank(b));
      if (missing.length) {
        const made = await SL.makeFolders(session, missing);
        if (made.length) log(`New folders: ${made.join(', ')}`);
      }
      await new Promise((r) => setTimeout(r, 200));
      const now = SL.folders(session);
      const ready = chosen.map((m) => ({ ...m, folder: SL.findFolder(now, m.to) })).filter((m) => m.folder);
      const out = await SL.apply(session, ready);
      for (const f of out.failed) log(`Could not move tracks into ${f.path}: ${f.error?.message ?? f.error}`, true);
      log(`${plural(out.moved, 'track')} sorted into folders`);
      choice.clear();
      unticked.clear();
    } catch (e) {
      log(`Sort stopped: ${e.message}`, true);
    } finally {
      setBusy(null);
      sortRefresh();
    }
  }

  // ---- wiring ----

  function init() {
    for (const b of document.querySelectorAll('nav button')) b.onclick = () => showTab(b.dataset.tab);
    const im = read('imode', 'takes');
    for (const r of document.querySelectorAll('input[name=imode]')) {
      r.checked = r.value === im;
      r.onchange = () => {
        write('imode', imode());
        importRender();
      };
    }
    $('igap').value = read('gap', 2);
    $('igap').onchange = () => write('gap', Math.max(0, Number($('igap').value) || 0));
    $('imarkers').checked = read('markers', true);
    $('imarkers').onchange = () => write('markers', $('imarkers').checked);
    $('istart').value = read('start', 'bar1');
    $('istart').onchange = () => write('start', $('istart').value);
    $('ifolder').onclick = chooseFolder;
    $('ifiles').onclick = chooseFiles;
    $('igo').onclick = doImport;
    $('istop').onclick = () => {
      if (running?.importing) {
        running.signal.stop = true;
        log('Stopping after this track…');
      }
    };
    try {
      Luna.onPathDrop({
        dragOver: () => tab === 'import' && $('drop').classList.add('hot'),
        dragLeave: () => $('drop').classList.remove('hot'),
        drop: ({ paths }) => {
          $('drop').classList.remove('hot');
          if (busy() || !paths?.length) return;
          showTab('import');
          setFiles(paths, 'dropped');
        },
      });
    } catch {
      /* not in LUNA */
    }

    $('sloose').checked = read('onlyLoose', true);
    $('sloose').onchange = () => {
      write('onlyLoose', $('sloose').checked);
      sortRefresh();
    };
    $('smake').checked = read('makeFolders', false);
    $('smake').onchange = () => {
      write('makeFolders', $('smake').checked);
      sortRender();
    };
    $('srulesBtn').onclick = () => {
      $('rules').hidden = !$('rules').hidden;
      rulesRender();
    };
    $('sadd').onclick = () => {
      rules.push({ folder: '', words: '' });
      saveRules();
      rulesRender();
      $('srules').lastChild?.querySelector('input')?.focus();
    };
    $('sreset').onclick = () => {
      rules = SL.DEFAULT_RULES.map((r) => ({ ...r }));
      saveRules();
      rulesRender();
      sortRefresh();
    };
    $('srefresh').onclick = sortRefresh;
    $('sselect').onclick = selectGroup;
    $('sgo').onclick = doSort;
    showTab(tab);
    importRender();
  }

  let sortTimer;
  return {
    init,
    /** Use these files, as a drop does (absolute paths of files or folders). */
    setFiles: (paths) => setFiles(paths, 'given'),
    /** A new session is focused. */
    onSession() {
      choice.clear();
      unticked.clear();
      sortAnchor = null;
      importRender();
      sortRefresh();
    },
    /** Tracks or folders changed. */
    onTracks() {
      clearTimeout(sortTimer);
      if (tab === 'sort' && !busy()) sortTimer = setTimeout(sortRefresh, 300);
      importRender();
    },
  };
})();

globalThis.Panels = Panels;
Panels.init();
