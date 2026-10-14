import { describe, expect, it } from "vitest";
import {
  airDensity,
  densityFactor,
  saturationWaterPressurePa,
  speedOfSoundMps,
  validateWeather,
  waterVaporPressurePa,
} from "./atmosphere";

describe("air density", () => {
  it("reproduces the ISA sea-level density", () => {
    const rho = airDensity({ temperatureC: 15, pressureHpa: 1013.25, humidityPct: 0 });
    expect(rho).toBeCloseTo(1.225, 3);
    expect(densityFactor({ temperatureC: 15, pressureHpa: 1013.25, humidityPct: 0 })).toBeCloseTo(1, 4);
  });

  it("matches the range-test conditions of the seeded bullet", () => {
    // +15 C, 998 hPa, 63 % RH
    const rho = airDensity({ temperatureC: 15, pressureHpa: 998, humidityPct: 63 });
    expect(rho).toBeCloseTo(1.2017, 3);
  });

  it("makes air denser when it is colder", () => {
    const warm = airDensity({ temperatureC: 30, pressureHpa: 1000, humidityPct: 50 });
    const cold = airDensity({ temperatureC: 0, pressureHpa: 1000, humidityPct: 50 });
    expect(cold).toBeGreaterThan(warm);
    expect(cold / warm).toBeGreaterThan(1.08);
  });

  it("makes air denser when the pressure rises", () => {
    const low = airDensity({ temperatureC: 15, pressureHpa: 960, humidityPct: 50 });
    const high = airDensity({ temperatureC: 15, pressureHpa: 1020, humidityPct: 50 });
    expect(high).toBeGreaterThan(low);
  });

  it("makes moist air lighter than dry air at the same temperature and pressure", () => {
    const dry = airDensity({ temperatureC: 30, pressureHpa: 1010, humidityPct: 0 });
    const wet = airDensity({ temperatureC: 30, pressureHpa: 1010, humidityPct: 100 });
    expect(wet).toBeLessThan(dry);
    expect(dry - wet).toBeGreaterThan(0.005);
  });

  it("computes vapour pressure from relative humidity", () => {
    const sat = saturationWaterPressurePa(15);
    expect(sat).toBeGreaterThan(1700);
    expect(sat).toBeLessThan(1720);
    const partial = waterVaporPressurePa({ temperatureC: 15, pressureHpa: 998, humidityPct: 63 });
    expect(partial).toBeCloseTo(0.63 * sat, 6);
    expect(waterVaporPressurePa({ temperatureC: 15, pressureHpa: 998, humidityPct: 0 })).toBe(0);
  });

  it("clamps absurd humidity instead of producing negative vapour pressure", () => {
    expect(waterVaporPressurePa({ temperatureC: 15, pressureHpa: 998, humidityPct: 250 })).toBeCloseTo(
      saturationWaterPressurePa(15),
      6,
    );
  });

  it("knows the speed of sound at 15 C", () => {
    expect(speedOfSoundMps(15)).toBeCloseTo(340.3, 1);
    expect(speedOfSoundMps(0)).toBeCloseTo(331.3, 1);
  });
});

describe("weather validation", () => {
  it("accepts normal weather", () => {
    expect(validateWeather({ temperatureC: 15, pressureHpa: 998, humidityPct: 63 })).toEqual([]);
  });

  it("flags a pressure that is clearly kPa typed into an hPa field", () => {
    const issues = validateWeather({ temperatureC: 15, pressureHpa: 998000, humidityPct: 63 });
    expect(issues.map((i) => i.field)).toContain("pressureHpa");
    expect(issues[0].message).toMatch(/kPa/);
  });

  it("flags out-of-range temperature and humidity", () => {
    const issues = validateWeather({ temperatureC: 200, pressureHpa: 1000, humidityPct: -5 });
    expect(issues.map((i) => i.field)).toEqual(["temperatureC", "humidityPct"]);
  });
});
