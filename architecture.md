# Architecture — PCP Ballistic Calculator

How the app in `pcp-calc/` works: what it computes, why the code is shaped the way it is, and
where the seams are for future growth.

---

## 0. Decision summary

| Question | Decision | Why |
|---|---|---|
| Backend? | **None.** The whole app is static files. | Ballistics for one rifle is ~200 lines of arithmetic. It runs in 1–3 ms on a phone. A backend adds a network dependency at the exact place (a field range) where you have the least signal. |
| Database? | **None.** `localStorage` + JSON export/import. | The data is one JSON document under ~5 KB (a handful of bullets, weather, settings). SQLite/.NET buys nothing here except a second thing to run. |
| .NET 10? | **Not needed today.** Kept as a documented upgrade path (§2.1). | There is no server-side work to do. The seam that would make a backend cheap already exists (`KeyValueStore`, §7.4). |
| Next.js usage | `output: "export"` → pure static site in `out/` | Deployable by nginx/Caddy/IIS/a NAS/`python -m http.server`, and copyable to a phone. No Node process at runtime. |
| Where physics runs | In the browser, TypeScript, no dependencies | Deterministic, unit-testable, offline-capable, identical on every device. |
| Offline | PWA (manifest + service worker) | At a range you often have no signal. The app must still give hold-over numbers. |
| Units | **SI internally, always.** Conversion only at the display edge. | One unit system in the integrator = no conversion bugs. `lib/physics/units.ts` is the only place that converts. |
| Angular output | **mrad first**, MOA optional | Your measurements are in mrad; PCP hold-over culture is metric. MOA is a display-only conversion. |
| BC source | **Fitted from your own drop table**, not a catalogue | You do not know the BC. You do know how much the pellet missed at 8 ranges. That is enough to invert the model. |
| Drag model | Point mass + **constant-Cd quadratic drag**, BC in kg/m² | Subsonic .177 slug (Mach 0.6–0.8). Cd is flat in that band, so one number reproduces your table to 0.25 mrad RMS. |
| Testing | Vitest, 146 tests, analytic invariants + regression against your range test | The physics must be provably right, not plausibly right. |
| Model vs. your measurements | **Your measurements win.** The card sets the level, the model only supplies the correction between the air you measured in and today's (§7). | No physical trajectory can reproduce your table (it is internally inconsistent at ±0.3 mrad), and forcing one wrecks 150–200 m. A model that cannot match reality should not be what you dial. |

---

## 1. What the app does

Four screens, one shared state:

| Route | Purpose |
|---|---|
| `/` | Calculator: enter a distance (type, slider, ±buttons, or tap a range chip) → get hold-over in mrad/MOA, turret clicks, velocity, energy, time of flight, Mach, a trajectory chart and a drop table. Hold-over comes from your measured card, corrected to today's air, with the raw model shown beside it. Weather is editable right here. |
| `/bullets` | Bullet library: add/edit/duplicate/delete bullets, each with its own mass, caliber, fitted BC, muzzle velocity and zero. JSON backup export/import. |
| `/calibrate` | Turn measured drops (or a chronograph pair) into a BC, and save the drop list as the measured card the calculator uses. |
| `/settings` | Rifle and scope (**sight height**), units, hold-over source (measured card vs model), turret click value, drop-table distances, max range, weather, storage info. |

Everything is one page-load away, works with no network, and is installable to a phone home screen.

---

## 2. Why there is no backend (and when that changes)

### 2.1 The reasoning

A ballistic calculator for **one shooter, one rifle, a handful of bullets** has:

- ~10 KB of user data,
- a computation that takes single-digit milliseconds on a phone,
- no multi-user concerns, no secrets, no server-side authority.

A backend would make the app *worse* in the two places that matter most:

1. **Latency at the range.** A field range is the worst network you will ever use. A server round-trip
   between "type 137 m" and "see 5.6 mrad" is a bad experience you would notice every single shot.
2. **Fragility.** Your home server, its TLS cert, its reverse proxy, its uptime — all become part of
   a tool you need at 6 a.m. with a cold barrel.

So the app is a static bundle plus `localStorage`. The physics is the product; the server is a file
shelf.

### 2.2 Trigger conditions for a .NET 10 API + SQLite

Add a backend **only** when one of these becomes true:

| Trigger | What it unlocks |
|---|---|
| You want the same bullet library on phone **and** tablet **and** laptop without manual JSON transfer | Sync API + SQLite |
| You want a shot log ("what did I shoot at 150 m on 2026-04-11") | SQLite tables + queries |
| You want weather pulled automatically from a station/API | Server-side fetch + cache (keeps API keys off the client) |
| You want to share load data with other shooters | Multi-user data, auth |
| You want heavy models (6-DOF, transonic drag curves `G7`+ tables, wind drift integration) | Server compute, client display |

### 2.3 The seam that makes that upgrade cheap

The app never touches `localStorage` directly. It talks to a 3-method interface
(`lib/data/storage.ts`):

```ts
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
```

Three implementations already exist or are trivial:

- `createBrowserStore()` — `localStorage` (today),
- `MemoryStore()` — used by unit tests,
- a future `RestStore` — `GET/PUT /api/state` against an ASP.NET Core 10 minimal API over SQLite.

Because `AppStateStore` (`lib/state/app-store.tsx`) depends only on that interface, swapping
persistence is a constructor argument change, not a rewrite. The JSON document that
`exportStateJson()` writes today is exactly the payload a `PUT /api/state` would carry.

If a backend is ever built, the recommended shape is deliberately boring:

```
POST /api/state      { version, bullets, weather, settings }   -> upsert, ETag for conflict detection
GET  /api/state      -> the same JSON
GET  /api/shotlog    -> paged rows from SQLite
```

with SQLite in WAL mode, one `state` table (single row per device profile) and one `shot_log` table.
No ORM needed; `Microsoft.Data.Sqlite` is enough.

---

## 3. Source layout

```
pcp-calc/
├── app/                      # Next.js App Router — thin pages, no logic
│   ├── layout.tsx            # shell, metadata, viewport, fonts, theme-color
│   ├── page.tsx              # <Calculator />
│   ├── bullets/page.tsx      # <BulletLibrary />
│   ├── calibrate/page.tsx    # <Calibration />
│   ├── settings/page.tsx     # <SettingsPanel />
│   └── globals.css           # Tailwind v4 + design tokens (dark default, light via media query)
├── components/               # "use client" UI, all state via useAppStore()
│   ├── app-shell.tsx         # header, nav (top on md+, bottom bar on phone), SW registration
│   ├── calculator.tsx        # distance entry, hold-over card, drop table, chart, weather
│   ├── bullet-library.tsx    # CRUD + JSON backup
│   ├── calibration.tsx       # measured drops -> fit -> apply to bullet
│   ├── settings-panel.tsx    # units, turret, ranges, storage
│   ├── trajectory-chart.tsx  # dependency-free SVG chart
│   ├── weather-editor.tsx    # T / P / RH entry with unit-aware fields
│   └── ui.tsx                # Card, Button, NumberField, SegmentedControl, Checkbox, Stat, Notice
├── lib/
│   ├── physics/              # pure functions, no React, no DOM, no I/O
│   │   ├── atmosphere.ts     # Weather -> air density
│   │   ├── trajectory.ts     # ShotConfig -> Trajectory (RK4, zero solver, drop table)
│   │   ├── fit.ts            # measured drops -> BC (optimiser)
│   │   └── units.ts          # SI <-> display units
│   ├── data/                 # domain model + persistence
│   │   ├── types.ts          # Bullet, Settings, DopeCard, AppState
│   │   ├── seed.ts           # your .177 range test as the default state
│   │   ├── shot.ts           # Bullet + Weather -> ShotConfig -> PreparedShot
│   │   ├── dope.ts           # measured card + model residual correction (§7)
│   │   └── storage.ts        # KeyValueStore, sanitisation, v1→v2→v3 migration, import/export
│   └── state/app-store.tsx   # reducer + useSyncExternalStore + persistence scheduling
├── tests/render.test.tsx     # server-render smoke tests of all four screens
├── scripts/serve-static.mjs  # serves ./out for `npm run start`
├── public/{manifest.webmanifest, sw.js, icons}
└── vitest.config.mts
```

