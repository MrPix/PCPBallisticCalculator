"use client";

import { useCallback, useMemo, useState } from "react";
import { type DropRow } from "@/lib/physics/trajectory";
import {
  angularToDisplay,
  caliberToDisplay,
  clicksToDial,
  energyToDisplay,
  formatFixed,
  formatSigned,
  massToDisplay,
  metersToDisplayLength,
  velocityToDisplay,
} from "@/lib/physics/units";
import { buildRows, impliedDragCoefficient, prepareShot, summarizeShot } from "@/lib/data/shot";
import {
  buildDopeModel,
  cardForBullet,
  correctedDrop,
  describeWeather,
  KIND_LABEL,
  sortedMeasurements,
} from "@/lib/data/dope";
import { useAppStore } from "@/lib/state/app-store";
import { TrajectoryChart } from "./trajectory-chart";
import { WeatherEditor } from "./weather-editor";
import { Card, Notice, NumberField, SegmentedControl, Stat } from "./ui";

type ChartMode = "angular" | "linear";

function holdAdvice(
  dropMrad: number,
  dropM: number,
  unitSystem: "metric" | "imperial",
): string {
  if (!Number.isFinite(dropMrad)) return "No solution for this distance.";
  if (Math.abs(dropMrad) < 0.05) return "Point of aim is point of impact — this is the zero.";
  const length = metersToDisplayLength(Math.abs(dropM), unitSystem);
  const text = `${formatFixed(length.value, length.unit === "cm" ? 1 : 2)} ${length.unit}`;
  return dropMrad < 0 ? `Aim ${text} high (hold over)` : `Aim ${text} low (hold under)`;
}

