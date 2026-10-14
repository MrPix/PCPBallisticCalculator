# Task list — PCP Ballistic Calculator

Status legend: `[x]` done and verified · `[~]` partially done · `[ ]` not started
Priority: **P0** = needed to be genuinely useful at the range · **P1** = worth doing soon ·
**P2** = nice to have · **P3** = only if a real need appears
Effort: `S` < 1 h · `M` 1–3 h · `L` half a day+

Last verified: `npm test` → **9 files / 146 tests passing (~2 s)**, `npx eslint .` → clean,
`npx next build` → clean static export of 5 routes, `npm run apk` → APK built and verified on an
API 36.1 emulator in airplane mode (renders, persists across a cold restart, requests no permissions).

---

## M0 — Decisions and constraints (done)

- [x] Decide: no backend, no database, static export. Rationale in `architecture.md` §2.
- [x] Decide: physics in TypeScript in the browser, SI internally, conversion only at display.
- [x] Decide: BC fitted from measured drop data, not taken from a catalogue.
- [x] Decide: drag model = point mass + constant-Cd quadratic drag (valid while subsonic).
- [x] Decide: persistence = `localStorage` behind a `KeyValueStore` interface, JSON backup for transfer.
- [x] Decide: mrad as the primary angular unit, MOA as a display conversion.
- [x] Decide: keep the .NET 10 + SQLite path documented as an upgrade, not built.

---

## M1 — Physics core (done)

- [x] Air density from T / P / RH (CIPAC-style ideal-gas mixture + Magnus saturation pressure).
- [x] Pressure unit handling (hPa, kPa, mmHg, inHg, psi) + typo detection ("998 typed as kPa").
- [x] RK4 integrator with distance-targeted adaptive step (5 cm), convergence tested < 0.1 mrad @ 200 m.
- [x] Zero-distance launch-angle solver (vacuum seed → bracket → secant + bisection fallback).
- [x] `ZeroReachableError` with actionable message instead of nonsense output.
- [x] Outputs: angular drop (mrad), linear drop, velocity, energy, Mach, TOF, flight angle,
      apex, both zero crossings, bore-height crossing.
- [x] Unreachable distances reported as `reached: false` rather than extrapolated.
- [x] Implied-Cd sanity readout (`m / (A·BC)`).
- [x] Unit conversions: mrad↔MOA, metric↔imperial, °C↔°F, turret-click arithmetic.

---

## M2 — Calibration: your BC-from-drop-table requirement (done)

- [x] `fitFromDrops()` — log-spaced multi-start scan → damped Gauss-Newton (LM) → bounded coordinate
      polish → final full-accuracy evaluation.
- [x] Identifiability guard: BC always fit; muzzle velocity and sight height opt-in only.
- [x] Physical bounds on every free parameter (`FIT_BOUNDS`).
- [x] Residuals, RMS, mean |err|, max |err| shown per measurement.
- [x] Before/after table across your usual ranges.
- [x] Chronograph route: BC from muzzle + at-range velocity pair, with impossible-reading rejection.
- [x] "Copy predicted" button so an existing model can be turned into a measurement sheet.
- [x] Single-range recalibration path (one group at 100 m → whole day recalibrated).
- [x] **Your range test fitted**: BC = 352.8 kg/m² (Cd 0.177), RMS 0.25 mrad, worst point 0.34 mrad —
      with the calipered 70 mm sight height held fixed (see M8; before that measurement it was
      BC 422.3 / Cd 0.148 / RMS 0.28).
- [x] Regression test tying the model to your measured table.

---

## M3 — App shell and screens (done)

- [x] `/` Calculator: distance by number field, slider, ±delta buttons and range chips → hold-over,
      clicks, velocity, energy, Mach, TOF, flight angle, implied Cd, air density.
- [x] Drop table with tap-to-jump rows and progressive column collapse.
- [x] Trajectory chart (dependency-free SVG), mrad / cm toggle.
- [x] Weather editor on the calculator screen (the day-to-day control) + ISA preset button.
- [x] `/bullets` library: add / edit / duplicate / delete, per-bullet BC, zero, notes.
- [x] `/calibrate` screen.
- [x] `/settings`: **Rifle and scope (sight height)**, units, turret click value and unit, table
      distances, max range, storage info.
- [x] Responsive shell: bottom tab bar on phones, top nav on `md+`, 40–44 px touch targets,
      tabular numerals, dark default + light theme.
- [x] Active bullet + current weather always visible in the header; online/offline pill.