Dependency direction is strictly one-way and enforced by nothing but discipline:

```
app/  ->  components/  ->  lib/state  ->  lib/data  ->  lib/physics
                                              (physics imports nothing)
```

`lib/physics/*` imports no React, no `next/*`, no browser API. That is what makes it testable in a
plain Node environment (`environment: "node"` in `vitest.config.mts`) and what would let the same
files be reused in a CLI, a Node service, or a .NET-free worker without edits.

---

## 4. Data flow of one calculation

```
Weather {T,P,RH}     Settings {sightHeightMm}     Bullet {mass, caliber, BC, v0, zero}
        |                     |                             |
        v                     |  the rig: one number       |
 atmosphere.ts                |  shared by every pellet     |
 airDensity()  -----+         |                             |
                    |         |                             |
                    +---------+-------------+-------------+
                                              v
                                   shot.ts::toShotConfig
                                              |
                                              v
                              ShotConfig (all SI)
                                   { muzzleVelocityMs, ballisticCoefficientKgM2,
                                     sightHeightM, zeroDistanceM,
                                     airDensityKgM3, gravityMps2 }
                                            |
                                            v
                              trajectory.ts::simulate()
                                 1. solveLaunchAngle()  (secant + bisection)
                                 2. integrate()         (RK4, 5 cm step)
                                 3. apex / zero crossings / impact
                                            |
                                            v
                                   Trajectory (points[])
                                            |
             +-----------------------------+-----------------------------+
             v                             v                             v
      angularDropMrad()             dropTable()                  summarizeShot()
      (model's opinion)         (rows per range)          (v, E, Mach, TOF, angle)
             |                             |                             |
             v                             v                             v
      dope.ts::correctedDrop        units.ts::*ToDisplay          velocity / energy / TOF
      model_today(d)+residual(d)    (m/cm | in, m/s | ft/s, J | ft·lbf)   (model only: a card
             |                                                       carries no velocity)
             v
      units.ts::angularToDisplay   ->   click helper:  clicks = -drop / clickValue
      (mrad | MOA)
```

Everything downstream of `Trajectory` is a pure read. Changing weather, distance, or units never
re-fits anything; changing BC re-fits only when you press **Fit parameters**.

---

## 5. The physics

### 5.1 Coordinate frame and sign convention

```
 sight line (where the scope points)  y = 0
        ^                       *  <- apex (+1.5 cm at 35 m)
        |          .-'  `-.
        |     .-'          `-.   y(zero) = 0 by construction
 muzzle o-'-....--------------\--------> x (downrange)
        (0, -sightHeight)      `-.
                                 `-.  y < 0  => impact BELOW point of aim
