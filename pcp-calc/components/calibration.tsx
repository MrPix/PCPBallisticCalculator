"use client";

import { useState } from "react";
import { airDensity } from "@/lib/physics/atmosphere";
import { type DropMeasurement, type FitResult, ballisticCoefficientFromVelocity, fitFromDrops } from "@/lib/physics/fit";
import { ZeroReachableError } from "@/lib/physics/trajectory";
import { angularToDisplay, formatFixed, formatSigned } from "@/lib/physics/units";
import { prepareShot, summarizeShot, toShotConfig } from "@/lib/data/shot";
import { describeWeather, sortedMeasurements } from "@/lib/data/dope";
import { useAppStore } from "@/lib/state/app-store";
import { WeatherEditor } from "./weather-editor";
import { Button, Card, Checkbox, Notice, NumberField, Stat } from "./ui";

export function Calibration() {
  const { state, dispatch, activeBullet } = useAppStore();
  const [result, setResult] = useState<FitResult | null>(null);
  const [freeVelocity, setFreeVelocity] = useState(false);
  const [freeSightHeight, setFreeSightHeight] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const [chrono, setChrono] = useState({
    muzzleVelocityMs: activeBullet.muzzleVelocityMs,
    measuredVelocityMps: Math.round(activeBullet.muzzleVelocityMs * 0.85),
    distanceM: 100,
  });
  const [chronoResult, setChronoResult] = useState<{ bc: number; message: string | null } | null>(null);

  const measurements = state.dope?.measurements ?? [];

  const setMeasurements = (next: DropMeasurement[]) =>
    dispatch({ type: "setMeasurements", measurements: next });

  const updateRow = (index: number, patch: Partial<DropMeasurement>) =>
    setMeasurements(measurements.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  const removeRow = (index: number) => setMeasurements(measurements.filter((_, i) => i !== index));

  const addRow = () => {
    const lastDistance = measurements.length > 0 ? measurements[measurements.length - 1].distanceM : 50;
    setMeasurements([...measurements, { distanceM: lastDistance + 25, dropMrad: 0 }]);
  };

  const saveCard = () => {
    dispatch({ type: "saveDope" });
    setApplied(
      `Measured card saved for “${activeBullet.name}” at ${describeWeather(state.weather)}. The calculator now uses these drops as the hold-over level and corrects them to whatever air you shoot in.`,
    );
  };

  const card = state.dope;
  const cardRows = card ? sortedMeasurements(card.measurements) : [];

  const env = { weather: state.weather, sightHeightMm: state.settings.sightHeightMm };

  const fillFromModel = () => {
    try {
      const shot = prepareShot(
        activeBullet,
        env,
        Math.max(...state.settings.tableDistancesM) * 1.1,
      );
      setMeasurements(
        state.settings.tableDistancesM.map((distanceM) => {
          const s = summarizeShot(shot, distanceM);
          return { distanceM, dropMrad: Number(s.dropMrad.toFixed(2)) };
        }),
      );
      setResult(null);
    } catch (error) {
      setApplied(
        error instanceof ZeroReachableError
          ? error.message
          : "Could not predict drops for this bullet.",
      );
    }
  };

  const freeParams = ["ballisticCoefficientKgM2" as const, ...(freeVelocity ? ["muzzleVelocityMs" as const] : []), ...(freeSightHeight ? ["sightHeightM" as const] : [])];

  const runFit = () => {
    const base = toShotConfig(activeBullet, env);
    setResult(fitFromDrops(base, measurements, freeParams));
    setApplied(null);
  };

  const applyFit = () => {
    if (!result?.success) return;
    const patch: Record<string, number> = {
      ballisticCoefficientKgM2: Number(result.config.ballisticCoefficientKgM2.toFixed(1)),
    };
    if (freeVelocity) patch.muzzleVelocityMs = Number(result.config.muzzleVelocityMs.toFixed(1));
    dispatch({ type: "updateBullet", id: activeBullet.id, patch });
    // Sight height belongs to the rig, so a fit that solved it writes Settings,
    // not the bullet.
    if (freeSightHeight) {
      dispatch({
        type: "setSettings",
        patch: { sightHeightMm: Number((result.config.sightHeightM * 1000).toFixed(1)) },
      });
    }
    // The measurements themselves are kept as a dope card for the calculator,
    // stamped with the bullet and the air they were shot in.
    dispatch({ type: "saveDope" });
    setApplied(
      `Saved: BC ${patch.ballisticCoefficientKgM2}${patch.muzzleVelocityMs !== undefined ? `, velocity ${patch.muzzleVelocityMs} m/s` : ""}${freeSightHeight ? `, sight height ${(result.config.sightHeightM * 1000).toFixed(1)} mm` : ""}. These measurements are now the measured card for “${activeBullet.name}”.`,
    );
    setResult(null);
  };

  const runChrono = () => {
    const out = ballisticCoefficientFromVelocity({
      muzzleVelocityMps: chrono.muzzleVelocityMs,
      measuredVelocityMps: chrono.measuredVelocityMps,
      distanceM: chrono.distanceM,
      airDensityKgM3: airDensity(state.weather),
    });
    setChronoResult({ bc: out.ballisticCoefficientKgM2, message: out.message });
  };

  const applyChrono = () => {
    if (!chronoResult || chronoResult.message) return;
    dispatch({
      type: "updateBullet",
      id: activeBullet.id,
      patch: {
        ballisticCoefficientKgM2: Number(chronoResult.bc.toFixed(1)),
        muzzleVelocityMs: chrono.muzzleVelocityMs,
      },
    });
    setApplied(`Saved BC ${chronoResult.bc.toFixed(0)} kg/m² and muzzle velocity ${chrono.muzzleVelocityMs} m/s.`);
    setChronoResult(null);
  };

  const beforeAfter = (() => {
    if (!result?.success) return null;
    try {
      const before = prepareShot(activeBullet, env, 300);
      const after = prepareShot(
        {
          ...activeBullet,
          muzzleVelocityMs: result.config.muzzleVelocityMs,
          ballisticCoefficientKgM2: result.config.ballisticCoefficientKgM2,
        },
        { weather: state.weather, sightHeightMm: result.config.sightHeightM * 1000 },
        300,
      );
      return state.settings.tableDistancesM.map((distanceM) => ({
        distanceM,
        before: summarizeShot(before, distanceM),
        after: summarizeShot(after, distanceM),
      }));
    } catch {
      return null;
    }
  })();

  return (
    <div className="space-y-4">
      <Card
        title="Calibrate the active bullet"
        subtitle={`${activeBullet.name} · BC ${formatFixed(activeBullet.ballisticCoefficientKgM2, 0)} kg/m² · ${formatFixed(
          activeBullet.muzzleVelocityMs,
          0,
        )} m/s · zero ${activeBullet.zeroDistanceM} m`}
      >
        <p className="text-sm text-muted">
          You do not need a catalogue ballistic coefficient. Shoot a group at a few known ranges,
          write down how far the pellet missed the point of aim, and the calculator will solve for
          the drag that makes those numbers come true.
        </p>
      </Card>

      <Card
        title="Measured drops"
        subtitle="Positive = impact above the point of aim, negative = below. Sign convention as on your target card."
        actions={
          <>
            <Button variant="ghost" onClick={fillFromModel}>
              Copy predicted
            </Button>
            <Button variant="ghost" onClick={addRow}>
              Add row
            </Button>
            <Button variant="primary" onClick={saveCard} disabled={measurements.length === 0}>
              Save card
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {measurements.length === 0 && <Notice tone="warn">No measurements yet. Add a row.</Notice>}
          {measurements.map((m, index) => (
            <div key={`${m.distanceM}-${index}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <NumberField
                label="Distance"
                value={m.distanceM}
                onChange={(v) => updateRow(index, { distanceM: v })}
                unit="m"
                min={1}
                max={1000}
                step={1}
              />
              <NumberField
                label="Drop"
                value={m.dropMrad}
                onChange={(v) => updateRow(index, { dropMrad: v })}
                unit="mrad"
                min={-200}
                max={200}
                step={0.1}
              />
              <button
                type="button"
                onClick={() => removeRow(index)}
                aria-label={`Remove measurement at ${m.distanceM} m`}
                className="mb-1 h-11 w-11 rounded-xl border border-line text-muted hover:border-bad hover:text-bad"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </Card>

      <WeatherEditor compact />

      <Card title="Fit" subtitle="Hold what you measured with instruments fixed; fit what you did not.">
        <div className="grid gap-1 sm:grid-cols-3">
          <Checkbox label="Ballistic coefficient" checked locked hint="Always fit — this is the unknown." />
          <Checkbox
            label="Muzzle velocity"
            checked={freeVelocity}
            onChange={setFreeVelocity}
            hint="Only if you have no chronograph"
          />
          <Checkbox
            label="Sight height"
            checked={freeSightHeight}
            onChange={setFreeSightHeight}
            hint={`Only if you have not measured it (currently ${state.settings.sightHeightMm} mm in Settings)`}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={runFit} disabled={measurements.length === 0}>
            Fit parameters
          </Button>
          {result?.success && (
            <Button variant="primary" onClick={applyFit}>
              Apply to bullet
            </Button>
          )}
        </div>

        {result && !result.success && (
          <div className="mt-3">
            <Notice tone="error">{result.message}</Notice>
          </div>
        )}

        {result?.success && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="BC" value={formatFixed(result.config.ballisticCoefficientKgM2, 0)} unit="kg/m²" />
              <Stat label="Fit error (RMS)" value={formatFixed(result.rmsMrad, 2)} unit="mrad" />
              <Stat label="Worst point" value={formatFixed(result.maxAbsErrorMrad, 2)} unit="mrad" />
              {freeVelocity && (
                <Stat label="Muzzle velocity" value={formatFixed(result.config.muzzleVelocityMs, 0)} unit="m/s" />
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                    <th className="py-2 pr-3 font-medium">Range</th>
                    <th className="py-2 pr-3 font-medium">Measured</th>
                    <th className="py-2 pr-3 font-medium">Model</th>
                    <th className="py-2 pr-3 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody className="nums">
                  {result.residuals.map((r) => (
                    <tr key={r.distanceM} className="border-b border-line/60">
                      <td className="py-2 pr-3">{r.distanceM} m</td>
                      <td className="py-2 pr-3">{formatFixed(r.observedMrad, 2)}</td>
                      <td className="py-2 pr-3">{formatFixed(r.predictedMrad, 2)}</td>
                      <td className={`py-2 pr-3 ${Math.abs(r.errorMrad) > 0.5 ? "text-warn" : "text-good"}`}>
                        {formatSigned(r.errorMrad, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted">
              A fit error below about 0.5 mrad means the model matches your shooting. Anything above
              1 mrad usually means the sight height or the muzzle velocity is wrong rather than the
              drag model.
            </p>
          </div>
        )}

        {applied && (
          <div className="mt-3">
            <Notice tone="info">{applied}</Notice>
          </div>
        )}
      </Card>

      {beforeAfter && (
        <Card title="Before / after" subtitle="What the recalibration changes across your usual ranges.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-3 font-medium">Range</th>
                  <th className="py-2 pr-3 font-medium">Before</th>
                  <th className="py-2 pr-3 font-medium">After</th>
                  <th className="py-2 pr-3 font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="nums">
                {beforeAfter.map((row) => {
                  const unit = state.settings.angularUnit;
                  const before = angularToDisplay(row.before.dropMrad, unit).value;
                  const after = angularToDisplay(row.after.dropMrad, unit).value;
                  return (
                    <tr key={row.distanceM} className="border-b border-line/60">
                      <td className="py-2 pr-3">{row.distanceM} m</td>
                      <td className="py-2 pr-3">{formatSigned(before, 2)}</td>
                      <td className="py-2 pr-3">{formatSigned(after, 2)}</td>
                      <td className="py-2 pr-3 text-accent">{formatSigned(after - before, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="Measured card"
        subtitle={
          card
            ? `${cardRows.length} point(s) for “${state.bullets.find((b) => b.id === card.bulletId)?.name ?? "deleted bullet"}”, shot in ${describeWeather(card.weather)}`
            : undefined
        }
        actions={
          card ? (
            <Button variant="ghost" onClick={() => dispatch({ type: "clearDope" })}>
              Clear card
            </Button>
          ) : undefined
        }
      >
        {card ? (
          <p className="text-sm text-muted">
            These measurements are what the calculator shows as hold-over. It keeps your measured
            level and uses the model only to move it between the air you measured in (
            {describeWeather(card.weather)}) and the air you are shooting in today
            ({describeWeather(state.weather)}). At the card&apos;s own conditions the agreement is
            exact.
          </p>
        ) : (
          <Notice tone="warn">
            No measured card saved. Enter your drops above and press Save card — the calculator will
            then show your own numbers instead of the model&apos;s.
          </Notice>
        )}
      </Card>

      <Card title="Or calibrate with a chronograph" subtitle="Two readings give the ballistic coefficient directly.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField
            label="Muzzle velocity"
            value={chrono.muzzleVelocityMs}
            onChange={(v) => setChrono((c) => ({ ...c, muzzleVelocityMs: v }))}
            unit="m/s"
            min={30}
            max={1200}
            step={1}
          />
          <NumberField
            label="Velocity at range"
            value={chrono.measuredVelocityMps}
            onChange={(v) => setChrono((c) => ({ ...c, measuredVelocityMps: v }))}
            unit="m/s"
            min={10}
            max={1200}
            step={1}
          />
          <NumberField
            label="Distance of that reading"
            value={chrono.distanceM}
            onChange={(v) => setChrono((c) => ({ ...c, distanceM: v }))}
            unit="m"
            min={1}
            max={500}
            step={1}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={runChrono}>Compute BC</Button>
          {chronoResult && !chronoResult.message && (
            <Button variant="primary" onClick={applyChrono}>
              Apply BC {formatFixed(chronoResult.bc, 0)} kg/m²
            </Button>
          )}
        </div>
        {chronoResult && (
          <div className="mt-3">
            {chronoResult.message ? (
              <Notice tone="warn">{chronoResult.message}</Notice>
            ) : (
              <Notice tone="info">
                BC = {formatFixed(chronoResult.bc, 0)} kg/m² from {chrono.muzzleVelocityMs} →{" "}
                {chrono.measuredVelocityMps} m/s over {chrono.distanceM} m.
              </Notice>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
