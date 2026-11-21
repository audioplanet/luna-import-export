# Version Export

A LUNA Add On that exports **every version of every track** (the V1, V2, V3… takes in LUNA's
VERSIONS column) as raw files that all start and end at the same point, so you can send all
your takes to someone working in another DAW in one go.

## Install

1. Download `version-export.lunaaddon` from the [latest release](../../releases/latest).
2. Double-click it. LUNA opens and asks to add it.

Or, in LUNA's Add Ons settings, import this repository's address; LUNA installs the latest
release and offers updates. Then open **Add Ons > Windows > Version Export**. Needs LUNA 3.1.2
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

Tick the tracks you want, or use **All** and **None**. Your choice is kept per session, and new
tracks start ticked. Unticked tracks don't change the length of the files, so a track you
export later still lines up with the ones you sent before.

## Your session is put back

Version Export switches the tracks to each version in turn and renders all of that version's
tracks at once, then puts every track back on the version it was on. It deselects all tracks
while it works, because with LUNA's selection grouping a version switch on one selected track
switches them all, and restores your selection afterwards. If LUNA closes mid-export, a
**Restore versions** banner offers to put things back next time.

## Good to know

- Files are **32-bit float WAV** at the session's sample rate: LUNA's bounce has no format
  option. Mono tracks give mono files.
- Files with the same name in the folder are replaced.
- LUNA doesn't create folders. If the folder (or a `V1`, `V2`… folder) is missing, Version
  Export opens the folder dialog so you can make it with **New Folder**, and checks every file
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
npx ua-builder pack       # build version-export.lunaaddon
```

## License

MIT. See [LICENSE](LICENSE). The bundled `vendor/luna.global.js` is Universal Audio's LUNA
Builder SDK, under its own Apache 2.0 license and supplemental terms.