---

## M4 — Data, persistence, portability (done)

- [x] `AppState` / `Bullet` / `Settings` / `Weather` model with `version` for future migration.
- [x] Pure reducer + `useSyncExternalStore` with `getServerSnapshot` → flicker-free static prerender.
- [x] `KeyValueStore` seam (`localStorage` / `MemoryStore` / future REST).
- [x] Debounced single-write persistence (`queueMicrotask`).
- [x] Defensive sanitisation of everything read back or imported.
- [x] JSON export / import (`pcp-ballistics.json`) for moving between devices.
- [x] Seeded state = your actual .177 1 g range test, so the app is useful on first open.
- [x] SSR-safe storage (no `localStorage` → app still works, just not durable).

---

## M5 — Offline / install / hosting (done, one open item)

- [x] `output: "export"` static build, `trailingSlash` so any static server resolves routes.
- [x] PWA manifest + icons (192/512/apple-touch), `standalone`, portrait.
- [x] Service worker: network-first for HTML/navigation payloads, stale-while-revalidate for hashed
      assets, old-cache cleanup, install never fails offline.
- [x] `npm run start` → `scripts/serve-static.mjs` to preview the real production bundle.
- [x] **Android APK: `npm run apk`.** Capacitor 8 wraps the *same* `out/` folder in a real app, so
      there is no server, no HTTPS, no secure-context rule and no connection on the day you install.
      Verified on an API 36.1 emulator: cold start in airplane mode renders the calculator; a range
      change survives force-stop + relaunch while still offline; tab navigation stays client-side;
      `dumpsys package` reports no requested permissions. `npm run apk:release` builds a signed
      release APK (own key, 3.6 MB vs 5.0 MB debug). Rationale and gotchas: `architecture.md` §10.6.
- [x] APK-specific behaviour, each deliberate: no service worker inside the app (nothing to cache, and
      a cache could only go stale after an app update); `on device` pill instead of `online`/`offline`
      (`navigator.onLine` reported *online* in airplane mode in a WebView); `INTERNET` permission
      removed from `AndroidManifest.xml`; WebView debugging off in release builds.
- [x] Launcher icon and splash cut from the project's own artwork: `npm run icons` writes `assets/`,
      `@capacitor/assets` generates the mipmaps/adaptive icon/splash at every density.
- [~] **Hosting recipe for a phone over LAN** — the Android half is now solved without needing a
      secure context at all. What remains is documenting HTTPS for the *browser* install (iOS, or a
      tablet reading a home server). Written up in README "Hosting" and `architecture.md` §10.3, but
      not yet followed end-to-end on a real device. See P0-d.

---

## M6 — Model vs. reality: the measured card (done)

Triggered by a real complaint: the calculator showed **−3.21 mrad at 100 m** while the measured value
is **−2.90**. Investigation showed the gap cannot be closed by any trajectory model.

- [x] Proved the measured table is **internally inconsistent**: beyond the zero, angular drop must get
      more negative at an increasing rate; the table's 125→150 (−2.50), 150→175 (−2.20) and 175→200
      (−1.70) steps violate that. A test scans hundreds of physical configurations (BC 50–6000,
      150–600 m/s, sight height 10–120 mm, zero 25/50/100 m) and finds **no exception**.
- [x] Quantified the fit ceiling: BC only 0.277 mrad RMS · BC+sight height 0.235 (h → 58 mm) ·
      BC+velocity 0.255 (v0 → 295 m/s) · all three 0.234 · free drag exponent 0.276 (no improvement,
      so quadratic drag is correct) · forcing −2.90 at 100 m costs 1.5 mrad at 200 m (RMS 0.889).
- [x] New design: `corrected(d) = model_today(d) + [measured(d) − model_cardWeather(d)]` — the card
      sets the absolute level, the model supplies the shape and the weather translation.
- [x] Additive rather than multiplicative: a ratio is 0/0 at the zero, which destroys the near field.
- [x] `DopeCard` (bulletId + weather + measurements + savedAt), `AppState.dope`, `STATE_VERSION = 2`
      with a v1 → v2 migration on load (superseded by v3, see M8).
- [x] Card ownership rules: editing restamps bullet + weather, empty list clears the card, deleting the
      bullet clears the card, a card from another bullet is refused with an explicit message.
- [x] UI: Measured / Model toggle, `measured −2.90 · model −3.02 · correction +0.12` line, `●`/`◦`
      markers in the drop table, measured dots under the chart curve, uncorrected model always visible.
