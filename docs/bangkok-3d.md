# Bangkok 3D city

The `/bangkok` page keeps one snapshot and one MapLibre map while switching between the 2D ops board and 3D city.

## Files

- `BangkokPage.tsx` owns view, city-pack, animation, language, layer, search, and near-me state.
- `BangkokMap.tsx` owns the single map, radar frames, popups, and map controls.
- `city3d.ts` contains pure geometry/camera helpers, 3D sources and layers, reversible base-style changes, and view visibility.
- `animation.ts` contains the single animation clock and its pure `shouldTick` gate.
- `layers.ts` is the one registry for groups, labels, counts, 2D/3D IDs, and legends.

Every layer added by the city module uses the `c3-` prefix. The shared `radar` layer is created by the 2D/radar code and remains visible in either view when its chip is active.

## View switching

`addCityLayers` adds sources and initially hidden layers once during `style.load`. `applyView` selects the IDs for the current view without rebuilding the map. Entering 3D targets the highest-score level-3 danger hex, applies the night base style, and lowers radar opacity to 0.45; leaving restores base paint/layout, sky, light, and radar opacity.

The 3D city checkbox controls only buildings and parks. It is unavailable when the base style has no OpenStreetMap building source. A city-layer setup failure removes the partial `c3-` pack and leaves the working 2D map in place. Data-layer chips retain one checked state across both views; 2D-only chips are disabled and dimmed while in 3D.

## Animation clock

Animation defaults on, or off when `prefers-reduced-motion` is set. The rAF loop exists only while animation is enabled, the view is 3D, the document is visible, Bangkok intersects the map bounds, and the map container is on screen. Paint changes are capped at 10 Hz. The smooth orbit is a camera move and renders every frame while enabled; it remains at 1.5°/s and pauses for 10 seconds after map input.

Only danger opacity and report-ring radius/opacity pulse. Buildings rise once over about 1.2 seconds. The map style sets a zero-duration transition so paint changes keep the 10 Hz budget, and blocked-road dash arrays are static.

## Checking zero repaints

Open browser DevTools Performance or the MapLibre render-event counter, select 3D, turn Animation off, stop interacting, and wait for the map to settle. The render-event rate must fall to `0/s`. Repeat after returning to 2D and after hiding/restoring the tab.
