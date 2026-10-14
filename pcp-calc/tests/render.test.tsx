import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { BulletLibrary } from "@/components/bullet-library";
import { Calculator } from "@/components/calculator";
import { Calibration } from "@/components/calibration";
import { SettingsPanel } from "@/components/settings-panel";
import { prepareShot, summarizeShot } from "@/lib/data/shot";
import { createSeedBullet, createSeedState } from "@/lib/data/seed";
import { AppStoreProvider } from "@/lib/state/app-store";

function render(ui: ReactNode): string {
  // React inserts <!-- --> between adjacent text nodes; strip them so the
  // assertions can read like the sentences a person sees on screen.
  return renderToString(<AppStoreProvider>{ui}</AppStoreProvider>).replace(/<!--[\s\S]*?-->/g, "");
}

describe("calculator page", () => {
  const html = render(<Calculator />);

  it("renders the main sections", () => {
    expect(html).toContain("Hold-over");
    expect(html).toContain("Drop table");
    expect(html).toContain("Weather today");
    expect(html).toContain("Trajectory");
    expect(html).toContain("Range");
  });

  it("shows the seeded test bullet", () => {
    expect(html).toContain(".177 1 g slug (range test)");
    expect(html).toContain("353 kg/m²");
  });

  it("prerenders the measured hold-over as the headline number", () => {
    const state = createSeedState();
    const shot = prepareShot(
      createSeedBullet(),
      { weather: state.weather, sightHeightMm: state.settings.sightHeightMm },
      state.settings.maxRangeM,
    );
    const summary = summarizeShot(shot, state.distanceM);
    // With the calipered 70 mm sight height the model says -3.02 at 100 m;
    // the shooter measured -2.9.
    expect(summary.dropMrad.toFixed(2)).toBe("-3.02");
    // With a card saved for this bullet the headline is the shooter's number.
    expect(html).toContain("-2.90");
    expect(html).toContain("measured");
    expect(html).toContain("correction +0.12");
    expect(html).toContain(summary.velocityMps.toFixed(0));
  });

  it("still shows the uncorrected model next to it", () => {
    expect(html).toContain("model -3.02");
    expect(html).toContain("Model"); // the drop-table column header
  });

  it("plots the measured points as dots under the corrected curve", () => {
    expect(html).toContain("<svg");
    expect(html).toContain("<path d=\"M");
    expect(html).toContain('fill="var(--good)"');
    expect(html).toContain("Dots are your measured points");
  });

  it("renders every configured drop-table row", () => {
    for (const distance of createSeedState().settings.tableDistancesM) {
      expect(html).toContain(`${distance} m`);
    }
  });

  it("keeps the sign convention: above aim is positive", () => {
    expect(html).toContain("+0.60"); // 25 m, measured
    expect(html).toContain("-11.20"); // 200 m, measured
    expect(html).toContain("+0.30"); // 25 m, model column
    expect(html).toContain("-11.54"); // 200 m, model column
  });
});

describe("bullets page", () => {
  const html = render(<BulletLibrary />);

  it("renders the library and the backup tools", () => {
    expect(html).toContain("Bullet library");
  });

  it("lists the seeded bullet with its derived drag coefficient", () => {
    expect(html).toContain(".177 1 g slug (range test)");
    expect(html).toContain("zero 50 m");
  });
});

describe("calibration page", () => {
  const html = render(<Calibration />);

  it("renders the measurement editor pre-filled with the range test", () => {
    expect(html).toContain("Measured drops");
    expect(html).toContain("Fit parameters");
    expect(html).toContain("value=\"200\"");
    expect(html).toContain("value=\"-11.2\"");
  });

  it("offers the chronograph route to a ballistic coefficient", () => {
    expect(html).toContain("chronograph");
    expect(html).toContain("Compute BC");
  });
});

describe("settings page", () => {
  const html = render(<SettingsPanel />);

  it("renders unit, turret and range controls", () => {
    expect(html).toContain("Units");
    expect(html).toContain("Click value");
    expect(html).toContain("Drop-table distances");
    expect(html).toContain("Maximum range");
    expect(html).toContain("Hold-over source");
  });

  it("explains the model in plain language", () => {
    expect(html).toContain("Runge-Kutta");
    expect(html).toContain("local storage");
  });
});
