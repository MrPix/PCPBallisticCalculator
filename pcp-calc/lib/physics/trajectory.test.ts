import { describe, expect, it } from "vitest";
import {
  STANDARD_GRAVITY,
  ZeroReachableError,
  type ShotConfig,
  angularDropMrad,
  dragFactor,
  dropTable,
  heightAt,
  integrate,
  interpolateAt,
  sample,
  simulate,
  solveLaunchAngle,
  speedAtDistance,
} from "./trajectory";

const AIR: ShotConfig = {
  muzzleVelocityMs: 280,
  ballisticCoefficientKgM2: 422.3,
  sightHeightM: 0.04,
  zeroDistanceM: 50,
  airDensityKgM3: 1.2017,
  gravityMps2: STANDARD_GRAVITY,
};

function vacuumConfig(v0: number, sightHeightM: number): ShotConfig {
  return {
    muzzleVelocityMs: v0,
    ballisticCoefficientKgM2: 1e12, // effectively no drag
    sightHeightM,
    zeroDistanceM: 50,
    airDensityKgM3: 1.2017,
    gravityMps2: STANDARD_GRAVITY,
  };
}

describe("drag factor", () => {
  it("is rho / (2 * BC)", () => {
    expect(dragFactor(1.2, 300)).toBeCloseTo(0.002, 12);
  });

  it("rejects a non-positive ballistic coefficient", () => {
    expect(() => dragFactor(1.2, 0)).toThrow(RangeError);
  });
});

describe("integrator against closed-form limits", () => {
  it("matches the vacuum parabola when drag is removed", () => {
    const cfg = vacuumConfig(300, 0.03);
    const points = integrate(cfg, 0, { maxDistanceM: 120, stepMeters: 0.05 });
    const g = STANDARD_GRAVITY;
    for (const distance of [10, 40, 80, 120]) {
      const p = interpolateAt(points, distance);
      expect(p).not.toBeNull();
      const expectedY = -0.03 - (0.5 * g * distance * distance) / (300 * 300);
      const expectedT = distance / 300;
      expect(p!.y).toBeCloseTo(expectedY, 6);
      expect(p!.t).toBeCloseTo(expectedT, 6);
      // In vacuum the horizontal speed is constant while gravity adds vertical
      // speed, so v^2 - (g t)^2 must stay exactly v0^2.
      expect(p!.v * p!.v - (g * p!.t) ** 2).toBeCloseTo(300 * 300, 2);
      expect(p!.angleRad).toBeCloseTo(Math.atan2(-g * expectedT, 300), 6);
    }
  });

  it("matches the exponential velocity decay of pure quadratic drag", () => {
    const cfg: ShotConfig = {
      muzzleVelocityMs: 300,
      ballisticCoefficientKgM2: 200,
      sightHeightM: 0.03,
      zeroDistanceM: 50,
      airDensityKgM3: 1.2,
      gravityMps2: 0, // turn gravity off so v(x) = v0 * exp(-k x) is exact
    };
    const k = dragFactor(1.2, 200);
    for (const distance of [50, 100, 200]) {
      const v = speedAtDistance(cfg, 0, distance);
      expect(v).not.toBeNull();
      expect(v!).toBeCloseTo(300 * Math.exp(-k * distance), 4);
    }
  });

  it("is step-size converged well below a tenth of a milliradian", () => {
    const coarse = integrate(AIR, 0.004, { maxDistanceM: 200, stepMeters: 0.05 });
    const fine = integrate(AIR, 0.004, { maxDistanceM: 200, stepMeters: 0.002 });
    const coarseDrop = interpolateAt(coarse, 200)!.y;
    const fineDrop = interpolateAt(fine, 200)!.y;
    expect(Math.abs(coarseDrop - fineDrop) * 1000).toBeLessThan(0.1); // mrad at 200 m
  });
});

