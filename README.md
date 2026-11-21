# Import/Export

A LUNA Add On that exports **every version of every track** (the V1, V2, V3… takes in LUNA's
VERSIONS column) as raw files that all start and end at the same point, so you can send all
your takes to someone working in another DAW in one go. It also brings files in: takes become
tracks with versions, an album goes in song after song with markers, and **Sort** moves
tracks into your template's folders.

## Install

1. Download `import-export.lunaaddon` from the [latest release](../../releases/latest).
2. Double-click it. LUNA opens and asks to add it.

Or, in LUNA's Add Ons settings, import this repository's address; LUNA installs the latest
release and offers updates. Then open **Add Ons > Windows > Import/Export**. Needs LUNA 3.1.2
or later. After installing a new version, restart LUNA: it keeps Add On windows running when
they are closed, so the window title shows which version is loaded.

## What you get

- **Raw files:** before plugins and fader, the way the takes were recorded.
- **All lined up:** every file runs from bar 1 (or earlier, if a clip starts before bar 1) to
  the end of the last clip on any version of any track. Drop them in at the start of a session
  and they're in sync.
- **Tracks with one version are exported once.** Empty versions and tracks without clips are
  left out, and muted clips don't count.
- **Your version names are kept**, because they often say something about the take.

Pick how the files are named:

| Names | Example |
|---|---|
| Version in the file name | `Bass - V1.wav`, `Bass - V2 - tight.wav`, `Keys.wav` |
| A folder per version | `V1/Bass.wav`, `V2/Bass - tight.wav`, `Keys.wav` |

## Choosing tracks

Tick the tracks you want, or use **All** and **None**. **Shift-click** a box to tick or untick every track from the last one you clicked to this one. Your choice is kept per session, and new
tracks start ticked. Unticked tracks don't change the length of the files, so a track you
export later still lines up with the ones you sent before.

## Your session is put back

Import/Export switches the tracks to each version in turn and renders all of that version's
tracks at once, then puts every track back on the version it was on. It deselects all tracks
while it works, because with LUNA's selection grouping a version switch on one selected track
switches them all, and restores your selection afterwards. If LUNA closes mid-export, a
**Restore versions** banner offers to put things back next time.

## Import

Choose a folder or files, or drop them on the window, and pick what to make:

- **Tracks with versions from takes.** Files named like Export names them become one track per
  name with a version per take, every take starting at the same point:
  `Bass - V1.wav`, `Bass - V2 - tight.wav`, `V3/Bass.wav` make a track *Bass* with V1, V2, V3.
  `Bass_V2`, `Bass Take 2` and `Take 2/Bass.wav` work too, and a file without a version is a
  one-version track. Tracks are mono or stereo like the files. LUNA's SDK can't name versions,
  so a take's name (*tight*) is on its clip.
- **An album.** Each file goes on its own track, one after another, with a gap you choose
  (2 seconds by default) and a marker named after the file at its start, ready for
  [Song Bounce](https://github.com/audioplanet/luna-song-bounce). Files go in file-name order
  (`2` before `10`), and a leading `01 - ` is left out of the name.

Both start at bar 1 or at the playhead. Files are copied into the session.

## Sort

Moves tracks into the session's folders by the words in their names: *Kick In* goes to
**Drums / Kick**, *SN TOP* to **Drums / Sn**, *OH L* to **Drums**, *RHODES* to **Keys**, *BASS DI* to
**Bass**. Open a session made from your template, import or drag in the tracks, and Sort shows
where each would go; change any of them, untick the ones to leave (Shift-click for a range), then click **Sort**.

- **Rules** are a folder path and its words, and are kept for every session. A word must start
  a word in the track name (*SN TOP1* has *sn*, *Snapper* doesn't). The deepest folder wins
  (*Bass Drum* goes to Kick, not Bass), then the word that comes first (*Hammond Room* goes to
  Keys, not to Drums for *room*).
- A folder is found by its path's end, so *Kick* finds **Drums / Kick** wherever Drums is.
- With **Make folders…** on, folders a rule names that the session lacks are made as summing
  folders; otherwise those tracks stay where they are.
- By default only tracks not yet in a folder are sorted.
- LUNA routes a track moved into a summing folder through that folder.
- **Group:** pick a folder (Drums by default) and click **Select its tracks**: every track in
  it and its folders is selected, ready for LUNA's own group command. The SDK can't make
  groups yet.

## Good to know

- Files are **32-bit float WAV** at the session's sample rate: LUNA's bounce has no format
  option. Mono tracks give mono files.
- Files with the same name in the folder are replaced.
- LUNA doesn't create folders. If the folder (or a `V1`, `V2`… folder) is missing, Import/Export
  opens the folder dialog so you can make it with **New Folder**, and checks every file
  after it is written.
- A long song with many tracks takes a while: each version is one render, with a short pause
  between versions while the files are checked.

## Develop

Built with [`@uaudio/luna-builder-sdk`](https://github.com/uaudio-labs/luna-builder-sdk).
`logic.js` holds everything that talks to LUNA, without DOM; `main.js` is the window;
`tests/` runs against `Luna.MockEngine` with no LUNA needed.

```sh
npm install
npm test
npx ua-builder serve      # http://localhost:8790/ with LUNA running
npx ua-builder install    # link into LUNA's Add Ons folder
npx ua-builder pack       # build import-export.lunaaddon
```

## License

MIT. See [LICENSE](LICENSE). The bundled `vendor/luna.global.js` is Universal Audio's LUNA
Builder SDK, under its own Apache 2.0 license and supplemental terms.
