import { describe, expect, it } from "vitest";
import {
  MRAD_PER_MOA,
  caliberToDisplay,
  clicksToDial,
  celsiusToTemperatureUnit,
  energyToDisplay,
  formatSigned,
  hpaToPressureUnit,
  massToDisplay,
  mradToDegrees,
  mradToMoa,
  moaToMrad,
  pressureToHpa,
  temperatureToCelsius,
  velocityToDisplay,
} from "./units";

describe("angular units", () => {
  it("converts mrad and MOA both ways", () => {
    expect(mradToMoa(1)).toBeCloseTo(3.437747, 5);
    expect(moaToMrad(1)).toBeCloseTo(MRAD_PER_MOA, 9);
    expect(moaToMrad(mradToMoa(11.2))).toBeCloseTo(11.2, 9);
  });

  it("1 MOA is 1/60 of a degree", () => {
    expect(MRAD_PER_MOA).toBeCloseTo((1 / 60) * (Math.PI / 180) * 1000, 9);
    expect(mradToDegrees(1)).toBeCloseTo(0.0572958, 6);
  });

  it("1 mrad is 10 cm at 100 m and 1 m at 1 km", () => {
    expect(0.001 * 100).toBeCloseTo(0.1, 12);
    expect(0.001 * 1000).toBeCloseTo(1, 12);
  });
});

describe("pressure units", () => {
  it("round-trips standard atmosphere", () => {
    expect(pressureToHpa(101.325, "kPa")).toBeCloseTo(1013.25, 4);
    expect(pressureToHpa(760, "mmHg")).toBeCloseTo(1013.25, 3);
    expect(pressureToHpa(29.9213, "inHg")).toBeCloseTo(1013.25, 2);
    expect(pressureToHpa(14.696, "psi")).toBeCloseTo(1013.25, 2);
    expect(pressureToHpa(1013.25, "hPa")).toBeCloseTo(1013.25, 6);
  });

  it("formats back out", () => {
    expect(hpaToPressureUnit(1013.25, "mmHg")).toBeCloseTo(760, 2);
    expect(hpaToPressureUnit(998, "kPa")).toBeCloseTo(99.8, 6);
  });
});

describe("temperature units", () => {
  it("converts C and F", () => {
    expect(temperatureToCelsius(59, "F")).toBeCloseTo(15, 6);
    expect(celsiusToTemperatureUnit(15, "F")).toBeCloseTo(59, 6);
    expect(temperatureToCelsius(32, "F")).toBeCloseTo(0, 6);
  });
});

describe("display conversions", () => {
  it("switches velocity between m/s and ft/s", () => {
    const metric = velocityToDisplay(280, "metric");
    expect(metric.unit).toBe("m/s");
    const imperial = velocityToDisplay(280, "imperial");
    expect(imperial.value).toBeCloseTo(918.63, 1);
    expect(imperial.unit).toBe("ft/s");
  });

  it("switches energy between joule and ft·lbf", () => {
    const metric = energyToDisplay(39, "metric");
    expect(metric.unit).toBe("J");
    const imperialEnergy = energyToDisplay(39, "imperial");
    expect(imperialEnergy.value).toBeCloseTo(28.77, 1);
  });

  it("converts mass and caliber", () => {
    expect(massToDisplay(1, "imperial").value).toBeCloseTo(15.432, 2);
    expect(caliberToDisplay(4.52, "imperial").value).toBeCloseTo(0.178, 3);
  });
});

describe("turret clicks", () => {
  it("turns a 200 m hold-over into clicks", () => {
    const clicks = clicksToDial(-11.2, 0.1, "mrad");
    expect(clicks).not.toBeNull();
    expect(clicks!.clicks).toBeCloseTo(-112, 6);
  });

  it("understands MOA turrets", () => {
    const clicks = clicksToDial(-11.2, 0.25, "moa");
    expect(clicks!.clicks).toBeCloseTo(-154.0, 0);
  });

  it("returns null when the click helper is disabled", () => {
    expect(clicksToDial(-11.2, 0, "mrad")).toBeNull();
  });
});

describe("formatting", () => {
  it("adds an explicit plus sign for above-aim impacts", () => {
    expect(formatSigned(0.6, 1)).toBe("+0.6");
    expect(formatSigned(-11.2, 1)).toBe("-11.2");
    expect(formatSigned(Number.NaN)).toBe("—");
  });
});