export function Calculator() {
  const { state, dispatch, activeBullet } = useAppStore();
  const { settings, weather, distanceM } = state;
  const [chartMode, setChartMode] = useState<ChartMode>("angular");

  const env = useMemo(
    () => ({ weather, sightHeightMm: settings.sightHeightMm }),
    [weather, settings.sightHeightMm],
  );

  const shot = useMemo(() => {
    try {
      return { shot: prepareShot(activeBullet, env, settings.maxRangeM), error: null };
    } catch (error) {
      return { shot: null, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }, [activeBullet, env, settings.maxRangeM]);

  // The measured card belongs to one bullet and one set of conditions.
  const card = cardForBullet(state.dope, activeBullet.id);
  const dopeModel = useMemo(
    () => (card && shot.shot ? buildDopeModel(card, activeBullet, settings.sightHeightMm) : null),
    [card, activeBullet, shot.shot, settings.sightHeightMm],
  );

  const wantsMeasured = settings.dropSource === "measured";
  const measuredActive = wantsMeasured && dopeModel !== null && shot.shot !== null;

  const summary = useMemo(
    () => (shot.shot ? summarizeShot(shot.shot, distanceM) : null),
    [shot.shot, distanceM],
  );

  const correction = useMemo(
    () => (dopeModel && shot.shot ? correctedDrop(dopeModel, shot.shot, distanceM) : null),
    [dopeModel, shot.shot, distanceM],
  );

  /** The number the shooter acts on. */
  const headlineMrad =
    measuredActive && correction
      ? correction.correctedMrad
      : summary?.dropMrad ?? Number.NaN;
  const headlineLinearM = Number.isFinite(headlineMrad) ? (headlineMrad * distanceM) / 1000 : Number.NaN;

  const rows = useMemo(() => {
    const modelRows: DropRow[] = shot.shot ? buildRows(shot.shot, settings.tableDistancesM) : [];
    return modelRows.map((row) => {
      const c = measuredActive && dopeModel && shot.shot
        ? correctedDrop(dopeModel, shot.shot, row.distanceM)
        : null;
      if (!c) return { ...row, modelMrad: row.dropMrad, kind: null as null | string };
      return {
        ...row,
        dropMrad: c.correctedMrad,
        dropLinearM: (c.correctedMrad * row.distanceM) / 1000,
        modelMrad: c.modelMrad,
        kind: c.kind as string | null,
      };
    });
  }, [shot.shot, settings.tableDistancesM, dopeModel, measuredActive]);

  const chartPoints = useMemo(() => {
    if (!shot.shot) return [];
    const samples = 120;
    const step = settings.maxRangeM / samples;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      const distance = i * step;
      const point = shot.shot.trajectory.points.find((p) => p.x >= distance);
      if (!point) break;
      const modelAngular = (point.y / Math.max(distance, 1)) * 1000;
      const angular =
        measuredActive && dopeModel
          ? correctedDrop(dopeModel, shot.shot, distance)?.correctedMrad ?? modelAngular
          : modelAngular;
      const linearCm = (angular * Math.max(distance, 1)) / 10;
      points.push({
        x: distance,
        y: chartMode === "angular" ? angular : linearCm,
      });
    }
    return points;
  }, [shot.shot, settings.maxRangeM, chartMode, dopeModel, measuredActive]);

  const chartMarkers = useMemo(() => {
    if (!card || !measuredActive || chartMode !== "angular") return [];
    return sortedMeasurements(card.measurements).map((m) => ({ x: m.distanceM, y: m.dropMrad }));
  }, [card, measuredActive, chartMode]);

  const setDistance = useCallback(
    (value: number) => dispatch({ type: "setDistance", distanceM: Math.round(value * 10) / 10 }),
    [dispatch],
  );

  const angular = angularToDisplay(headlineMrad, settings.angularUnit);
  const dial = clicksToDial(-headlineMrad, settings.clickValue, settings.clickUnit);
  const linear = metersToDisplayLength(headlineLinearM, settings.unitSystem);
  const velocity = summary ? velocityToDisplay(summary.velocityMps, settings.unitSystem) : null;
  const energy = summary ? energyToDisplay(summary.energyJ, settings.unitSystem) : null;

  const mass = massToDisplay(activeBullet.massG, settings.unitSystem);
  const caliber = caliberToDisplay(activeBullet.caliberMm, settings.unitSystem);

  const reached = summary?.reached ?? false;

  return (
    <div className="space-y-4">
      <Card
        title={activeBullet.name}
        subtitle={`${formatFixed(caliber.value, caliber.unit === "mm" ? 2 : 3)} ${caliber.unit} · ${formatFixed(
          mass.value,
          mass.unit === "g" ? 2 : 0,
        )} ${mass.unit} · ${formatFixed(activeBullet.muzzleVelocityMs, 0)} m/s · BC ${formatFixed(
          activeBullet.ballisticCoefficientKgM2,
          0,
        )} kg/m² · zero ${activeBullet.zeroDistanceM} m · sight height ${formatFixed(
          settings.sightHeightMm,
          0,
        )} mm`}
      >
        <BulletPicker />
      </Card>

      {shot.error && <Notice tone="error">{shot.error}</Notice>}

      <Card title="Distance" subtitle="Type it, slide it, or tap a range.">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-start">
          <NumberField
            label="Range"
            value={distanceM}
            onChange={setDistance}
            unit="m"
            min={1}
            max={1000}
            step={1}
            big
          />
          <div className="pt-5">
            <input
              type="range"
              min={1}
              max={settings.maxRangeM}
              step={1}
              value={Math.min(distanceM, settings.maxRangeM)}
              onChange={(e) => setDistance(Number(e.target.value))}
              className="w-full"
              aria-label="Range slider"
            />
            <div className="mt-2 flex gap-2">
              {[-25, -5, -1, 1, 5, 25].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  onClick={() => setDistance(Math.max(1, distanceM + delta))}
                  className="nums min-h-10 flex-1 rounded-lg border border-line bg-bg-elevated text-sm text-muted hover:text-fg"
                >
                  {delta > 0 ? `+${delta}` : delta}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {settings.tableDistancesM.map((distance) => (
            <button
              key={distance}
              type="button"
              onClick={() => setDistance(distance)}
              aria-pressed={distance === distanceM}
              className={`nums min-h-10 rounded-full border px-4 text-sm font-medium ${
                distance === distanceM
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-line bg-bg-elevated text-muted hover:text-fg"
              }`}
            >
              {distance} m
            </button>
          ))}
        </div>
      </Card>

      {reached && (
        <Card
          title="Hold-over"
          actions={
            <SegmentedControl
              options={[
                { value: "measured", label: "Measured" },
                { value: "model", label: "Model" },
              ]}
              value={settings.dropSource}
              onChange={(dropSource) => dispatch({ type: "setSettings", patch: { dropSource } })}
            />
          }
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="nums text-5xl font-bold tracking-tight sm:text-6xl">
                {formatSigned(angular.value, angular.unit === "mrad" ? 2 : 1)}
                <span className="ml-2 text-lg font-medium text-muted">{angular.unit}</span>
              </div>
              <p className="mt-2 text-sm text-muted">
                {holdAdvice(headlineMrad, headlineLinearM, settings.unitSystem)}
              </p>
            </div>
            <div className="text-right">
              <div className="nums text-2xl font-semibold text-accent">
                {dial ? `${formatSigned(dial.clicks, 0)} clicks` : "—"}
              </div>
              <p className="text-xs text-muted">
                {dial
                  ? `${dial.clicks > 0 ? "dial up" : "dial down"} · ${dial.clickValue} ${dial.unit}`
                  : "set a click value in Settings"}
              </p>
            </div>
          </div>

          {measuredActive && correction ? (
            <div className="mt-3 rounded-xl border border-line bg-bg-elevated px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold text-good">measured</span>
                <span className="nums">{formatSigned(correction.correctedMrad, 2)} mrad</span>
                <span className="text-muted">·</span>
                <span className="text-muted">model {formatSigned(correction.modelMrad, 2)} mrad</span>
                <span className="text-muted">·</span>
                <span className="nums">
                  correction {formatSigned(correction.correctionMrad, 2)} mrad
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {KIND_LABEL[correction.kind]} · card shot in {describeWeather(dopeModel!.referenceWeather)} ·
                today {describeWeather(weather)}. The card sets the level, the model moves it to today&apos;s air.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">
              Pure physics model — no measured card for this bullet yet. Shoot a group at a known
              range and enter it on Calibrate and the calculator will use your own numbers.
            </p>
          )}

          {wantsMeasured && card && !dopeModel && (
            <div className="mt-3">
              <Notice tone="warn">
                The measured card could not be applied: the model cannot reach the ranges on the
                card with this bullet&apos;s parameters.
              </Notice>
            </div>
          )}

          {wantsMeasured && !card && state.dope && (
            <div className="mt-3">
              <Notice tone="warn">
                The measured card belongs to a different bullet, so it is not used. Switch bullets or
                re-measure for this one.
              </Notice>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Velocity" value={formatFixed(velocity!.value, 0)} unit={velocity!.unit} />
            <Stat label="Energy" value={formatFixed(energy!.value, 1)} unit={energy!.unit} />
            <Stat label="Time of flight" value={formatFixed(summary!.timeOfFlightS, 3)} unit="s" />
            <Stat label="Mach" value={formatFixed(summary!.mach, 2)} unit="" />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Drop" value={formatSigned(linear.value, linear.unit === "cm" ? 1 : 2)} unit={linear.unit} />
            <Stat label="Flight angle" value={formatSigned(summary!.flightAngleMrad, 2)} unit="mrad" />
            <Stat label="Implied Cd" value={formatFixed(impliedDragCoefficient(activeBullet), 2)} unit="" />
            <Stat label="Air density" value={formatFixed(shot.shot!.airDensityKgM3, 4)} unit="kg/m³" />
          </div>
          <p className="mt-2 text-xs text-muted">
            Velocity, energy, time of flight and flight angle are model values; only the hold-over is
            corrected to your measurements.
          </p>
        </Card>
      )}

      {summary && !reached && (
        <Notice tone="warn">
          The pellet cannot reach {distanceM} m with these parameters. The trajectory dies out around{" "}
          {formatFixed(shot.shot?.trajectory.maxDistanceM ?? 0, 0)} m.
        </Notice>
      )}

      <Card
        title="Trajectory"
        actions={
          <SegmentedControl
            options={[
              { value: "angular", label: "mrad" },
              { value: "linear", label: "cm" },
            ]}
            value={chartMode}
            onChange={setChartMode}
          />
        }
      >
        <TrajectoryChart
          points={chartPoints}
          markers={chartMarkers}
          markerX={distanceM}
          markerY={chartMode === "angular" ? headlineMrad : headlineLinearM * 100}
          maxDistanceM={settings.maxRangeM}
          yUnit={chartMode === "angular" ? "mrad" : "cm"}
        />
        {measuredActive && chartMode === "angular" && chartMarkers.length > 0 && (
          <p className="mt-1 text-xs text-muted">
            Dots are your measured points; the line is the corrected curve.
          </p>
        )}
      </Card>

      <Card title="Drop table" subtitle="Tap a row to jump to that range.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="py-2 pr-2 font-medium">Range</th>
                <th className="py-2 pr-2 font-medium">Hold</th>
                <th className="py-2 pr-2 font-medium">
                  {measuredActive ? "Model" : "Drop"}
                </th>
                <th className="hidden py-2 pr-2 font-medium sm:table-cell">Velocity</th>
                <th className="hidden py-2 pr-2 font-medium md:table-cell">Energy</th>
                <th className="hidden py-2 pr-2 font-medium md:table-cell">TOF</th>
              </tr>
            </thead>
            <tbody className="nums">
              {rows.map((row) => (
                <tr
                  key={row.distanceM}
                  onClick={() => setDistance(row.distanceM)}
                  className={`cursor-pointer border-b border-line/60 ${
                    row.distanceM === distanceM ? "bg-accent/10" : "hover:bg-bg-elevated"
                  }`}
                >
                  <td className="py-2 pr-2 font-medium">
                    {row.distanceM} m
                    {row.kind === "measured" && (
                      <span className="ml-1 text-good" title="measured point">●</span>
                    )}
                    {row.kind === "interpolated" && (
                      <span className="ml-1 text-muted" title="interpolated from measured points">
                        ◦
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    {row.reached
                      ? formatSigned(
                          angularToDisplay(row.dropMrad, settings.angularUnit).value,
                          settings.angularUnit === "mrad" ? 2 : 1,
                        )
                      : "—"}
                  </td>
                  <td className="py-2 pr-2">
                    {row.reached
                      ? measuredActive
                        ? formatSigned(
                            angularToDisplay(row.modelMrad ?? Number.NaN, settings.angularUnit).value,
                            settings.angularUnit === "mrad" ? 2 : 1,
                          )
                        : (() => {
                            const length = metersToDisplayLength(row.dropLinearM, settings.unitSystem);
                            return `${formatFixed(length.value, length.unit === "cm" ? 0 : 1)} ${length.unit}`;
                          })()
                      : "—"}
                  </td>
                  <td className="hidden py-2 pr-2 sm:table-cell">
                    {row.reached
                      ? `${formatFixed(velocityToDisplay(row.velocityMps, settings.unitSystem).value, 0)}`
                      : "—"}
                  </td>
                  <td className="hidden py-2 pr-2 md:table-cell">
                    {row.reached ? `${formatFixed(energyToDisplay(row.energyJ, settings.unitSystem).value, 1)}` : "—"}
                  </td>
                  <td className="hidden py-2 pr-2 md:table-cell">{row.reached ? `${formatFixed(row.timeOfFlightS, 2)} s` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {measuredActive && (
          <p className="mt-2 text-xs text-muted">
            ● measured · ◦ interpolated from measured ranges · last column is the uncorrected model.
          </p>
        )}
      </Card>

      <WeatherEditor />
    </div>
  );
}

function BulletPicker() {
  const { state, dispatch } = useAppStore();
  return (
    <div className="flex gap-2">
      <select
        value={state.activeBulletId}
        onChange={(e) => dispatch({ type: "selectBullet", id: e.target.value })}
        className="min-h-11 w-full rounded-xl border border-line bg-bg-elevated px-3 text-sm"
        aria-label="Active bullet"
      >
        {state.bullets.map((bullet) => (
          <option key={bullet.id} value={bullet.id}>
            {bullet.name} — {bullet.muzzleVelocityMs} m/s
          </option>
        ))}
      </select>
    </div>
  );
}