- [x] `Settings.dropSource` + a Hold-over source card in Settings showing which bullet/weather the card
      belongs to.
- [x] `lib/data/dope.ts` + `lib/data/dope.test.ts` (interpolation, extrapolation, weather-shift
      identity, exactness at measured ranges, convexity proof, card ownership).
- [x] Headline at 100 m is now **−2.90 mrad** in the prerendered production HTML.

---

## M8 — Sight height as a first-class parameter (done)

Sight height (bore centre → scope centre) turned out to be the single most influential input in the
model, so it was made an explicit, stored, fit-able parameter instead of a hard-coded assumption.

- [x] `Settings.sightHeightMm` added (clamped 2–150 mm by `sanitizeSettings()`), with a **Rifle and
      scope** card on `/settings` and a hint explaining why it matters.
- [x] Threaded through the whole stack: `Settings` → `ShotEnvironment.sightHeightMm` →
      `toShotConfig()` → `ShotConfig.sightHeightMm` → integrator / zero solver / apex / bore-height
      crossing → `buildDopeModel()` residuals → calibration and chart.
- [x] `sightHeightM` added to `FreeParameter` in `fit.ts` with physical bounds (`FIT_BOUNDS` 0.002–0.15 m),
      so the Calibrate screen can solve it when it has not been measured (opt-in checkbox, labelled
      "only if you have not measured it").
- [x] A fit that solves sight height writes the result to **Settings**, not to the bullet, because it is
      a property of the rig.
- [x] `STATE_VERSION = 3`: sight height **moved from each bullet to `Settings`**; v2 files are migrated
      by taking the active bullet's value (or the first valid one). Tested in `lib/data/storage.test.ts`.
- [x] `lib/data/shot.test.ts` asserts sight height comes from the environment rather than the bullet and
      that 40 mm vs 70 mm really does change the trajectory.
- [x] **Measured with a caliper: 70 mm.** Re-fitting with it fixed gave BC 352.8 kg/m² (Cd 0.177),
      RMS 0.252 mrad, 100 m at −3.02 mrad, first zero 20.6 m, apex +1.5 cm at 35.4 m — better fit *and*
      a more physical Cd than the 40 mm guess (BC 422.3, Cd 0.148, RMS 0.277, 100 m at −3.21).
- [x] Docs updated to match: `README.md`, `architecture.md` §5.5 / §6.2 / §7.2 / §7.5 / §8.1 / §12.

---

## M9 — Consistency fixes found while auditing the docs (done)

- [x] **Drop-table energy was 1000× too large.** `buildRows()` passed `Bullet.massG` (grams) to
      `dropTable()`, which expects kilograms, so the table showed ~27 900 J at 100 m instead of 27.9 J.
      Fixed in `lib/data/shot.ts`; `lib/data/shot.test.ts` now asserts `E = ½mv²` in joules and that the
      table agrees with the headline summary.
- [x] **The range-test regression was testing an old rig.** `fit.test.ts` hard-coded `sightHeightM: 0.04`
      and BC 422.3 — the pre-caliper configuration — so it was no longer testing the bullet and rig the
      app ships. It now builds the config from the seed (`createSeedBullet()` + `SEED_SIGHT_HEIGHT_MM`)
      and asserts the fit lands back on 352.8 kg/m².
- [x] Stale UI copy: the Bullets screen claimed each bullet carries its own sight height. It does not —
      the field lives in Settings → Rifle and scope.

---

## M7 — Remaining work, prioritised

### P0 — do next, these change the on-range experience

- [x] **P0-a Caliper the sight height.** Done — **70 mm** measured bore-centre to scope-centre. It was
      the biggest lever in the model: the fit moved from BC 422.3 / RMS 0.277 / −3.21 at 100 m (40 mm
      assumed) to **BC 352.8 / RMS 0.252 / −3.02 at 100 m**, and the first zero from 12 m to 20.6 m.
      Stored in Settings → Rifle and scope; the seeded bullet was re-fitted against it. See M8.
      *(S — a measurement, not code)*
- [ ] **P0-b Re-measure 125 / 150 / 175 / 200 m with more shots.** The current table is physically
      inconsistent in exactly this region (§7.1 of architecture.md). Ten shots per range instead of a
      five-shot group, or a target card with a measured aim point, will tell you which number is wrong.
      Until that is done, trust the card at those ranges but know one of them is off. *(S — measurement)*