describe("zero solving", () => {
  it("makes the trajectory cross the sight line exactly at the zero distance", () => {
    const traj = simulate(AIR, 250);
    const height = heightAt(traj.points, AIR.zeroDistanceM);
    expect(height).not.toBeNull();
    expect(Math.abs(height!)).toBeLessThan(1e-5);
  });

  it("produces a small positive launch angle for a rifle-like shot", () => {
    const traj = simulate(AIR, 250);
    expect(traj.launchAngleRad).toBeGreaterThan(0.001);
    expect(traj.launchAngleRad).toBeLessThan(0.01);
  });

  it("reports both sight-line crossings around the zero", () => {
    const traj = simulate(AIR, 250);
    expect(traj.zeroCrossingsM.length).toBeGreaterThanOrEqual(2);
    const [first, second] = traj.zeroCrossingsM;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(AIR.zeroDistanceM);
    expect(second).toBeCloseTo(AIR.zeroDistanceM, 1);
  });

  it("throws when the zero distance is out of reach", () => {
    const hopeless: ShotConfig = { ...AIR, muzzleVelocityMs: 25, zeroDistanceM: 300 };
    expect(() => simulate(hopeless, 300)).toThrow(ZeroReachableError);
    expect(() => solveLaunchAngle(hopeless)).toThrow(ZeroReachableError);
  });
});

describe("drop output", () => {
  const traj = simulate(AIR, 250);

  it("is zero at the zero distance", () => {
    expect(angularDropMrad(traj, 50)).toBeCloseTo(0, 2);
  });

  it("is positive (impact above aim) between the first zero and the zero distance", () => {
    const drop = angularDropMrad(traj, 25);
    expect(drop).not.toBeNull();
    expect(drop!).toBeGreaterThan(0);
  });

  it("grows more negative with distance", () => {
    const drops = [75, 100, 150, 200].map((d) => angularDropMrad(traj, d)!);
    for (let i = 1; i < drops.length; i++) {
      expect(drops[i]).toBeLessThan(drops[i - 1]);
    }
  });

  it("angular and linear drop agree", () => {
    const point = sample(traj, 150)!;
    const angular = angularDropMrad(traj, 150)!;
    expect(angular).toBeCloseTo((point.y / 150) * 1000, 9);
  });

  it("velocity and time of flight increase monotonically with distance", () => {
    const distances = [25, 50, 100, 150, 200, 250];
    const speeds = distances.map((d) => sample(traj, d)!.v);
    const times = distances.map((d) => sample(traj, d)!.t);
    for (let i = 1; i < distances.length; i++) {
      expect(speeds[i]).toBeLessThan(speeds[i - 1]);
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });

  it("returns null for a distance the projectile never reaches", () => {
    const short = simulate({ ...AIR, muzzleVelocityMs: 60, ballisticCoefficientKgM2: 20 }, 120);
    expect(sample(short, 500)).toBeNull();
    expect(angularDropMrad(short, 500)).toBeNull();
  });
});

describe("drop table", () => {
  it("marks rows the pellet cannot reach", () => {
    const traj = simulate({ ...AIR, muzzleVelocityMs: 80, ballisticCoefficientKgM2: 30 }, 120);
    const rows = dropTable(traj, [25, 100, 500], 0.001);
    expect(rows[0].reached).toBe(true);
    expect(rows[0].energyJ).toBeGreaterThan(0);
    const last = rows[rows.length - 1];
    expect(last.reached).toBe(false);
    expect(Number.isNaN(last.dropMrad)).toBe(true);
  });

  it("computes kinetic energy as 1/2 m v^2", () => {
    const traj = simulate(AIR, 100);
    const rows = dropTable(traj, [100], 0.001); // 1 g
    const v = rows[0].velocityMps;
    expect(rows[0].energyJ).toBeCloseTo(0.5 * 0.001 * v * v, 6);
  });
});

describe("impact and apex", () => {
  it("finds where the pellet falls back to muzzle height", () => {
    const traj = simulate(AIR, 400);
    expect(traj.impactDistanceM).not.toBeNull();
    expect(traj.impactDistanceM!).toBeGreaterThan(traj.zeroCrossingsM[1]);
    const atImpact = sample(traj, traj.impactDistanceM!);
    expect(atImpact!.y).toBeCloseTo(-AIR.sightHeightM, 2);
  });

  it("finds the apex between the zeros", () => {
    const traj = simulate(AIR, 250);
    expect(traj.apex.heightM).toBeGreaterThan(0);
    expect(traj.apex.distanceM).toBeGreaterThan(10);
    expect(traj.apex.distanceM).toBeLessThan(traj.zeroCrossingsM[1]);
  });
});
