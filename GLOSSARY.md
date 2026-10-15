# Situational globe

Osiris as one world map that holds situations: stories about what is happening somewhere, each with its own data and layers.

## Language

**Global map**:
The world view of Osiris, where every situation can be seen at once.
_Avoid_: base map, globe view

**Global layer**:
A data layer that covers the whole world and that any situation can use, for example rain radar or sea temperature.
_Avoid_: base layer, world layer

**Situation**:
A story at world level, such as "El Niño 2026" or "Bangkok floods, October 2026", built from global layers plus its own data.
_Avoid_: event, theatre, project, case

**Situation layer**:
A data layer that belongs to one situation and covers a wide area without being one place, such as El Niño's ocean heat.
_Avoid_: story layer, custom layer

**Open situation**:
The one situation the viewer has entered; only its own data and layers load, and only one can be open at a time.
_Avoid_: active situation, selected situation

**Past situation**:
A situation that is over; it stays on the map, greyed out, and shows its last snapshot as it was.
_Avoid_: archived, closed, old situation

**Situation panel**:
The side panel of the open situation: its story, then the board for the local map in view.
_Avoid_: ops board, sidebar, HUD

**Local map**:
One place inside a situation, such as "Bangkok · flood", with its own fixed area, local data feeds, markers and, optionally, a 3D city pack.
_Avoid_: region, zone, city map

**Snapshot**:
The one prepared data file for a local map, refreshed every few minutes from its feeds, that viewers load instead of the feeds themselves.
_Avoid_: cache, dump, export

**3D city pack**:
The 3D view of a local map's place: its buildings with the hazard drawn among them.
_Avoid_: 3D mode, city model