- [ ] **P0-c Inclined-shooting (rifle angle) correction.** Enter target angle or "uphill/downhill"
      and have the calculator use horizontal distance for gravity. Biggest remaining *code* gap for PCP
      at 100–200 m. *(L)*
      Acceptance: angle input on the calculator; drop recomputed from horizontal range; unit tests for
      0°, ±30°, ±45° against the known "rifleman's rule" approximation; chart/table follow the
      corrected value; the measured card must not double-count the correction.
- [~] **P0-d Hosting recipe that gives a secure context on the LAN.** The Android case no longer needs
      this at all — `npm run apk` sidesteps the secure-context rule (see M5, `architecture.md` §10.6).
      What is left is the non-Android case: iOS, or a tablet reading a home server. Pick one and
      document it end-to-end: Tailscale Serve (recommended) or Caddy `tls internal`. *(M)*
      Acceptance: a copy-pasteable section in `README.md` that a non-expert can follow; service worker
      confirmed registering from a phone; app usable in airplane mode afterwards.
- [ ] **P0-e Verify the fitted BC against a chronograph at range** (if you have one): measure velocity
      at 100 m and compare with the model's 236.2 m/s. Strongest available validation of
      BC = 352.8 kg/m², and it is a measurement task, not a code task. *(S)*

### P1 — worth doing soon

- [ ] **P1-a Wind hold-over (advisory only).** Crosswind → linear drift estimate with an explicit
      "this is an estimate" label, or nothing at all rather than a fake precise number. *(M)*
- [ ] **P1-b Component interaction tests.** Configure a DOM environment (`jsdom` + Testing Library):
      change distance → hold-over updates; fit → apply writes BC to the bullet; import → state
      replaced. Today `tests/render.test.tsx` proves the HTML, but nothing proves a click works. *(M)*
- [ ] **P1-c Coverage reporting.** `npm run test:coverage` is wired up but no coverage provider is
      installed (`@vitest/coverage-v8`). Add it and set a floor for `lib/physics/**`. *(S)*
- [ ] **P1-d CI workflow** (GitHub Actions or a Gitea/GitLab equivalent): `npm ci`, lint, test, build.
      No `.github/` exists today. *(S)*
- [ ] **P1-e E2E smoke test** (Playwright): load `/`, set 137 m, assert a hold-over number appears;
      run the fit and apply it. Guards the parts unit tests cannot reach. *(M)*
- [ ] **P1-f Multiple zeros / dual-zero support** (e.g. 50 m and 100 m on the same load) and a
      "dial vs hold" preference. *(M)*
- [ ] **P1-g Print/export a drop card** — print-friendly page or CSV so you can tape a card to the
      rifle instead of looking at a phone. *(M)*
- [ ] **P1-h Accessibility pass.** `maximumScale=1` currently blocks pinch zoom; re-check contrast
      tokens, focus rings, table semantics, and screen-reader labels on the chart and slider. *(M)*
- [ ] **P1-i Card health check.** Show a warning when the card's residuals are large (model and card
      disagree by > 0.5 mrad), and a "card is stale" hint when `savedAt` is old or the bullet's BC has
      changed since it was saved. Right now a card silently hides a model that has gone bad. *(M)*
- [ ] **P1-j Per-bullet cards.** Today there is one card for the whole app. Once you own a second
      pellet, each bullet needs its own measured table. *(M)*

### P2 — nice to have

- [ ] **P2-a Pellet/slug preset library** (common .177/.20/.22 slugs with ballpark BC and mass) as an
      optional starting point that you then recalibrate. Must be clearly labelled "starting guess,
      calibrate it". *(M)*
- [ ] **P2-b Shot log** ("what I actually shot at 150 m on 2026-04-11") — first feature that genuinely
      wants SQLite, either client-side (IndexedDB) or server-side. *(L)*
- [ ] **P2-c Weather quick-fill** from a local station or API. Needs a network call; do it as an
      optional enhancement, never as a dependency. *(M)*
- [ ] **P2-d Temperature/velocity relationship**: store a couple of (temperature, muzzle velocity)
      pairs for your rifle and let the app interpolate velocity for a cold morning. *(M)*
- [ ] **P2-e Multiple rifles/scopes** (a `Rifle` entity above `Bullet`: caliber, sight height, zero).
      Sight height already lives in `Settings` as one rig-wide number (M8); this task is what to do when
      you own a **second** rifle and that single number stops being enough. *(M)*
- [ ] **P2-f Metric/imperial toggle for range too** (yards), currently ranges are metres by design. *(S)*
- [ ] **P2-g Theme toggle** (manual light/dark override instead of following the system). *(S)*