```

- `x` — distance **along the sight line**, positive downrange.
- `y` — height above the sight line.
- The muzzle starts at `(0, -sightHeightM)` and is tilted up by the launch angle `α`.
- `α` is not an input. It is solved so the trajectory crosses `y = 0` exactly at the zero distance.

**Sign convention (used everywhere, including your measurements):**
`+` = impact **above** the point of aim, `−` = impact **below**. Your table's `+0.6 mrad` at 25 m
therefore means "the pellet hit 1.5 cm high at 25 m", which is exactly what a 50 m zero does.

Angular drop is defined as `y / x * 1000` (mrad) — the angle you would dial, not the flight-path
angle. Turret clicks use `-drop / clickValue` (a negative drop means dial **up**).

### 5.2 Air density (`atmosphere.ts`)

CIPAC/ITMA-style ideal-gas mixture:

```
ρ = Pd / (Rd · T) + Pv / (Rv · T)
Pd = P − Pv
Pv = RH · Psat(T)
Rd = 287.052 J/(kg·K)   Rv = 461.495 J/(kg·K)
```

Saturation vapour pressure uses the Magnus / Alduch-Eskandari-Kanda form:

```
Psat(T) = 610.78 · exp(17.27 T / (T + 237.3))   Pa,  T in °C
```

(supercooled-water curve below 0 °C, as CIPAC does).

For your test day (+15 °C, 998 hPa, 63 % RH): **ρ = 1.2017 kg/m³**, i.e. a density factor of
**0.981** versus ISA sea level (1.225 kg/m³). Sanity tests assert the ISA value is reproduced from
15 °C / 1013.25 hPa / 0 % RH, and that moist air is *lighter* than dry air (a common intuition
inversion that a naive implementation gets wrong).

Note the app stores pressure in **hPa** internally: your test day is **998 hPa** (= 99.8 kPa). Whichever
pressure unit you pick in Settings is converted to hPa at the display edge (`998 kPa = 9980 hPa`), and
`validateWeather()` rejects anything outside 600–1110 hPa with a message that asks *"did you enter
kPa?"* — because that typo is the single most common way to break a ballistic calculation.

### 5.3 Drag model (`trajectory.ts`)

Point mass with quadratic drag:

```
a_drag = −(ρ · v / (2 · BC)) · v⃗          k = ρ / (2 · BC)
BC = m / (Cd · A)   [kg/m²]
```

`BC` here is the **SI sectional density divided by Cd** (the "G1-style in SI" definition used by
CIPAC), not the American `lb/in²` BC with a G1 drag table. For your bullet:

```
m = 1.000 g,  d = 4.52 mm  ->  A = 1.605e-5 m²
BC = 352.8 kg/m²           ->  Cd = m / (A · BC) = 0.177
```

`impliedDragCoefficient()` is displayed on the calculator precisely so you can sanity-check that
number: 0.10–0.20 is the right band for a blunt-ish subsonic .177 slug. If a fit ever produces
Cd > 0.6 or Cd < 0.02, the fit is wrong, not the pellet.

**Why constant Cd is legitimate here.** Your slug flies Mach 0.77 at 50 m down to Mach 0.62 at
200 m. In that band Cd is dominated by form drag and is nearly flat; there is no transonic drag
rise. A single scalar therefore reproduces the whole table — and the regression test proves it
(§11.3). The model would *not* be legitimate for a pellet that starts supersonic and decelerates
through Mach 1 mid-flight; that needs a Mach-dependent Cd table, which is out of scope by design.

### 5.4 Integrator

Classic 4th-order Runge-Kutta on `(x, y, vx, vy)` with a **distance-targeted** time step:

```
dt = min(stepMeters / speed, 0.002 s)     stepMeters = 0.05 m by default
```

Why distance-targeted rather than fixed `dt`: a drag-decelerating pellet covers less ground per
second as it slows, so a fixed time step makes error *grow* downrange. Fixing the step in metres
makes positional error uniform along the whole trajectory.

Convergence is not assumed, it is tested: `trajectory.test.ts` compares a 5 cm step against a 2 mm
step at 200 m and requires the difference to be **< 0.1 mrad**. For your load the actual difference is
**7e-5 mrad** — the numerical error is more than three orders of magnitude smaller than the 0.25 mrad
measurement noise the model is fitted against, so integration error is not what limits accuracy; your
measurements are. For scale, 0.1 mrad at 200 m is 2 cm.

Two analytic invariants guard the integrator against silent algebra mistakes:

- **Vacuum test** — with drag off, `v² − (g·t)²` must stay exactly `v0²` and the flight angle must
  equal `atan2(−g·t, v0)`.
- **Pure-drag test** — with gravity off, quadratic drag has the closed form `v(x) = v0 · e^(−k·x)`,
  so the numerical result must match the exponential to 4 decimal places.

### 5.5 Solving the zero (`solveLaunchAngle`)

The scope is fixed; the *launch angle* is what a real rifle's bore gives you. The app solves for the
`α` that makes `y(zeroDistance) = 0`.

- Seed: vacuum estimate `α₀ = atan2(sightHeight + ½ g z²/v0², z)` — accurate to a few mrad, and drag
  always pushes the true angle slightly higher.
- Bracket expansion upward (drag means the vacuum estimate undershoots), then a **secant iteration
  with bisection fallback** whenever the secant leaves the bracket.
- Convergence target `|b − a| < 1e-11 rad` (≈ 2e-6 mrad — far below any measurement you can make).
- Callers pass the previous angle as a `hint`, which turns a 10-evaluation solve into 3–4 during a
  fit. That single optimisation is most of why calibration is fast enough to run on every keystroke.
- If the projectile cannot reach the zero distance at all, a typed `ZeroReachableError` is thrown
  with actionable text ("lower the zero distance, raise the muzzle velocity, or raise the BC")
  instead of returning nonsense.

`zeroCrossingsM` reports both sight-line crossings. For the seeded slug with the calipered 70 mm
sight height: **20.6 m** and **50.0 m**. Between them the pellet flies above the aim point (max
+1.5 cm at 35.4 m). "Impact distance" in the code means *where the trajectory falls back to bore
height* (69.5 m for the seeded slug) — it is a
frame-relative marker, **not** a prediction of where the pellet hits the ground, which depends on
target height and is deliberately not modelled.

### 5.6 What is produced per distance

`TrajectoryPoint { x, y, t, v, angleRad }` per ~5 cm, then on demand:

| Output | Formula |
|---|---|
| Angular drop | `y / x · 1000` mrad |
| Linear drop | `y` metres (shown as cm or in) |
| Velocity | `|v⃗|` |
| Energy | `½ m v²` |
| Mach | `v / (331.3 · √(1 + T/273.15))` |
| Time of flight | `t` |
| Flight-path angle | `atan2(vy, vx)` in mrad |
| Turret clicks | `−drop / clickValue` |

Distances the pellet never reach return `reached: false` / `null` / `NaN` rather than extrapolated
numbers. The UI turns that into an explicit message ("the trajectory dies out around N m").

### 5.7 What the model deliberately does **not** do

| Omitted | Consequence | Acceptable because |
|---|---|---|
| Wind drift | No windage hold | You zero and shoot point-of-aim at ≤200 m; wind for a subsonic 1 g slug at 150 m is large but is a *separate* hold, and a wrong wind model is worse than none |
| Inclined / angled shooting | No rifle-angle cosine correction | At ≤200 m with flat targets the error is small; it is on the task list because it is the biggest real-world gap |
| Spin drift, Coriolis, vertical drop of Earth | Sub-0.1 mrad at these ranges | Irrelevant for a 1 g slug at 200 m |
| Transonic / Mach-dependent Cd | Only valid while subsonic | Your slug is Mach 0.62–0.81 throughout |
| Barrel angle vs. sight line beyond `α` | No parallax modelling | Scopes are parallax-corrected at or near the zero |
| Ground impact | Frame-relative only | Target height is unknown to the app |

---

## 6. Calibration: getting a BC you never measured

### 6.1 The problem

You have no BC. You have this:

```
+15 °C, 63 % RH, 998 hPa, 280 m/s, sight height 70 mm (calipered)
25 m +0.6 | 50 m 0.0 (zero) | 75 m -1.1 | 100 m -2.9 | 125 m -4.8 | 150 m -7.3 | 175 m -9.5 | 200 m -11.2   [mrad]
```

A drop table is a *measurement of the integral of drag over distance*. So the app inverts the
model: search for the BC whose predicted drop table best matches yours.

### 6.2 Identifiability — why some things must be held fixed

Drop data alone cannot separate **BC**, **muzzle velocity** and **sight height**. A faster pellet
with more drag and a slower pellet with less drag can produce the same table. Fitting all three at
once is a classic ill-posed problem: the optimiser wanders to an unphysical combination that still
fits your numbers.

So `fitFromDrops()` fits **BC only** by default, and holds fixed whatever you measured with an
instrument:

- `muzzleVelocityMs` — fixed if you own a chronograph (you do: 280 m/s).
- `sightHeightM` — fixed if you calipered it.
- `ballisticCoefficientKgM2` — **always** fit; it is the unknown.

Both extra parameters are opt-in checkboxes in the UI, labelled with when to use them ("only if you
have no chronograph", "only if you have not measured it"). `FIT_BOUNDS` clamps every free parameter
to physical ranges (BC 10–6000 kg/m², velocity 30–1500 m/s, sight height 2–150 mm), so a runaway fit
cannot produce a pellet that violates physics.

### 6.3 Optimiser pipeline (`fit.ts`)

```
1. chooseStarts   log-spaced scan, 16 points across each free parameter's full range,
                  coarse integration (0.35 m step)  -> best basin(s)
2. gaussNewton    damped Gauss-Newton (Levenberg-Marquardt λ), finite-difference Jacobian,
                  0.15 m integration step, up to 40 iterations, λ×6 on failure / ×0.25 on success
3. coordinatePolish  bounded coordinate descent, halving steps, 5 passes  -> fixes the BC<->v0 trade-off
                     Gauss-Newton stalls on
