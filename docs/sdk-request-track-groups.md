# LUNA Builder SDK request: track groups

**SDK:** `@uaudio/luna-builder-sdk` 3.1.2 · **Add On:** Import/Export (`com.audioplanet.version_export`)

## What we'd like to do

Our Add On sorts a session's tracks into the folders of a mix template, for example Kick In
→ Drums / Kick. Drums are almost always grouped, so the next step is to make a LUNA track
group of every drum track automatically: for edits across the kit (phase-locked cuts and
moves) and for mix controls.

## What's missing

The SDK has no typed calls for track groups. The engine tree in `docs/tree/luna-3.0.0.15776.json`
shows a `groups` child under a session and the session commands `new_group`,
`add_group_members`, `remove_group_members`, `delete_group`, `group_affected_tracks` and
`group_change_order`, plus context properties such as `groups_suspended`, `all_group` and
`mix_group_override`. Their arguments and replies aren't documented, and `docs/EVIDENCE.md`
has no entry for them. We don't post undocumented commands, so groups are out of reach for
now.

## What would help

Typed calls on `Session`, covered by `Luna.MockEngine` like the rest:

- `session.groups`: a live collection of groups, each with its name, member track (and bus)
  uids, and which attributes it shares (edit, volume, mute, solo, and so on, whatever LUNA's
  group dialog offers).
- `session.newGroup({ name, channelUids, attributes? })`: one undo step, resolving to the group.
- `group.add(channelUids)`, `group.remove(channelUids)`, `group.delete()`, and enabling or
  suspending a group.
- An `EVIDENCE.md` entry for the commands, so Add Ons can see what LUNA does with them.

## Workaround for now

The Add On selects every track in a chosen folder (`session.context.select`), and the user
makes the group with LUNA's own group command.
