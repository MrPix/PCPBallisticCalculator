"use client";

import { useMemo } from "react";
import { airDensity, validateWeather } from "@/lib/physics/atmosphere";
import {
  celsiusToTemperatureUnit,
  formatFixed,
  hpaToPressureUnit,
  pressureToHpa,
  temperatureToCelsius,
  type PressureUnit,
  type TemperatureUnit,
} from "@/lib/physics/units";
import { useAppStore } from "@/lib/state/app-store";
import { Card, NumberField, Notice, SegmentedControl } from "./ui";

const PRESSURE_UNITS: { value: PressureUnit; label: string }[] = [
  { value: "hPa", label: "hPa" },
  { value: "kPa", label: "kPa" },
  { value: "mmHg", label: "mmHg" },
  { value: "inHg", label: "inHg" },
  { value: "psi", label: "psi" },
];

export function WeatherEditor({ compact = false }: { compact?: boolean }) {
  const { state, dispatch } = useAppStore();
  const { weather, settings } = state;

  const issues = useMemo(() => validateWeather(weather), [weather]);
  const density = useMemo(() => airDensity(weather), [weather]);

  const patch = (next: Partial<typeof weather>) =>
    dispatch({ type: "setWeather", weather: { ...weather, ...next } });

  const pressureDisplay = hpaToPressureUnit(weather.pressureHpa, settings.pressureUnit);
  const temperatureDisplay = celsiusToTemperatureUnit(weather.temperatureC, settings.temperatureUnit);

  return (
    <Card
      title="Weather today"
      subtitle="Air density drives drag, so this is what changes from day to day."
      actions={
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: "setWeather",
              weather: { temperatureC: 15, pressureHpa: 1013.25, humidityPct: 0 },
            })
          }
          className="min-h-9 rounded-lg border border-line px-3 text-xs text-muted hover:text-fg"
        >
          ISA
        </button>
      }
    >
      <div className={`grid gap-3 ${compact ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3"}`}>
        <NumberField
          label="Temperature"
          value={Number(formatFixed(temperatureDisplay, 1))}
          onChange={(v) => patch({ temperatureC: temperatureToCelsius(v, settings.temperatureUnit) })}
          unit={settings.temperatureUnit === "C" ? "°C" : "°F"}
          min={-40}
          max={140}
          step={0.5}
        />
        <NumberField
          label="Pressure"
          value={Number(formatFixed(pressureDisplay, 1))}
          onChange={(v) => patch({ pressureHpa: pressureToHpa(v, settings.pressureUnit) })}
          unit={settings.pressureUnit}
          min={settings.pressureUnit === "hPa" || settings.pressureUnit === "kPa" ? 60 : 15}
          max={settings.pressureUnit === "hPa" || settings.pressureUnit === "kPa" ? 1110 : 16.2}
          step={0.1}
        />
        <NumberField
          label="Humidity"
          value={weather.humidityPct}
          onChange={(v) => patch({ humidityPct: v })}
          unit="%"
          min={0}
          max={100}
          step={1}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Pressure unit"
          options={PRESSURE_UNITS}
          value={settings.pressureUnit}
          onChange={(pressureUnit) => dispatch({ type: "setSettings", patch: { pressureUnit } })}
        />
        <SegmentedControl
          label="Temperature unit"
          options={[
            { value: "C", label: "°C" },
            { value: "F", label: "°F" },
          ]}
          value={settings.temperatureUnit}
          onChange={(temperatureUnit: TemperatureUnit) =>
            dispatch({ type: "setSettings", patch: { temperatureUnit } })
          }
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-bg-elevated px-3 py-2">
        <span className="text-xs text-muted">Resulting air density</span>
        <span className="nums text-sm font-semibold text-fg">{density.toFixed(4)} kg/m³</span>
      </div>

      {issues.length > 0 && (
        <div className="mt-3 space-y-2">
          {issues.map((issue) => (
            <Notice key={issue.field} tone="warn">
              {issue.message}
            </Notice>
          ))}
        </div>
      )}
    </Card>
  );
}
