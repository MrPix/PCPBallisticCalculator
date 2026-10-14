# PCP Ballistic Calculator

Hold-over calculator for a PCP air rifle, built around **measurements from your own rifle** rather
than catalogue ballistic coefficients you do not have.

Current load: **.177 (4.52 mm) · 1.00 g slug · 280 m/s · zeroed at 50 m**.
The ballistic coefficient was fitted from an 8-point drop table shot at +15 °C / 998 hPa / 63 % RH,
with a **calipered sight height of 70 mm** (Settings → Rifle and scope).

**The calculator shows your measured hold-over, not the model's.** At 100 m it shows **−2.90 mrad**
(your measurement), with the model's −3.02 mrad shown beside it. Read
[Why the model cannot match your drop table](#why-the-model-cannot-match-your-drop-table) for why.

- Runs entirely in the browser — no backend, no database, no account.
- Works offline once opened; installable to a phone or tablet home screen (PWA).
- On Android, `npm run apk` builds a **real APK** from the same code: no server, no HTTPS, no
  connection, and it requests no permissions from the device — not even INTERNET.
- Responsive: bottom tab bar on a phone, top nav on a tablet/desktop, big tabular numbers.
- Physics, calibration and the measured card are covered by **146 unit tests** (Vitest).

Docs: **[architecture.md](architecture.md)** — how it works and why it is built this way ·
**[TASKS.md](TASKS.md)** — what is done and what is next.

---

## Quick start

```bash
cd pcp-calc
npm install
npm run dev          # http://localhost:3000
```

Production build (plain static files in `pcp-calc/out/`):

```bash
npm run build
npm run start        # serves ./out at http://localhost:3000 (convenience server)
```

Checks:

```bash
npm test             # 9 files / 146 tests, ~2 s
npm run test:watch
npx eslint .
```

Android APK (see [Running it on an Android phone or tablet](#running-it-on-an-android-phone-or-tablet)):

```bash
npm run apk          # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run apk:release  # signed release build
npm run android:open # open the native project in Android Studio
```

---

## The four screens

| Screen | What you do there |
|---|---|
| **Calculator** | Type, slide or tap a distance → hold-over in mrad (or MOA), turret clicks, velocity, energy, time of flight, Mach, trajectory chart and a drop table. Hold-over comes from your measured card, corrected to today's air; the raw model sits beside it. Weather is editable here. |
| **Bullets** | Add / edit / duplicate / delete bullets. Each bullet carries its own mass, caliber, fitted BC, muzzle velocity and zero. JSON backup export and import. Sight height is deliberately **not** here — it belongs to the rifle, not the pellet. |
| **Calibrate** | Enter measured drops (or a chronograph velocity pair) → fit the BC → apply it. Save the drop list as the measured card the calculator uses. Shows residuals and fit quality. |
| **Settings** | **Rifle and scope (sight height)**, units (metric/imperial, mrad/MOA, hPa/kPa/mmHg/inHg/psi, °C/°F), **hold-over source** (measured card vs physics model), turret click value, drop-table distances, maximum range. |

---

## Why the model cannot match your drop table

You measured **−2.9 mrad at 100 m**. The fitted model says **−3.02 mrad** (it said −3.21 before the
sight height was measured — see the table below). That gap is real, and it is not a bug in the
arithmetic — it is a property of your data.

Beyond the zero, angular drop must get **more negative at an increasing rate**: each 25 m step must
drop more than the previous one. That is true of every trajectory in this model family — a test scans
hundreds of configurations (BC 50–6000 kg/m², 150–600 m/s, sight height 10–120 mm) and finds no
exception. Your table's steps:

```
50→75  -1.10    75→100  -1.80    100→125  -1.90    125→150  -2.50
150→175 -2.20   175→200  -1.70        <- the drop decelerates: no pellet does this
```

So at least one of the 125 / 150 / 175 / 200 measurements is off by several centimetres (group size,
hold, rest, or range estimation). **No physical trajectory can reproduce your table.** Every lever was
tried:

| What was fitted | Fit RMS vs your table | Drop at 100 m |
|---|---|---|
| BC only, sight height assumed 40 mm | 0.277 mrad | −3.21 |
| **BC only, sight height measured 70 mm** | **0.252 mrad** | **−3.02** |
| BC + sight height free (→ 58 mm) | 0.235 mrad | −3.09 |
| BC + muzzle velocity (→ 295 m/s) | 0.255 mrad | −3.08 |
| BC + velocity + sight height | 0.234 mrad | −3.11 |
| Drag exponent free (power-law drag) | 0.276 mrad — no improvement | −3.21 |
| Force an exact match at 100 m | **0.889 mrad** | −2.90, but 200 m becomes −9.67 instead of −11.2 |

~0.23 mrad is the floor, and forcing 100 m to be exact costs 30 cm at 200 m. The drag law is not the
culprit either: fitting the drag exponent changes nothing, so quadratic drag is right for a subsonic
slug.

Measuring the sight height paid for itself: the 100 m prediction moved from −3.21 to −3.02 and the
125 m prediction from −5.07 to −4.90, so the model is now within 0.12 mrad where you actually shoot.
It also dropped the fitted BC from 422 to 353 kg/m² — same pellet, taller scope.

### What the app does about it

Your measurements win. The calculator computes:

```
hold-over(d) = model_today(d) + [ measured(d) − model_atCardWeather(d) ]
```

At the conditions you measured in, the correction is exact by construction — the calculator reports
**your** numbers: +0.60 at 25 m, 0.00 at 50 m, −2.90 at 100 m, −11.20 at 200 m. When the weather
changes, the card moves by the model's *difference* between the two air densities, which is the part
the model is genuinely reliable at. Between measured ranges the correction is interpolated; beyond the
last measured range it is held constant and labelled `extrapolated`.

Toggle it in Settings → **Hold-over source**, or on the calculator itself. The uncorrected model is
always shown next to the measured number, so you can see how far apart they are.

---

## Using it at the range

1. Open the app, pick your bullet.
2. Type the distance (or slide it, or tap a range chip).
3. Read the big number: **negative = impact below the point of aim**, so hold over / dial up by that
   many mrad. The click helper converts it to turret clicks using your click value.
4. The drop table gives the whole card at once; tap a row to jump to that range. `●` = you measured
   this row, `◦` = interpolated between measured ranges, last column = the uncorrected model.

Sign convention everywhere: `+` = impact **above** aim, `−` = impact **below**.

---

## Changing conditions on another day

There are two different situations and they need different actions.

**Only the weather changed** (cold morning, high pressure). Do **not** re-fit. Just type the new
temperature / pressure / humidity on the calculator screen. A ballistic coefficient contains no air
density — weather enters the model only through air density, which is recomputed instantly.

**The rifle or pellet changed** (new pellet lot, dirty barrel, different power setting, different
chronograph reading):

1. Shoot one group at a known range (100 m is ideal) with a known point of aim.
2. On **Calibrate**, keep only that row: distance + measured drop.
3. Press **Fit parameters** (BC only; leave muzzle velocity and sight height fixed if you measured them).
4. Press **Apply to bullet**.

A unit test proves this works: one zero plus one measurement at 100 m recovers a changed BC and
predicts the drop at 200 m to within 0.1 mrad.

**If you have a chronograph**, the Calibrate screen also computes BC directly from two velocity
readings (muzzle + at range) — no drop data needed.

Fit quality is printed, not assumed: **RMS under ~0.5 mrad** means the model matches your shooting;
**over 1 mrad** usually means the sight height or muzzle velocity is wrong rather than the drag model.

---

## Your range test, as fitted

Input: `+15 °C`, `63 % RH`, `998 hPa`, `280 m/s`, zero 50 m, **sight height 70 mm (calipered)**.

Fitted: **BC = 352.8 kg/m²**, implied **Cd = 0.177**, air density **1.2017 kg/m³**, launch angle
4.71 mrad, first zero 20.6 m, apex +1.5 cm at 35.4 m.

| Range | Measured | **Hold (shown)** | Model | Model error | Velocity | Energy | Mach | Time of flight |
|---|---|---|---|---|---|---|---|---|
| 25 m | +0.6 | **+0.60** | +0.30 | −0.30 | 268 m/s | 36.0 J | 0.79 | 0.091 s |
| 50 m | 0.00 | **0.00** | 0.00 | 0.00 | 257 m/s | 33.1 J | 0.76 | 0.186 s |
| 75 m | −1.1 | **−1.10** | −1.34 | −0.24 | 246 m/s | 30.4 J | 0.72 | 0.286 s |
| 100 m | −2.9 | **−2.90** | −3.02 | −0.12 | 236 m/s | 27.9 J | 0.69 | 0.389 s |
| 125 m | −4.8 | **−4.80** | −4.90 | −0.10 | 226 m/s | 25.6 J | 0.67 | 0.498 s |
| 150 m | −7.3 | **−7.30** | −6.96 | +0.34 | 217 m/s | 23.5 J | 0.64 | 0.610 s |
| 175 m | −9.5 | **−9.50** | −9.17 | +0.33 | 208 m/s | 21.6 J | 0.61 | 0.728 s |
| 200 m | −11.2 | **−11.20** | −11.54 | −0.34 | 199 m/s | 19.9 J | 0.59 | 0.851 s |

The model column is the best least-squares fit available (RMS 0.25 mrad, worst point 0.34 mrad) and it
is kept as a regression test, so a future change that makes the model drift away from your rifle fails
the test suite. The **Hold** column is what the calculator actually puts in front of you, because your
measurements beat the model — see
[Why the model cannot match your drop table](#why-the-model-cannot-match-your-drop-table).

> **Still to verify:** the turret click value (the seed assumes 0.1 mrad per click) and the four long
> ranges 125–200 m, which is where your table becomes physically inconsistent. Sight height is no
> longer a guess: you measured 70 mm and it now lives in Settings → Rifle and scope.

---

## Running it on an Android phone or tablet

There are two ways, and they solve different problems.

### Option A — an APK (recommended for the field)

`npm run apk` wraps the same `out/` build in a real Android app. No server, no HTTPS, no browser,
no connection — and the app asks the device for **nothing**: no INTERNET, no storage, no location.

```bash
cd pcp-calc
npm install
npm run apk
```

That prints the path to `android/app/build/outputs/apk/debug/app-debug.apk` (~5 MB). Get it onto the
device whichever way is easier:

```bash
# USB, with USB debugging switched on and the phone authorised
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

…or copy the `.apk` to the tablet by cable, card or share from another phone and tap it once, after
allowing **Settings → Install unknown apps** for your file manager. It installs as **PCP Ballistic**
with the trajectory icon, and works in airplane mode from then on.

`npm run apk:release` builds a signed release APK (~3.6 MB, no debug flag) using a keystore the
script creates on first run at `android/release.keystore`. **Keep that file** — every later build you
install must be signed with the same key or Android refuses the upgrade.

Two things worth knowing before you need them:

- A debug-signed build cannot be upgraded in place to a release-signed one; Android rejects the
  signature change. Uninstalling wipes your saved bullets, so run **Bullets → Backup** first if you
  switch from one to the other.
- Building needs a JDK 21+ and the Android SDK. `npm run apk` searches for both and writes
  `android/local.properties` itself. If it cannot find them, `npm run android:open` opens the project
  in Android Studio — which ships its own JDK — and you press Run there instead.

What is different inside the APK, deliberately:

| | Browser build | APK |
|---|---|---|
| Where files come from | a web server, then the service worker cache | the APK itself |
| Service worker | registered | **not registered** — nothing to cache, and a cache could only go stale |
| Header pill | `online` / `offline` | `on device` |
| INTERNET permission | n/a | **not requested** |
| Saved bullets and dope | `localStorage` of the site's origin | `localStorage` of the app, private to it |

### Option B — install the website (PWA)

Useful when you want the app on a tablet *and* a desktop from one address, or on iOS where there is
no APK.

1. Serve `out/` over **HTTPS** — see [Hosting](#hosting) below.
2. Open the page once with a connection.
3. Browser menu → **Add to Home screen** / **Install app**.

After that it works in airplane mode. On iPhone/iPad, installing to the home screen is also what
protects your saved bullets from browser storage eviction.

The catch is step 1: a service worker will not register over plain `http://192.168.1.20:3000`, so a
LAN address gives you an app that works but is **not** offline-capable. Details in
[architecture.md §10.3](architecture.md). The APK has no such rule, which is why it exists.

Either way, **Bullets → Backup** exports everything to `pcp-ballistics.json`, and importing it on
another device moves your bullets, dope card and settings across. Note that storage is per-origin,
so switching from an IP address to a hostname starts a fresh app unless you import the file.

---

## Hosting

The build output in `pcp-calc/out/` is a folder of static files. Any of these work:

| Where | How |
|---|---|
| Android phone or tablet | `npm run apk` — no server involved at all (see above) |
| Home server on the LAN | nginx / Caddy / IIS serving `out/`. |
| Home server, reachable remotely | Tailscale Serve — gives HTTPS with no port forwarding. |
| Any static host | Upload `out/`. The app never calls an API, so there is nothing to configure. |

**One caveat:** service workers only register on a secure context. `http://192.168.1.20:3000` from a
phone will run the app but will **not** cache it for offline use. Use HTTPS (Tailscale Serve or a LAN
cert), or build the APK instead, which has no such rule. Details in
[architecture.md §10.3](architecture.md).

---

## Model in one paragraph

Point mass with quadratic drag: deceleration `ρ·v² / (2·BC)`, where `ρ` is air density computed from
temperature, pressure and humidity (CIPAC-style ideal-gas mixture) and `BC = mass / (Cd · area)` in
kg/m². The muzzle starts `h` **below** the sight line, where `h` is your sight height (bore centre →
scope centre, Settings → Rifle and scope, 70 mm here). The launch angle is solved so the trajectory
crosses the sight line exactly at your zero distance, then integrated with 4th-order Runge-Kutta at a
5 cm distance step (converged to well under 0.1 mrad at 200 m). Angular drop is `y / x · 1000` mrad, positive above the point of aim. On top of
that sits your measured card: `hold-over(d) = model_today(d) + [measured(d) − model_atCardWeather(d)]`,
so the number you dial is your measurement corrected to today's air rather than the model's estimate.
Full derivation, validity limits and what is deliberately not modelled (wind, inclined shots, transonic
drag) are in [architecture.md](architecture.md).

---

## Project layout

```
.
├── README.md              this file
├── architecture.md        how it works and why
├── TASKS.md               done / next / not planned
└── pcp-calc/              Next.js 16 app (static export)
    ├── app/               thin pages: /, /bullets, /calibrate, /settings
    ├── components/        client UI (calculator, bullets, calibration, settings, chart, UI kit)
    ├── lib/physics/       atmosphere · trajectory (RK4 + zero solver) · fit (BC estimation) · units
    ├── lib/data/          domain model, seed (your range test), measured card + correction, storage + sanitisation
    ├── lib/state/         reducer + hydration-safe external store
    ├── tests/             server-render smoke tests
    ├── scripts/           static preview server · icon generator · APK build
    ├── public/            manifest, service worker, icons
    ├── assets/            generated artwork the Android icons/splash are cut from (npm run icons)
    ├── capacitor.config.ts  wraps ./out in a native Android app
    └── android/           Gradle project, manifest, launcher icons — created by npm run apk
```

`lib/physics/**` imports no React, no Next, no browser APIs — it is plain testable arithmetic.

---

## Tests

```bash
npm test
```

146 tests across 9 files. They check physical invariants rather than snapshots: ISA air density from
first principles, moist air being lighter than dry air, the vacuum identity `v² − (gt)² = v0²`, the
closed-form quadratic-drag decay `v = v0·e^(−kx)`, integrator step-size convergence, BC recovery from
synthetic data, single-range recalibration, storage sanitisation and the v1→v2→v3 migrations (the last
one moves sight height from each bullet to Settings), **sight height arriving from the rig (Settings)
rather than from the bullet and changing the trajectory when it changes**, drop-table energy reported
in joules for the real bullet mass, the convexity of angular drop (which your measured table violates
and every physical trajectory obeys), and a regression test that re-derives your measured drop table
from the seeded bullet and the calipered 70 mm sight height.

Known gaps (tracked in [TASKS.md](TASKS.md)): no DOM interaction tests for components, no coverage
provider installed, no CI, no browser E2E.

---

## Not planned

No backend, no SQLite, no auth, no second UI codebase, no third-party chart library — with reasons in
[architecture.md §2](architecture.md) and [TASKS.md](TASKS.md). The Android APK is **not** a second
codebase: it is the same `out/` build running in a WebView, which is exactly why adding it was cheap
and why the "no native app" rule still means what it meant — nothing is written twice. A .NET 10 API
+ SQLite path is documented for the day multi-device sync or a shot log actually matters; the client
seam for it already exists.

## License

MIT — see [LICENSE](LICENSE).
