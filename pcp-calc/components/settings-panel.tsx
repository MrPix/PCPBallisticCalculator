"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/state/app-store";
import { describeWeather, sortedMeasurements } from "@/lib/data/dope";
import { WeatherEditor } from "./weather-editor";
import { Card, NumberField, Notice, SegmentedControl } from "./ui";

function DistanceListEditor() {
  const { state, dispatch } = useAppStore();
  const [text, setText] = useState(() => state.settings.tableDistancesM.join(", "));
  const [error, setError] = useState<string | null>(null);

  // Keep the text in sync when the list changes elsewhere (import, reset).
  const canonical = state.settings.tableDistancesM.join(", ");
  const [lastCanonical, setLastCanonical] = useState(canonical);
  if (canonical !== lastCanonical) {
    setLastCanonical(canonical);
    setText(canonical);
  }

  const commit = (raw: string) => {
    setText(raw);
    const values = raw
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map((v) => Number(v));
    if (values.length === 0) {
      setError("At least one distance is required.");
      return;
    }
    if (values.some((v) => !Number.isFinite(v) || v <= 0 || v > 1000)) {
      setError("Distances must be numbers between 1 and 1000 m.");
      return;
    }
    setError(null);
    dispatch({
      type: "setSettings",
      patch: { tableDistancesM: Array.from(new Set(values.map((v) => Math.round(v)))).sort((a, b) => a - b) },
    });
  };

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium tracking-wide text-muted">
        Drop-table distances (comma separated, metres)
      </span>
      <input
        value={text}
        onChange={(e) => commit(e.target.value)}
        className={`nums min-h-11 w-full rounded-xl border bg-bg-elevated px-3 text-sm ${
          error ? "border-bad" : "border-line"
        }`}
        inputMode="text"
      />
      {error ? (
        <span className="mt-1 block text-xs text-bad">{error}</span>
      ) : (
        <span className="mt-1 block text-xs text-muted">
          These are the quick-pick buttons and the rows of the drop table.
        </span>
      )}
    </label>
  );
}

export function SettingsPanel() {
  const { state, dispatch } = useAppStore();
  const { settings } = state;
  const patch = (p: Partial<typeof settings>) => dispatch({ type: "setSettings", patch: p });

  return (
    <div className="space-y-4">
      <Card
        title="Rifle and scope"
        subtitle="Properties of the rig, shared by every bullet you shoot in it."
      >
        <NumberField
          label="Sight height"
          value={settings.sightHeightMm}
          onChange={(sightHeightMm) => patch({ sightHeightMm })}
          unit="mm"
          min={2}
          max={150}
          step={1}
          hint="bore centre → scope centre, measured with a caliper"
        />
        <p className="mt-2 text-xs text-muted">
          This is the single most influential number in the model: it sets the launch angle, the near
          zero and the shape of the whole curve. Measure it rather than estimate it — on this rifle,
          40 mm versus 70 mm changes the fitted ballistic coefficient from 422 to 353 kg/m² and moves
          the 100 m prediction from −3.21 to −3.02 mrad. If you are not sure, tick “Sight height” on
          the Calibrate tab and let a fit solve it, then write the result here.
        </p>
      </Card>

      <Card title="Units">
        <div className="grid gap-3 sm:grid-cols-2">
          <SegmentedControl
            label="Length / velocity / energy"
            options={[
              { value: "metric", label: "Metric" },
              { value: "imperial", label: "Imperial" },
            ]}
            value={settings.unitSystem}
            onChange={(unitSystem) => patch({ unitSystem })}
          />
          <SegmentedControl
            label="Angular unit"
            options={[
              { value: "mrad", label: "mrad" },
              { value: "moa", label: "MOA" },
            ]}
            value={settings.angularUnit}
            onChange={(angularUnit) => patch({ angularUnit })}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          Ranges are always metres — that is how pellet data is written down at the range. Hold-over,
          velocity, energy, mass and caliber follow the unit system.
        </p>
      </Card>

      <Card title="Turret" subtitle="Used to convert hold-over into clicks.">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Click value"
            value={settings.clickValue}
            onChange={(clickValue) => patch({ clickValue })}
            unit={settings.clickUnit === "mrad" ? "mrad / click" : "MOA / click"}
            min={0}
            max={10}
            step={0.05}
            hint="0 hides the click helper"
          />
          <SegmentedControl
            label="Turret unit"
            options={[
              { value: "mrad", label: "mrad" },
              { value: "moa", label: "MOA" },
            ]}
            value={settings.clickUnit}
            onChange={(clickUnit) => patch({ clickUnit })}
          />
        </div>
      </Card>

      <Card title="Ranges">
        <div className="space-y-3">
          <DistanceListEditor />
          <NumberField
            label="Maximum range"
            value={settings.maxRangeM}
            onChange={(maxRangeM) => patch({ maxRangeM })}
            unit="m"
            min={10}
            max={1000}
            step={10}
            hint="How far the trajectory is integrated and charted"
          />
        </div>
      </Card>

      <Card title="Hold-over source" subtitle="Which number the calculator puts in front of you.">
        <SegmentedControl
          options={[
            { value: "measured", label: "Measured card" },
            { value: "model", label: "Physics model" },
          ]}
          value={settings.dropSource}
          onChange={(dropSource) => patch({ dropSource })}
        />
        <p className="mt-2 text-xs text-muted">
          Measured card = your own drops, moved to today&apos;s air by the model. Physics model = pure
          calculation, ignoring the card. If no card exists for the active bullet the model is used
          either way.
        </p>
        {state.dope ? (
          <p className="mt-2 text-sm text-fg">
            Card: {sortedMeasurements(state.dope.measurements).length} points ·{
            " "}
            {state.bullets.find((b) => b.id === state.dope!.bulletId)?.name ?? "deleted bullet"} ·
            shot in {describeWeather(state.dope.weather)}
          </p>
        ) : (
          <Notice tone="warn">No measured card saved yet.</Notice>
        )}
      </Card>

      <WeatherEditor />

      <Card title="How the numbers are produced">
        <div className="space-y-2 text-sm text-muted">
          <p>
            The model is a point mass with quadratic drag: deceleration = ρ·v² / (2·BC), where ρ is
            air density from your temperature, pressure and humidity, and BC = mass / (Cd · area) in
            kg/m². The launch angle is solved so the trajectory crosses the sight line exactly at
            your zero distance.
          </p>
          <p>
            Integration is 4th-order Runge-Kutta with a 5 cm distance step, which is converged to
            well under 0.01 mrad at 200 m.
          </p>
          <p>
            Everything runs in your browser. Nothing is sent anywhere, and the app keeps working with
            no signal once it has been opened once.
          </p>
          <p>
            Your measured drops are kept as a card and are never overwritten by the model: the model
            only supplies the difference between the conditions you measured in and today&apos;s. A
            single fitted BC cannot pass through every measured point of a real drop table, so the
            card — not the model — sets the level you dial.
          </p>
        </div>
      </Card>

      <Card title="Storage">
        <Notice tone="info">
          Bullets, weather and settings are saved in this browser&apos;s local storage
          (pcp-ballistic-calculator/state). Use Bullets → Backup to move them to another device.
        </Notice>
      </Card>
    </div>
  );
}