4. final evaluate  0.05 m step (full accuracy) -> residuals, RMS, mean |err|, max |err|
```

Multiple starts (one from your stored BC, one from the best grid point per parameter) are kept
because a hand-loaded pellet often starts from a wildly wrong BC — or none. The scan makes the fit
insensitive to the starting guess: a test asserts a BC starting at 150 recovers the true value.

Determinism: no randomness, no iteration-count dependence on wall-clock, no external libraries. The
same inputs always give the same BC, which matters because you will re-run the same fit at the range
and expect the same number.

Speed: a test asserts a full 8-point fit finishes in well under a second on a laptop; in practice it
is ~100–300 ms, which is why the UI can offer "Apply" instantly.

### 6.4 Your test, fitted

With `v0 = 280 m/s` held fixed and the **calipered 70 mm sight height** used, the fit lands on
**BC = 352.8 kg/m²** (implied Cd 0.177). Model vs. your measurements:

| Range | Measured | Model | Error |
|---|---|---|---|
| 25 m | +0.6 | +0.30 | −0.30 |
| 50 m | 0.00 | 0.00 | 0.00 |
| 75 m | −1.1 | −1.34 | −0.24 |
| 100 m | −2.9 | −3.02 | −0.12 |
| 125 m | −4.8 | −4.90 | −0.10 |
| 150 m | −7.3 | −6.96 | +0.34 |
| 175 m | −9.5 | −9.17 | +0.33 |
| 200 m | −11.2 | −11.54 | −0.34 |

**RMS 0.25 mrad, worst point 0.34 mrad.** The errors alternate sign, which is the signature of
measurement noise (aim/hold/group), not of a wrong model — a wrong model would show a systematic
curve. The regression test enforces RMS < 0.35 mrad and max error < 0.5 mrad, so a future refactor
that quietly breaks the model fails CI.

Before the sight height was measured (40 mm assumed) the same fit gave BC 422.3 kg/m², Cd 0.148 and
RMS 0.277 mrad, with 100 m at −3.21. Measuring the rig improved the fit *and* moved the fitted BC by
70 kg/m² — the pellet never changed, only the distance from its bore to your scope.

Interpretation guide shown in the UI: **< 0.5 mrad** = the model matches your shooting;
**> 1 mrad** = suspect the sight height or the muzzle velocity before suspecting the drag model.
For scale, 0.5 mrad at 100 m is 5 cm; 1 mrad at 200 m is 20 cm.

Predicted companion numbers for this load (useful cross-checks you can verify at the range):

| Range | Drop | Linear | Velocity | Energy | Mach | TOF |
|---|---|---|---|---|---|---|
| 50 m | 0.00 | 0 cm | 257.1 m/s | 33.1 J | 0.76 | 0.186 s |
| 100 m | −3.02 | −30 cm | 236.2 m/s | 27.9 J | 0.69 | 0.389 s |
| 150 m | −6.96 | −104 cm | 216.9 m/s | 23.5 J | 0.64 | 0.610 s |
| 200 m | −11.54 | −231 cm | 199.3 m/s | 19.9 J | 0.59 | 0.851 s |
| 250 m | −16.77 | −419 cm | 183.1 m/s | 16.8 J | 0.54 | 1.113 s |

### 6.5 "Another day, another weather" — the key conceptual point

**BC does not depend on the weather.** `BC = m / (Cd · A)` contains no air density. Weather enters
the trajectory only through `ρ` in `k = ρ/(2·BC)`.

So there are two different situations and they have different recipes:

**Case A — weather changed, rifle and pellet unchanged.**
Do **not** re-fit. Just type the new temperature / pressure / humidity into the weather card. The
model recomputes ρ and the whole table shifts. Denser air (cold, high pressure) = more drag = more
drop. This is the whole point of storing weather separately from the bullet.

**Case B — the rifle/pellet behaviour changed** (new pellet lot, dirty barrel, different power
setting, different velocity).
Re-measure and re-fit. The cheapest useful recipe, and the reason the calibration screen keeps your
last measurements:

1. Shoot a group at **one** known range (100 m is ideal) with a known point of aim.
2. Enter that single `distance + drop` row.
3. Fit **BC only**.
4. Apply.

A test proves this works: with BC changed from 250 to 300, fitting on just the zero plus one
measurement at 100 m recovers BC to within 10 % and predicts the drop at 200 m to within **0.1 mrad**.
One well-shot group is enough to recalibrate a whole day.

**Case C — you have a chronograph.** Two readings (muzzle + at range) give BC directly, no drop
data needed. For quadratic drag, speed decays exponentially with path length:

```
v(s) = v0 · e^(−k·s),  k = ρ / (2·BC)   ->  BC = ρ·s / (2 · ln(v0/v))
```

`ballisticCoefficientFromVelocity()` solves this by bisection against the same trajectory model the
calculator uses (so the number it stores is the number the calculator consumes), and rejects
impossible inputs (at-range velocity ≥ muzzle velocity, or a velocity no physical projectile could
keep over that distance).

### 6.6 Fit quality is shown, not assumed

After every fit the UI prints per-row residuals (`measured / model / error`), RMS, worst point, and a
before/after table across your usual ranges. You are never asked to trust a black-box number; you
are shown the model's own opinion of itself.

---

## 7. The measured card: why the model cannot match your table, and what does

A fitted model is an approximation. Your measurements are observations. When they disagree, the
measurements win — so the app no longer asks you to trust the model for the number you dial.

### 7.1 Your drop table is not physically self-consistent

This is the important finding, and it is testable rather than arguable.

Beyond the zero, a projectile's **angular drop must become more negative at an increasing rate**:
each equal 25 m step must drop *more* than the previous one. Gravity acts for longer, and drag has
slowed the pellet, so both effects compound. This is not an assumption of the implementation — it is
a property of the trajectory family. A test scans the cross product of BC {50, 100, 200, 422, 900,
2000, 6000} kg/m² × muzzle velocity {150, 200, 280, 400, 600} m/s × sight height {10, 40, 120} mm ×
zero {25, 50, 100} m — 315 configurations, 150+ of them valid trajectories that reach every measured
range — and finds **zero violations**.

Your table's step sizes beyond 50 m:

```
50 -> 75   -1.10
75 -> 100  -1.80
100 -> 125 -1.90
125 -> 150 -2.50     <- the drop accelerates
150 -> 175 -2.20     <- ...and then decelerates: impossible
175 -> 200 -1.70     <- and again
```

The pellet cannot start falling *less* steeply between 150 and 200 m than it was between 125 and
150 m. So at least one of the 125 / 150 / 175 / 200 measurements is off by several centimetres —
from group size, hold, rest technique, or range estimation (0.3 mrad at these ranges is about 3 cm at
100 m, 6 cm at 200 m, or roughly 4 m of range error).

A cubic polynomial fits your table to **0.093 mrad RMS** — but a cubic is not a trajectory, it is just
a curve through eight points, and the wiggle it exploits is the unphysical part.

### 7.2 How hard the model was made to try

Every lever available was pulled and measured:

| Model / free parameters | Result | RMS vs your table | Drop at 100 m |
|---|---|---|---|
| BC only (v0 280, h 40 mm assumed) | BC 421.8 | 0.277 mrad | −3.21 |
| **BC only (v0 280, h 70 mm measured)** | **BC 352.8** | **0.252 mrad** | **−3.02** |
| BC + sight height | BC 376, **h 58.4 mm** | 0.235 mrad | −3.09 |
| BC + muzzle velocity | BC 291, **v0 294.9 m/s** | 0.255 mrad | −3.08 |
| BC + velocity + sight height | BC 405, v0 277, h 60.7 mm | 0.234 mrad | −3.11 |
| Drag exponent free (power-law drag, n fitted) | n ≈ 1.5–2.0 | 0.276 mrad | −3.21 |
| Force an exact match at 100 m | BC 1122 | **0.889 mrad** | −2.90, but 200 m becomes −9.67 vs your −11.2 |
| Fit only 25–125 m | BC 780 | 0.184 near / 0.693 overall | −2.98, but 200 m becomes −10.09 |

Two conclusions:

1. **The drag law is not the problem.** Fitting the drag exponent changes nothing (0.277 → 0.276).
   Quadratic drag is right for a subsonic slug.
2. **~0.23 mrad is the floor.** No physical trajectory in this family can do better against your
   table, because the table itself is inconsistent at that level. Matching 100 m exactly costs
   1.5 mrad at 200 m — 30 cm of error where you actually shoot.

Sight height was the single most valuable unknown — it drives the launch angle, the near zero and the
shape of the whole curve. Fitting it suggested ~58–61 mm; **it was then calipered at 70 mm**, and that
measured value is what the app uses:

| Sight height | Fitted BC | Implied Cd | Fit RMS | Drop at 100 m |
|---|---|---|---|---|
| 20 mm | 489 | 0.128 | 0.386 | −3.44 |
| 40 mm (the original guess) | 422 | 0.148 | 0.277 | −3.21 |
| 58 mm (what a fit prefers) | 377 | 0.165 | **0.235** | −3.10 |
| **70 mm (measured)** | **353** | **0.177** | 0.252 | **−3.02** |

Measuring it moved the fitted BC by 70 kg/m² and brought the model to within 0.12 mrad at 100 m and
0.10 mrad at 125 m — the ranges that matter most. The residual disagreement (0.25 mrad) is now
concentrated at 25 m and at 150–200 m, which is exactly where §7.1 showed the data itself is
unreliable.

It is stored in **Settings → Rifle and scope**, not on the bullet, because it is a property of the
rifle and scope: every pellet you put in this rifle shares the same 70 mm.

### 7.3 The design: the card sets the level, the model supplies the shape

So the model is no longer asked to reproduce the table. It is used as a *correction term*:

```
corrected(d) = model_today(d) + residual(d)
residual(d)  = measured(d) − model_reference(d)
```

- `model_reference` — the bullet's model at the **weather the card was shot in**.
- `model_today` — the same bullet's model at **today's weather**.
- `residual(d)` — measured minus model at each measured range, **linearly interpolated** between
  measured ranges and **held constant** outside the measured span.

At the card's own conditions `model_today = model_reference`, so
`corrected(d) = model(d) + measured(d) − model(d) = measured(d)` **exactly**. The calculator now
reports −2.90 mrad at 100 m, +0.60 at 25 m, −11.20 at 200 m — your numbers.

Change the weather and the card follows the model's *difference*, not its absolute value:

```
corrected_cold(d) − corrected_warm(d) = model_cold(d) − model_warm(d)
```

which is the part the model is genuinely good at. A test asserts this identity holds to 9 decimal
places, and that a 0 °C / 1020 hPa / 80 % day shifts the corrected 150 m hold-over the same way it
shifts the model's.

### 7.4 Why additive and not multiplicative

The obvious alternative — scale the measured drop by `model_today / model_reference` — breaks exactly
where it matters most: **at the zero both models are zero**, so the ratio is 0/0 and the near field
becomes numerically meaningless. An additive correction is well-behaved everywhere, and it keeps the
zero a zero: if the card says 0 at 50 m, the corrected value at 50 m stays 0 under any weather, which
is what a shooter expects from a zero.

### 7.5 Data model

```ts
interface DopeCard {
  bulletId: string;      // a card belongs to one bullet
  weather: Weather;      // the air it was shot in — corrections are relative to this
  measurements: DropMeasurement[];
  savedAt: string;
}
AppState { ..., dope: DopeCard | null }
STATE_VERSION = 3
```

- `AppState.measurements` (v1) became `AppState.dope` (v2). Version 1 files are migrated on load:
  the stored measurement list becomes a card stamped with the stored weather and the active bullet.
- Sight height used to live on each bullet (v2). It moved to `Settings` (v3), because it is a property
  of the rifle and scope rather than of the pellet. Version 2 files are migrated by taking the active
  bullet's value (or the first valid one) as the rig measurement.
- Editing the drop list restamps the card with the current bullet and the current weather, so a card
  can never silently describe conditions the app is no longer showing.
- Deleting the bullet a card belongs to clears the card. A card belonging to a different bullet is
  ignored by the calculator (with an explicit message), not silently reused.
- `Settings.dropSource: "measured" | "model"` chooses the headline number; the model value is always
  shown alongside it.

Code: `lib/data/dope.ts` (pure, no React), tested in `lib/data/dope.test.ts`.

### 7.6 What the calculator shows

- A **Measured / Model** toggle in the hold-over card.
- The headline number, plus a line: `measured −2.90 mrad · model −3.02 mrad · correction +0.12 mrad`,
  and where the value came from (*measured at this range* / *interpolated* / *model shifted by the
  nearest measured offset).
- Drop table: hold column = corrected, second column = uncorrected model, with `●` on measured rows
  and `◦` on interpolated ones.
- Chart: measured points drawn as dots under the corrected curve, so you can see exactly where the
  card ends and the model takes over.
- Velocity, energy, time of flight and Mach stay model values — a drop card carries no velocity
  information, and the UI says so.

### 7.7 What this does not fix

- It does not make the model agree with an inconsistent table; it stops pretending.
- It does not extend trust beyond the measured span: past 200 m the number is the model's, shifted
  by the last measured offset. That is labelled `extrapolated` everywhere it appears.
- It does not correct for a *changed rifle* (new pellet lot, new power setting, dirty barrel). If the
  pellet's behaviour changes, re-measure and re-save the card; the correction term only handles the
  air.
- If you change BC or muzzle velocity, residuals are recomputed against the new model, so the card
  stays consistent — but a card saved against a bad model is a card that hides a bad model at the
  measured ranges only.

---

## 8. State and persistence

### 8.1 Shape (`lib/data/types.ts`)

```ts
AppState {
  version: 3
  bullets: Bullet[]        // each: caliberMm, massG, ballisticCoefficientKgM2,
                           //       muzzleVelocityMs, zeroDistanceM, notes
  activeBulletId: string
  weather: Weather         // temperatureC, pressureHpa, humidityPct
  settings: Settings       // unitSystem, angularUnit, dropSource, clickValue, clickUnit,
                           // tableDistancesM, maxRangeM, sightHeightMm, pressureUnit,
                           // temperatureUnit
  distanceM: number        // last range on the calculator
  dope: DopeCard | null    // { bulletId, weather, measurements, savedAt }
}
```

`version` exists so migrations are explicit rather than guessed: version 1 stored a bare
`measurements` list and `sanitizeAppState()` converts it into a `dope` card stamped with the stored
weather; version 2 stored `sightHeightMm` on every bullet and it is lifted into `Settings`. See §7.5.

Units in storage are the units a *person* uses: grams, millimetres, m/s, metres, °C, hPa. Only
`toShotConfig()` converts to SI for the integrator. Storing what a human wrote down (sight height in
mm because that is what a caliper reads) avoids a class of conversion bugs and makes the JSON
hand-editable.

### 8.2 Reducer (`lib/state/app-store.tsx`)

`storeReducer(state, action)` is a pure function and is unit tested directly, without React:
`hydrate`, `selectBullet`, `addBullet`, `updateBullet`, `duplicateBullet`, `deleteBullet`,
`setWeather`, `setSettings`, `setDistance`, `setMeasurements`, `saveDope`, `clearDope`,
`replaceState`, `reset`.

Card rules the reducer enforces: editing the drop list restamps the card with the active bullet and
the current weather; an empty drop list clears the card; deleting the bullet a card belongs to clears
the card; deleting the last bullet is refused.

Two invariants worth noting:

- `deleteBullet` refuses to empty the library — the app always has an active bullet, so no screen has
  to handle a null bullet.
- `updateBullet` re-applies `id: b.id` after the patch, so a patch can never change an identity.

### 8.3 `useSyncExternalStore` and the static-export hydration problem

This is the subtlest part of the architecture and the reason the store is a class rather than a
`useState` in a provider.

The build is a **static export**: the HTML for `/` is prerendered at build time, on a machine that
has no `localStorage` and no idea what your bullets are. The browser then hydrates that HTML. If the
first client render produced *different* content (because it read localStorage immediately), React
would either warn or throw away and re-render the whole tree — visible flicker on a phone.

The fix is the three-argument form of `useSyncExternalStore`:

```ts
useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
//                                                        ^ always the seeded state
```

- Server / first client paint: `getServerSnapshot()` → the seeded state → byte-identical to the
  prerendered HTML.
- After hydration: `useEffect(() => store.hydrate())` reads `localStorage` once and, if it differs,
  emits a single update. Your real data appears one microtask after hydration, with no flicker.

This is also why `SEED_TIMESTAMP` is a fixed constant instead of `new Date()`: a timestamp generated
during prerender and a different one generated in the browser would make the two snapshots differ.

Persistence is coalesced with `queueMicrotask`, so a burst of slider drags produces one write, not
hundreds.

### 8.4 The persistence seam

`KeyValueStore` (§2.2) plus `MemoryStore` for tests plus `createBrowserStore()` for the browser.
`createBrowserStore()` is SSR-safe (it checks `globalThis.localStorage` at call time) and
failure-tolerant: no storage (SSR, private mode, quota exceeded) still leaves a fully working app,
just one that forgets on reload.

### 8.5 Nothing trusted after it leaves the app

Every value read back from storage or imported from a file goes through `sanitizeAppState()` →
`sanitizeBullet()` / `sanitizeSettings()` / `sanitizeWeather()` / `sanitizeMeasurements()`:

- numbers clamped to physical ranges, non-finite values replaced by defaults,
- a bullet with a non-numeric BC or velocity is **dropped**, not defaulted (a bullet with a made-up BC
  is worse than no bullet),
- duplicate ids removed, a dangling `activeBulletId` repaired to the first bullet,
- strings trimmed and length-capped,
- a state with zero bullets is rejected outright.

This is what makes "import a JSON file you typed by hand" a safe operation, and it is why the import
flow can offer `replaceState` without a validation step.

---

## 9. UI and responsive design

- **Hold-over source**: a Measured / Model segmented control in the hold-over card. Under the big
  number the app prints `measured −2.90 mrad · model −3.02 mrad · correction +0.12 mrad` and where
  the value came from. The uncorrected model is never hidden, so you can always see how far the card
  and the model disagree.
- **Drop table**: `●` marks a row that was actually measured, `◦` one interpolated between measured
  ranges, and the last column is the uncorrected model.
- **Chart**: measured points are drawn as dots under the corrected curve, so the point where the card
  ends and the model takes over is visible.
- **Layout**: `max-w-4xl` centred column. On `md+` a horizontal nav under the header; on phones a
  sticky **bottom** tab bar (thumb reach) with short labels (`Calc · Bullets · Fit · Setup`).
- **Touch targets**: every control is `min-h-10`/`min-h-11` (40–44 px). Range chips, ±delta buttons
  (−25 −5 −1 +1 +5 +25) and a range slider give three ways to set a distance without a keyboard.
- **Numbers**: `.nums` = `font-variant-numeric: tabular-nums` on every numeric cell, so digits do not
  jitter horizontally while a value changes — important when you are reading a number at the range.
- **Type scale**: the hold-over number is `text-5xl`/`text-6xl` — readable at arm's length.
- **Theme**: dark by default (`prefers-color-scheme: light` switches tokens). A ballistic calculator
  gets used in a dark hide and at dawn; the accent is amber for contrast against a dark reticle view.
- **Chart**: hand-rolled SVG (`trajectory-chart.tsx`), no chart library. Fixed 360×210 viewBox scaled
  to width, "nice" tick steps (1/2/2.5/5/10 decades), toggle between angular (mrad) and linear (cm).
  A dependency-free chart is ~140 lines and costs nothing in bundle size; a library would cost
  tens of KB on a device that may be loading this over a field hotspot.
- **Tables**: drop table columns collapse progressively (`sm:`, `md:`) so the essential columns
  (range, drop, hold) survive on a narrow screen while velocity/energy/TOF appear when there is room.
- **State feedback**: header shows the active bullet and current weather; an `online/offline` pill
  reflects `navigator.onLine`.

---

## 10. Offline, install, hosting

### 10.1 Static export

`next.config.ts`:

```ts
output: "export",        // -> ./out, plain HTML/CSS/JS. No server runtime.
trailingSlash: true,     // -> /bullets/index.html, resolvable by any static server
```

`output: "export"` is incompatible with Cache Components / PPR in this Next version, which is why the
template flags are not used. `npm run start` runs `scripts/serve-static.mjs` — a ~90-line Node static
server with path-traversal protection, correct MIME types, immutable caching for `/_next/static/*`,
and a `service-worker-allowed: /` header — purely so you can preview the real production bundle
locally. It is not part of the product.

### 10.2 Service worker (`public/sw.js`)

Two strategies, because the two kinds of file behave differently:

| Request | Strategy | Reason |
|---|---|---|
| HTML documents and Next navigation payloads (`.txt`, `.rsc`) | **network-first**, cache fallback, then the cached `/` shell | A new build must be picked up as soon as there is signal |
| Hashed same-origin assets (`/_next/static/*`, icons) | **stale-while-revalidate** | Content-hashed filenames never change, so a cached copy is always correct |

Cross-origin requests are ignored; Next internal routes are skipped. `install` precaches the four
routes but uses `Promise.allSettled` and never fails the install — installing while offline is a
normal case, not an error. `activate` deletes caches from older `VERSION`s.

Net effect: open the app once with signal, and afterwards it works in airplane mode.

**One quirk of the static export, worth knowing because it looks alarming in a log.** Next's client
asks for a nested segment payload as `/bullets/__next.bullets.__PAGE__.txt`, but `next build` writes
that file as `bullets/__next.bullets/__PAGE__.txt` — a directory where the URL has a dot. On any plain
static host, and inside the APK, exactly those requests 404. It is cosmetic: the `_tree` and `_full`
payloads resolve, navigation stays client-side (verified by setting a `window` marker before a tab
change and reading it after — it survives), and only the prefetch is wasted. The mapping is Next's to
fix, not this app's; tracked in TASKS.md.

### 10.3 The one real constraint: secure context

Service workers only register on a **secure context**. `http://localhost` is fine. `https://…` is
fine. `http://192.168.1.20:3000` from your phone is **not** — the app will work, but the service
worker will not register and there will be no offline caching.

Practical options. On Android there is a way to sidestep the rule completely — build the APK
(§10.6), which has no origin and no server to get wrong. For everything else, easiest first:

1. **Tailscale Serve** on the home server — gives you an HTTPS origin with a valid cert on phone and
   tablet with no port forwarding and no cert management.
2. **Caddy with an internal CA** (`tls internal`) or a reverse proxy with a LAN cert — needs the root
   cert installed on the phone once.
3. **`npm run dev` / `npm run start` on the tablet itself** (Termux) or opening the built files
   locally — localhost is a secure context, so the SW registers.
4. Accept no offline cache and always open it with signal. (Physics still runs locally; only the
   *first load* needs the network.)

### 10.4 Storage durability on iOS

WebKit evicts script-writable storage (localStorage) for ordinary web pages after a period without
user interaction; pages **added to the home screen** are treated as installed apps and are exempt.
So on an iPhone/iPad: **Add to Home Screen**, and use it from the icon. The JSON export in
Bullets → Backup exists precisely so a wiped browser profile is an inconvenience rather than a loss.

### 10.5 Hosting options

| Option | Command / tool | Notes |
|---|---|---|
| Android phone or tablet | `npm run apk` | no server, no network, no permissions; see §10.6 |
| Home server, LAN | nginx / Caddy serving `out/` | add HTTPS if you want offline install |
| Home server, remote | Tailscale Serve | HTTPS + no port forwarding |
| Any static host | upload `out/` | the app never calls an API, so there is nothing to configure |

### 10.6 The Android APK (Capacitor)

The PWA route has a structural weakness for a field tool: it needs a secure context, which means it
needs *a server and a connection on the day you install it* — the one thing you are trying to stop
relying on. Capacitor removes that dependency by shipping `out/` inside the app package.

**It is not a second codebase.** `webDir: "out"` in `capacitor.config.ts` points at the same folder
the static host serves, so `next build` feeds both. The only native code is an empty
`MainActivity extends BridgeActivity`.

```
next build  ->  out/  ->  cap sync android  ->  android/app/src/main/assets/public/
                                                   ->  gradle assembleDebug  ->  APK
```

`scripts/build-apk.mjs` drives that and, because the Android toolchain is version-fussy, it locates a
JDK 21+ and the SDK itself (a bare `java` on `PATH` is usually Java 8 and Gradle will not say so
clearly) and writes `android/local.properties`. It runs Gradle through `gradle-wrapper.jar` rather
than `gradlew`, which Node cannot spawn on Windows without a shell.

Deliberate differences from the browser build:

| | Browser | APK | Why |
|---|---|---|---|
| Service worker | registered | skipped when `Capacitor.isNativePlatform()` | every file is already local; a cache here can only serve stale content after an app update |
| Header pill | `online` / `offline` | `on device` | Android WebView reports `navigator.onLine` unreliably — it said `online` in airplane mode, which is worse than saying nothing |
| `INTERNET` permission | n/a | removed from `AndroidManifest.xml` | turns "works offline" from an observation into something the OS enforces; the app requests no permissions at all |
| WebView debugging | n/a | off in release builds | no `webview_devtools_remote` socket on a release build |

Detection is a property probe — `window.Capacitor?.isNativePlatform?.()` — rather than an import of
`@capacitor/core`, so the browser bundle does not carry the native bridge to answer one question. It
feeds `useSyncExternalStore` with a `false` server snapshot, which is the same hydration trick §8.3
uses: the prerendered markup is identical to the browser build and React re-reads it on hydration.

Verified on an API 36.1 emulator, debug and release builds both:

- cold start in airplane mode renders the calculator (147 text nodes via `uiautomator dump` on the
  release build, where DevTools is unavailable);
- a range change written to `localStorage` survives a force-stop and relaunch while still offline;
- tab navigation is client-side, not a document reload;
- `dumpsys package` reports no requested permissions.

**Edge-to-edge and the status bar.** `targetSdk` 36 means Android draws the app behind the status bar
and the gesture bar whether the app wants it or not; `viewport-fit=cover` in the viewport meta then
tells Capacitor's `SystemBars` plugin to hand those insets to CSS instead of padding the WebView, so
the WebView really is fullscreen. The page has to reserve the bar itself, and it does: `.safe-top`,
`.safe-bottom` and `.safe-px` in `app/globals.css` pad the sticky header, the tab bar and the content
by the inset, so the header's blurred background keeps painting *under* the clock and battery icons
while its text sits *below* them. The padding reads `var(--safe-area-inset-top, env(safe-area-inset-top,
0px))` in that order on purpose: Capacitor injects `0px` when it has already padded the WebView
natively (Chromium WebView below 140, where `env()` is still broken), and `env()` would reserve the
strip a second time there. `initialViewportFitValueHint: "cover"` in `capacitor.config.ts` tells
Capacitor the meta value up front, which removes the launch flash where the WebView is padded for a
bar it then removes. Status bar icon colours follow the system night mode, which is the same signal
the CSS tokens use, so no `SystemBars.style` is set.

**Signing.** `assembleRelease` signs with `android/release.keystore` when `android/keystore.properties`
exists; otherwise it falls back to the debug key so the build is still installable. Both are
gitignored. A debug-signed install cannot be upgraded to a release-signed one — Android rejects the
signature change, and uninstalling it wipes `localStorage`. Export before switching.

---

## 11. Testing strategy

`npm test` → Vitest 4, **9 files / 146 tests**, plain Node environment (no jsdom needed for the
physics), ~2 s.

### 11.1 What each file protects

| File | Protects |
|---|---|
| `lib/physics/atmosphere.test.ts` | ISA density reproduced from first principles; ρ rises when colder; ρ rises with pressure; **moist air is lighter than dry air**; vapour pressure from RH; absurd humidity clamped; speed of sound at 15 °C; the "kPa typed as hPa" typo is flagged |
| `lib/physics/trajectory.test.ts` | `k = ρ/(2·BC)`; non-positive BC rejected; **vacuum analytic invariant**; **exponential drag decay analytic invariant**; step-size convergence < 0.1 mrad at 200 m; zero crossing exact to 1e-5 m; both crossings reported; `ZeroReachableError`; sign convention (positive before the zero); monotonic drop/velocity/TOF; `null` for unreachable distances; energy = ½mv²; apex and bore-height crossing |
| `lib/physics/fit.test.ts` | recovers a synthetic BC; recovers BC **and** velocity when both free; tolerates noise; residuals for every point; clean failure with no data; bad rows ignored instead of poisoning the fit; parameters stay inside bounds; recovers from a completely wrong starting BC; **speed budget**; helpful message when distances are unreachable; **single-range recalibration** works and predicts 200 m to < 0.1 mrad; chronograph-pair BC; impossible velocity readings refused; **regression against your real range test**,
built from the seed itself (BC 352.8, calipered 70 mm sight height) so the suite can never drift away
from the rig the app ships with |
| `lib/physics/units.test.ts` | mrad↔MOA, pressure unit round-trips (hPa/kPa/mmHg/inHg/psi), °C↔°F, metric/imperial length-velocity-energy-mass-caliber conversions, click arithmetic, formatting of non-finite values as `—` |
| `lib/data/shot.test.ts` | UI units → SI config; **sight height comes from Settings (the rig), not from the bullet**, and changing it really does change the trajectory; `Cd = m/(A·BC)`; implied Cd inside a sensible band for the fitted slug; seeded bullet at 100 m; zero is zero; unreached distance reported, not invented; drop table built; impossible zero propagates as a typed error; seed state is self-consistent and carries your test conditions |
| `lib/data/storage.test.ts` | `MemoryStore`; full state round-trip; `null` on empty and on corrupt JSON (never throws); fallback to seed; distinct storage key; sanitisation (clamping, dropping bad bullets, defaults, de-duplicated ids, repaired active id, filtered measurement rows); **v1→v2 card migration and v2→v3 sight-height migration**; import/export losslessness and readable errors; unique ids |
| `lib/data/dope.test.ts` | **the card reproduces your table exactly** at every measured range; the model alone does not; **no physical trajectory reproduces your table** (convexity of angular drop violated by the data, and verified across 150+ physical configurations); the best 3-parameter fit still cannot reach −2.90 at 100 m; interpolation between ranges; constant offsets outside the span; a colder day shifts the corrected hold-over by exactly the model's shift; card ownership rules |
| `lib/state/app-store.test.ts` | every reducer action; identity preserved on patch; library never emptied; no-op actions return the same object; card restamping, card clearing with its bullet, empty card removal; store hydrate/persist behaviour |
| `tests/render.test.tsx` | all four screens server-render without throwing; the prerendered headline is the **measured** number (100 m = `−2.90`) while the line beside it reads `model −3.02` with `correction +0.12`; the seeded BC renders as `353 kg/m²`; measured points render as chart dots; every configured table row appears |

### 11.2 The philosophy

Tests are written against **invariants and analytic solutions**, not against golden numbers produced
by the code itself. A test that only asserts "the code still outputs what it output yesterday"
locks in a bug. Here, the drag integrator is checked against `v = v0·e^(−kx)`, the vacuum case
against `v² − (gt)² = v0²`, and air density against the ISA definition — so a wrong implementation
fails even on its first run.

### 11.3 The regression tests that tie the app to your rifle

`fit.test.ts` re-runs your exact range test: the seeded bullet and the seeded rig (70 mm) must
reproduce your measured table (RMS < 0.35 mrad, max < 0.5 mrad), and fitting that table from a
deliberately wrong starting BC of 150 must land back on 352.8 kg/m² (±15) with RMS < 0.3 mrad. If a
future change makes the model disagree with your rifle, the suite says so.

`dope.test.ts` is the counterpart: it asserts the model alone does **not** match your table, that no
physical trajectory can, and that the card therefore takes over the absolute level. A change that
quietly makes the calculator show the model instead of your measurements fails that suite.

### 11.4 Current coverage gaps (tracked in TASKS.md)

- Component *interaction* tests: `tests/render.test.tsx` proves the HTML is right, but no test drives
  a click, a slider drag, or the fit→apply flow. That needs a DOM environment (jsdom) which is not
  configured.
- No browser E2E (Playwright) and no CI workflow.
- Service worker caching logic is untested.

---

## 12. Known limits, honestly

1. **Constant Cd.** Valid while subsonic. If you load a slug supersonically, or a pellet that
   transits Mach 1 downrange, the single-BC model degrades and the fit residuals will show it as a
   systematic curve rather than alternating noise.
2. **No wind.** Wind drift for a 1 g slug at Mach 0.65 is *large* (roughly 1.5–3 cm per m/s of crosswind
   at 100 m). The app gives no windage. This is a deliberate omission, not an oversight.
3. **No rifle angle.** Uphill/downhill shooting makes the effective zero longer than the horizontal
   distance. At 200 m on a 30° slope this is a significant error. Highest-value missing feature.
4. **Sight height is an input you must supply.** On this rifle it is no longer a guess: **70 mm,
   calipered, stored in Settings → Rifle and scope** — and it is the largest single lever in the fit
   (40 mm → 70 mm moved the fitted BC from 422 to 353 kg/m², the 100 m prediction from −3.21 to −3.02,
   and the first zero from 12 m to 20.6 m). If you change rings, mounts or the scope, re-measure it and
   re-fit. If you have never measured it, either measure it or let the fit solve it — but never both
   velocity *and* sight height free at the same time.
5. **BC is only as good as your drop measurements.** Group size, rest technique and range
   determination all enter the fit. 8 points at known ranges beat 3 points.
6. **`maximumScale=1` in the viewport** prevents pinch zoom. Deliberate for layout stability, but it
   is an accessibility trade-off worth revisiting.
7. **localStorage is per-origin.** Switching from `http://192.168.1.20:3000` to
   `https://pcp.tailnet.ts.net` starts a fresh, empty app. Use Bullets → Backup when changing hosting.
8. **Your measured table is internally inconsistent** at the ±0.3 mrad level (§7.1). The card hides
   that at the measured ranges, which is what you want at the range and what you should *not* want if
   you are trying to improve the model. Re-measuring 125–200 m with more shots is the only way to
   find out which number is wrong.

---

## 13. Performance

- A full trajectory to 250 m is ~5 000 RK4 steps: **single-digit milliseconds** on a phone.
- The calculator recomputes the trajectory on every change of bullet/weather/max-range via `useMemo`,
  and re-reads the existing `points[]` when only the distance changes — moving the slider does **not**
  re-integrate.
- A fit is the expensive path: ~100–300 ms. It runs only on button press, never on keystroke.
- The chart samples 120 points from the existing trajectory rather than re-simulating.
- Bundle: Next + React + this app, no chart library, no numeric library, no HTTP client. Everything
  the app needs is in the initial payload, which is what makes it usable with no signal.

---

## 14. Formula cheat sheet

```
ρ  = (P − RH·Psat)/(Rd·T) + RH·Psat/(Rv·T)          air density, kg/m³
Psat = 610.78·exp(17.27·Tc/(Tc+237.3))              Pa, Tc in °C
k  = ρ / (2·BC)                                      drag factor, 1/m
BC = m / (Cd·A)                                      kg/m²
A  = π/4 · d²                                        m²
a  = −k·|v|·v⃗ + (0, −g)                             acceleration
v(x) ≈ v0·e^(−k·x)                                   closed form, horizontal-only drag
drop(x) = y(x)/x · 1000                              mrad, + = above aim
corrected(d) = model_today(d) + [measured(d) − model_cardWeather(d)]   the card rule
residual(d)  interpolated linearly between measured ranges, constant outside
clicks  = −drop / clickValue                         dial up when drop is negative
E(x)    = ½·m·v(x)²                                  J
Mach(x) = v(x) / (331.3·√(1 + Tc/273.15))
```

---

## 15. Reading order for the code

1. `lib/physics/atmosphere.ts` — 90 lines, self-contained, sets the stage.
2. `lib/physics/trajectory.ts` — the core model; read the header comment for the frame and sign convention.
3. `lib/data/shot.ts` — the bridge from "what a shooter stores" to "what the integrator wants".
4. `lib/physics/fit.ts` — the calibration inversion; the header comment explains the optimiser.
5. `lib/data/dope.ts` — why the card, not the model, sets the hold-over you dial.
6. `lib/state/app-store.tsx` — the hydration-safe store.
7. `components/calculator.tsx` — how it all appears on screen.

Each of those files has a companion `*.test.ts` that documents the intended behaviour more precisely
than prose does.
