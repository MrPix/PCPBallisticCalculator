"use client";

import { useRef, useState } from "react";
import { fitFromDrops } from "@/lib/physics/fit";
import {
  caliberToDisplay,
  formatFixed,
  massToDisplay,
  velocityToDisplay,
} from "@/lib/physics/units";
import { impliedDragCoefficient, toShotConfig } from "@/lib/data/shot";
import { exportStateJson, importStateJson } from "@/lib/data/storage";
import type { Bullet } from "@/lib/data/types";
import { useAppStore } from "@/lib/state/app-store";
import { Button, Card, Notice, NumberField } from "./ui";

type Draft = Omit<Bullet, "id" | "createdAt" | "updatedAt">;

const NEW_BULLET: Draft = {
  name: "New pellet",
  caliberMm: 4.52,
  massG: 0.7,
  ballisticCoefficientKgM2: 200,
  muzzleVelocityMs: 250,
  zeroDistanceM: 50,
  notes: "",
};

export function BulletLibrary() {
  const { state, dispatch } = useAppStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const editing = state.bullets.find((b) => b.id === editingId) ?? null;

  const exportJson = () => {
    const blob = new Blob([exportStateJson(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pcp-ballistics.json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Exported pcp-ballistics.json.");
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const { state: imported, error } = importStateJson(text);
    if (!imported || error) {
      setMessage(error ?? "Import failed.");
      return;
    }
    dispatch({ type: "replaceState", state: imported });
    setMessage(`Imported ${imported.bullets.length} bullet(s).`);
  };

  return (
    <div className="space-y-4">
      <Card
        title="Bullet library"
        subtitle="Each bullet carries its own fitted ballistic coefficient, zero and sight height."
        actions={
          <Button variant="primary" onClick={() => { setAdding((v) => !v); setEditingId(null); }}>
            {adding ? "Close" : "Add bullet"}
          </Button>
        }
      >
        {adding && (
          <BulletForm
            draft={NEW_BULLET}
            onSave={(draft) => {
              dispatch({ type: "addBullet", bullet: draft });
              setAdding(false);
              setMessage(`Added “${draft.name}”.`);
            }}
            onCancel={() => setAdding(false)}
            saveLabel="Add bullet"
          />
        )}

        <ul className="mt-1 space-y-3">
          {state.bullets.map((bullet) => {
            const isActive = bullet.id === state.activeBulletId;
            const mass = massToDisplay(bullet.massG, state.settings.unitSystem);
            const caliber = caliberToDisplay(bullet.caliberMm, state.settings.unitSystem);
            const velocity = velocityToDisplay(bullet.muzzleVelocityMs, state.settings.unitSystem);
            return (
              <li
                key={bullet.id}
                className={`rounded-xl border p-3 ${
                  isActive ? "border-accent bg-accent/10" : "border-line bg-bg-elevated"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-fg">{bullet.name}</p>
                    <p className="nums mt-1 text-xs text-muted">
                      {formatFixed(caliber.value, caliber.unit === "mm" ? 2 : 3)} {caliber.unit} ·{" "}
                      {formatFixed(mass.value, mass.unit === "g" ? 2 : 0)} {mass.unit} ·{" "}
                      {formatFixed(velocity.value, 0)} {velocity.unit} · BC{" "}
                      {formatFixed(bullet.ballisticCoefficientKgM2, 0)} kg/m² · Cd{" "}
                      {formatFixed(impliedDragCoefficient(bullet), 2)}
                    </p>
                    <p className="nums mt-1 text-xs text-muted">
                      zero {bullet.zeroDistanceM} m
                    </p>
                    {bullet.notes && <p className="mt-1 text-xs text-muted">{bullet.notes}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!isActive && (
                      <Button onClick={() => dispatch({ type: "selectBullet", id: bullet.id })}>Use</Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingId(editingId === bullet.id ? null : bullet.id);
                        setAdding(false);
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => dispatch({ type: "duplicateBullet", id: bullet.id })}>
                      Duplicate
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        if (state.bullets.length <= 1) {
                          setMessage("Keep at least one bullet in the library.");
                          return;
                        }
                        if (window.confirm(`Delete “${bullet.name}”?`)) {
                          dispatch({ type: "deleteBullet", id: bullet.id });
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {editing && editing.id === bullet.id && (
                  <div className="mt-3 border-t border-line pt-3">
                    <BulletForm
                      draft={{
                        name: editing.name,
                        caliberMm: editing.caliberMm,
                        massG: editing.massG,
                        ballisticCoefficientKgM2: editing.ballisticCoefficientKgM2,
                        muzzleVelocityMs: editing.muzzleVelocityMs,
                        zeroDistanceM: editing.zeroDistanceM,
                        notes: editing.notes,
                      }}
                      onSave={(draft) => {
                        dispatch({ type: "updateBullet", id: editing.id, patch: draft });
                        setEditingId(null);
                        setMessage(`Saved “${draft.name}”.`);
                      }}
                      onCancel={() => setEditingId(null)}
                      saveLabel="Save changes"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {message && (
          <div className="mt-3">
            <Notice tone="info">{message}</Notice>
          </div>
        )}
      </Card>

      <Card title="Backup" subtitle="One JSON file with bullets, weather, settings and your last measurements.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportJson}>Export JSON</Button>
          <Button onClick={() => fileRef.current?.click()}>Import JSON</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm("Reset everything to the original range-test data?")) {
                dispatch({ type: "reset" });
                setMessage("Reset to the seeded test bullet.");
              }
            }}
          >
            Reset app
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onImportFile(e.target.files?.[0])}
          />
        </div>
      </Card>
    </div>
  );
}

function BulletForm({
  draft: initial,
  onSave,
  onCancel,
  saveLabel,
}: {
  draft: Draft;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  const { state } = useAppStore();
  const [draft, setDraft] = useState<Draft>(initial);
  const [fitMessage, setFitMessage] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const fitBc = () => {
    const config = toShotConfig(
      { ...draft, id: "draft", createdAt: "", updatedAt: "" },
      { weather: state.weather, sightHeightMm: state.settings.sightHeightMm },
    );
    const cardRows = state.dope?.measurements ?? [];
    const result = fitFromDrops(config, cardRows, ["ballisticCoefficientKgM2"]);
    if (!result.success) {
      setFitMessage(result.message ?? "Fit failed.");
      return;
    }
    set("ballisticCoefficientKgM2", Number(result.config.ballisticCoefficientKgM2.toFixed(1)));
    setFitMessage(
      `BC fitted to ${result.config.ballisticCoefficientKgM2.toFixed(0)} kg/m² (fit error ${result.rmsMrad.toFixed(2)} mrad).`,
    );
  };

  const canFit = (state.dope?.measurements.length ?? 0) > 0;

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium tracking-wide text-muted">Name</span>
        <input
          value={draft.name}
          onChange={(e) => set("name", e.target.value.slice(0, 60))}
          className="h-11 w-full rounded-xl border border-line bg-bg-elevated px-3 text-sm"
          maxLength={60}
        />
      </label>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <NumberField label="Caliber" value={draft.caliberMm} onChange={(v) => set("caliberMm", v)} unit="mm" min={3} max={12} step={0.01} />
        <NumberField label="Mass" value={draft.massG} onChange={(v) => set("massG", v)} unit="g" min={0.1} max={10} step={0.01} />
        <NumberField
          label="Muzzle velocity"
          value={draft.muzzleVelocityMs}
          onChange={(v) => set("muzzleVelocityMs", v)}
          unit="m/s"
          min={30}
          max={1200}
          step={1}
        />
        <NumberField
          label="Ballistic coefficient"
          value={draft.ballisticCoefficientKgM2}
          onChange={(v) => set("ballisticCoefficientKgM2", v)}
          unit="kg/m²"
          min={10}
          max={6000}
          step={1}
          hint="Fit it on the Calibrate tab"
        />
        <NumberField label="Zero distance" value={draft.zeroDistanceM} onChange={(v) => set("zeroDistanceM", v)} unit="m" min={1} max={500} step={1} />
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium tracking-wide text-muted">Notes</span>
        <textarea
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value.slice(0, 500))}
          rows={2}
          className="w-full rounded-xl border border-line bg-bg-elevated px-3 py-2 text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => onSave(draft)}>
          {saveLabel}
        </Button>
        <Button onClick={fitBc} disabled={!canFit}>
          Fit BC from my measurements
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {fitMessage && <Notice tone={fitMessage.startsWith("BC fitted") ? "info" : "warn"}>{fitMessage}</Notice>}
    </div>
  );
}
