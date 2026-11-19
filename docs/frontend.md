# Frontend development

The game and administration UI use dependency-free browser code. Strict
TypeScript in `frontend/` builds into two embedded JavaScript bundles; SVG,
HTML, and CSS live in `internal/webapp/web/`. Edit the source and run the
[README verification commands](../README.md#test) before restarting the server.
Go embeds these files at compilation, so refreshing the browser alone cannot
pick up changes in an already running binary.

## Source map

| Area | Source |
| --- | --- |
| Startup, navigation, and game state | `frontend/app.ts` |
| Pointer/keyboard input and feedback timing | `frontend/button.ts` |
| Shared solid projection and lettering pose | `frontend/button-geometry.ts` |
| WebGL solid, lighting, and texture atlas | `frontend/button-3d.ts` |
| Language preferences, formatting, and messages | `frontend/i18n.ts`, `frontend/messages.ts` |
| Motion and local-save options | `frontend/preferences.ts`, `frontend/app.ts` |
| Local save coordination | `frontend/local-game.ts` |
| Floating click feedback | `frontend/click-feedback.ts` |
| Procedural press, release, and response audio | `frontend/sound.ts` |
| Sound profiles, synthesis recipes, and variation curves | `frontend/sound-design.ts` |
| Sharing and clipboard feedback | `frontend/share.ts` |
| Administration | `frontend/admin.ts`, `internal/webapp/web/admin.html` |

`scripts/build-frontend.mjs` bundles the game and admin entry points separately
with esbuild. Test builds compile isolated modules from the same source.
`npm run check` covers types, lint, formatting, bundle freshness, and unit
regressions without installing a browser. Generated `app.js` and `admin.js` are
tracked release content; commit them alongside their TypeScript changes.

## Interaction and appearance

The transparent native button supplies focus, keyboard activation, and pointer
capture. Its hit surface and the WebGL solid share the same projection. If
WebGL allocation, shader compilation, or texture upload fails, the CSS button
stays usable with the same material artwork and visible label. Graphics
initialize only for a visible button.

Press-down compresses the solid and changes gold to copper immediately. Raised
lettering grows by 22% and lights up while held, with a moving reflection.
Release returns the lettering and finish together in 70 ms for taps or 110 ms
for deliberate presses. New presses replace the current release effect rather
than queueing animations. Pointer cancellation, leaving the stage after release,
focus loss, and hiding the page reset transient interaction state.

Mouse, touch, pen, Space, and Enter score once on release. Pointer releases have a small tolerance around the
button and its drag destination.
Each captured finger is independent; holding, repeated keydown events, and
cancelled/outside releases do not add clicks. Dragging can move the solid beyond
its layout stage. Auto motion follows the system preference. Reduced follows
deliberate drags directly and suppresses tilt, springs, particles, and flashes
while retaining quiet color feedback.

Sound is independently optional and off by default. The header speaker toggle
persists a boolean in `goclick.settings.v1` and synchronizes it across tabs.
Options offers Classic (metal switch), Blip (arcade pulses), Clack (dry noisy
impact), Clunk (deep phase-modulated body), Low beep (rounded sine tones), and
Soft chime (inharmonic glassy partials). Each recipe supplies distinct press,
release, and much quieter saved/slow/error/cooldown cues. Releases use their own
shorter duration, faster decay, and lower gain to keep the return stroke light
and rapid clicks clear. The chosen `soundProfile` is stored alongside the sound
boolean; legacy or unknown choices fall back to Classic. Choosing a profile
never enables sound automatically.
Options and the header share the same sound toggle. Preview schedules a press,
release, and reply on the audio clock without touching game saves or the API;
muting, hiding, changing profiles, or another preview stops that sequence.
Release and reply share the press's audio-clock origin, so synthesis cost does
not add extra delay between the preview cues.
Closing Options, losing focus, or starting a real game press also cancels the
preview, including its scheduled release and reply. Cancelling only a preview
preserves genuine game-response sounds.

`sound-design.ts` renders short, faded PCM buffers without allocating an audio
device. Pitch follows overlapping slow sine curves; texture and duration follow
another smooth curve. A bounded activity value rises on presses and decays
exponentially over 900 ms, adding a little energy during rapid play. Randomness
seeds the curves once per visit, adds less than half a percent of pitch accent
per press, and supplies noise for mechanical textures. Release and reply sample
the same continuous curves rather than picking unrelated parameters. Blip's
pitch step follows each cue's direction, including downward error/cooldown
tones. Clunk's noise-filter decay is normalized for the device sample rate.
Offline responses follow the simulated ping timing. Cancelled/outside releases,
repeated keydowns, and suppressed native clicks produce no release sound.
Explicitly enabling sound
prepares the audio device silently, so startup does not delay the first game
press. A remembered preference stays allocation-free until a press/release;
page load and network responses never initialize audio. Muting or hiding the
page stops active voices, discards sounds awaiting audio unlock, and requests
suspension of the existing audio context. Returning to the page does not resume
the device automatically; explicit opt-in, preview, or a fresh press/release
resumes it. A quick toggle during pending suspension still issues resume within
the user gesture, and a late unlock while muted/hidden requests suspension again.
Device suspension or interruption discards active and scheduled voices so a
frozen audio clock cannot replay stale sounds on recovery. Closed contexts
release their graph; only a new gesture or opt-in creates a replacement.
Cancelling a gesture or losing focus also discards its pending audio; an unlock
delayed more than 150 ms never replays the old sound. Partial audio setup and
playback failures clean up their resources so a later gesture can retry.
Eight bounded voices keep rapid multi-touch play from building an audio queue.
Responses arriving within 80 ms share a cue instead of stacking
pings. Error/cooldown cues can override a success cue's window, and suppress
success pings for the rest of their own window. Physical press/release sounds
are never coalesced. Only successfully started replies consume this
window; muting, hiding, previews, and profile changes reset it. No replies are
queued for later playback, and all click saves and visual feedback still run.
Presses during an active cooldown give the limited cue without submitting a
request or adding progress, using the same coalescing as server rejections.
Unsupported or blocked audio leaves clicking usable. Motion preferences do not
mute sound.

Pending clicks remain separate from the confirmed total. Floating +1 labels
show request timing and acknowledgment: amber while pending, mint for fast
replies, blue for confirmation, violet for slower replies, red for failures,
and orange during a cooldown. Etched channels and lettering use the same
response colors. The Ping readout retains its last successful timing while the
status dot indicates pending requests or an error. Local play labels simulated
timings explicitly.

Keep controls keyboard-accessible, focus rings visible, and dialogs usable at
320 CSS pixels wide. Preserve Arabic layout and language metadata when changing
the header or feedback; see the [localization guide](localization.md).

The decorative outlet and plug live in the stage’s inline SVG. The cord sits
behind both the WebGL solid and CSS fallback. `projectButtonPower()` keeps the
outlet hidden behind the resting button while projecting the cord’s other end
onto its rear. Dragging takes up slack, then stretches and thins the taut cord.
Repeated long pulls in different directions loosen the game button’s plug.
The plug leans toward the button, and the cord stays attached to its grommet.
Further long pulls disconnect the plug. It hangs from the button, which still
counts clicks with its lights and sounds off. A refresh reseats the plug and
preserves the badge. The SVG is hidden from assistive technology and does not
intercept pointer input.

## Material authoring

The button uses two editable Inkscape SVGs:

- [`button-material.svg`](../internal/webapp/web/button-material.svg) supplies
  neutral metal grain, irregular wear patches, clustered grit, horizontal
  brushing, small pits/scuffs, a machined rim, and engraved channels.
- [`button-glow.svg`](../internal/webapp/web/button-glow.svg) marks only the
  regions that emit light.

Both use a 260 × 144 viewBox and a 780 × 432 image size. Keep the material
grayscale (`#808080` is neutral) and the glow mask white on transparent. Match
channel coordinates between files and keep the lettering area legible. The game
supplies gold/copper colors and press/response illumination. These are separate
layers, so material contrast should not depend on a particular response color.

Use different scales and distributions for wear, grit, and brushed stripes;
repeating a single noise field creates visible bands across the broad face.
The SVG's named layers keep each contribution editable. The renderer packs
material, glow, and lettering into a three-layer atlas; the CSS fallback uses
the same SVG assets. Neither image blocks input, and no PNG export is needed.
[`background-grain.svg`](../internal/webapp/web/background-grain.svg) supplies
the quieter page texture through a soft-light blend.

## Local play and sharing

Offline play has one local save slot. Options can download/import a
`goclick-local` version 1 JSON save, restart the slot, or explicitly replace it
with the last loaded account counters. Replacement requires confirmation.
Invalid imports and failed writes preserve the previous save. Web Locks
serialize writes across tabs; IndexedDB transactions provide the fallback.
Without either mechanism, writes fail without altering saved progress. Tabs
observe changes, and a persisted local-mode startup skips session checks.

Share copies the current click total, UTC streaks, and site link, then opens
options to customize the text. Daily/weekly click totals are not included.
Offline summaries are labeled separately. Clipboard failures leave a selectable
preview for manual copying. Editing the preview or changing its language
invalidates an earlier copy confirmation, including a write still in progress.
Gameplay labels avoid accidental selection and native dragging; form inputs,
errors, technical help, and administrator data remain copyable.

## Browser regressions

The optional CommonJS fixtures in `internal/webapp/testdata/` run in an existing
Playwright environment. Chromium and Firefox are the intended engines; run GPU
checks on target hardware as well as software renderers. Browser packages are
not repository dependencies, and these fixtures are separate from `npm run check`.

Give each fixture a fresh isolated browser context and page against an already
running local server. They use offline play and synthetic local statistics;
they do not create accounts or submit online clicks. Do not use a personal
browser profile. Close each context when finished.

| Fixture | Export | Coverage |
| --- | --- | --- |
| `focus.browser.cjs` | `checkFocus(page, baseURL)` | Skip navigation, input modality, held keys, dialogs, hidden file picker |
| `interaction.browser.cjs` | `checkInteraction(page, baseURL)` | Selection, native drag prevention, gameplay dragging, clipboard/manual sharing |
| `language.browser.cjs` | `checkLanguage(page, baseURL)` | Eleven locales at 1280/320 px, Arabic sharing, next-click label restoration, reload persistence |
| `local-save.browser.cjs` | `checkLocalSave(page, baseURL, options)` | Concurrent writes, replacement, and reloads across two tabs |
| `renderer.browser.cjs` | Function passed to `page.evaluate` | Actual metal/engraving pixels and lettering illumination across tilts, finishes, and response progress |

For example, from the repository root with an isolated Playwright `page`:

```js
const { checkLanguage } = require("./internal/webapp/testdata/language.browser.cjs");
await checkLanguage(page, "http://127.0.0.1:8080");
```

Run the local-save fixture once with default options and once with
`{ withoutWebLocks: true }` in separate contexts. It creates a second page in
the supplied context to exercise cross-tab coordination.

The GPU fixture expects offline play to be visible and textures loaded. Wait
for the first frame and asset loading to settle before evaluating it:

```js
const checkRendering = require("./internal/webapp/testdata/renderer.browser.cjs");
await page.evaluate(checkRendering);
```

A mocked WebGL unit test cannot detect real shader precision differences.
Report the tested engine/GPU and distinguish pixel checks from input, network,
and persistence checks when recording browser results.