### P3 — only if a real need appears

- [ ] **P3-a .NET 10 minimal API + SQLite** for multi-device sync and/or a shot log. Trigger
      conditions and the exact API shape are in `architecture.md` §2.2–2.3. The client seam
      (`KeyValueStore`) is already in place, so this is additive, not a rewrite. *(L)*
- [ ] **P3-b Mach-dependent drag** (a Cd-vs-Mach table) if you ever load supersonically or want
      better than ~0.3 mrad fidelity from a fitted model. *(L)*
- [ ] **P3-c 6-DOF / spin drift / Coriolis.** Not worth it below ~300 m with a 1 g slug. *(L)*
- [ ] **P3-d Next static-export segment payloads 404.** Next's client requests
      `/bullets/__next.bullets.__PAGE__.txt` while `next build` writes
      `bullets/__next.bullets/__PAGE__.txt` — a directory where the URL has a dot — so those prefetch
      requests 404 on any static host and inside the APK. Cosmetic only: `_tree`/`_full` resolve,
      navigation is confirmed still client-side, and nothing user-visible degrades. Re-check on a Next
      upgrade rather than patching around it here. *(S)* See `architecture.md` §10.2.

---

## Explicitly not planned (and why)

| Item | Decision | Reason |
|---|---|---|
| Backend for the calculator itself | Rejected | Physics runs locally in milliseconds; a server adds failure and latency at the range |
| SQLite for bullets/settings/weather | Rejected for now | ~5 KB of JSON; `localStorage` + export covers it |
| Authentication / user accounts | Rejected | Single user, single household |
| Catalogue BC database as the primary source | Rejected | Your whole question is that catalogue BCs are unavailable for hand-loaded slugs |
| Third-party charting library | Rejected | 140 lines of SVG covers it; a library costs tens of KB on a field connection |
| Wind modelling as a precise feature | Deferred (P1-a) | A wrong wind model is worse than an honest absence of one |
| Native iOS/Android app | Rejected as a *second codebase*; Android exists as a wrapper | `npm run apk` packages the same `out/` build in a WebView — one codebase, and it removes the secure-context requirement the PWA depends on. A hand-written native app is still rejected |

---

## Open questions for you (answers change the next tasks)

1. **Sight height** — answered: **70 mm, calipered** (was a 40 mm estimate). It is the largest single
   lever in the fit, it now lives in Settings → Rifle and scope, and it sets the first zero at 20.6 m.
   Re-measure it if you ever change rings, mounts or the scope, then re-fit.
2. **Which of 125 / 150 / 175 / 200 m was measured most carefully?** Those four are where the table
   becomes physically impossible (§7.1). If you remember aiming carefully at one of them and guessing
   at another, that is the information that fixes the table.
3. **How were the ranges determined** — taped measure, laser rangefinder, pacing? A 4 m range error at
   150 m produces about the same 0.3 mrad wiggle as an aim error, and it changes which explanation is
   correct.
4. **Turret click size** — the seed assumes 0.1 mrad per click. What does your scope actually do?
5. **Do you hold over or dial?** If you mostly hold, the "hold in cm/in" number should be the hero and
   clicks should be secondary.
6. **Do you shoot angled shots** (hills/ridges)? If yes, P0-c moves to the top of the code list.
7. **Do you have a chronograph at range** (one screen, not just muzzle)? If yes, P0-e is the fastest
   way to validate the fitted BC.
8. **How will you actually host it** — answered for Android: `npm run apk`, no hosting involved. Still
   open for iOS or a tablet reading a home server, which is what P0-d now covers.
9. **Is 250 m the right max range**, or do you want the table extended to 300 m? Note that past 200 m
   the number is model + a constant offset, i.e. extrapolation.

---

## Definition of done (project-wide)

- `npm test` green, `npx eslint .` clean, `npx next build` produces a working `out/`.
- Any change to `lib/physics/**` ships with a test that states the *physical* expectation, not just
  the new output.
- Any change to the model is checked against your measured range-test table (the regression test in
  `lib/physics/fit.test.ts`) and the RMS stays under 0.35 mrad.
- The measured card still reproduces your measurements exactly at every measured range
  (`lib/data/dope.test.ts`). If a change breaks that, the calculator is showing you the model again
  and the change is wrong.
- The app still opens and computes with no network connection.
- `architecture.md` and `README.md` describe what the code actually does — if they drift, fix the
  docs in the same commit.
