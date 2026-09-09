import { describe, expect, it } from "vitest";
import {
  buildCapacityRows,
  capacityTone,
  formatBytes,
  percentOf,
} from "./AdminCapacityPanel";

const t = (key, vars) => (vars ? `${key}:${vars.used}/${vars.total}` : key);

describe("formatBytes", () => {
  it("steps up the unit so cluster-scale numbers stay short", () => {
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatBytes(8 * 1024 ** 3)).toBe("8.0 GB");
    expect(formatBytes(3 * 1024 ** 4)).toBe("3.0 TB");
  });

  it("does not invent a number when there is none", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("percentOf", () => {
  it("clamps into 0-100 and refuses a zero denominator", () => {
    expect(percentOf(1, 4)).toBe(25);
    expect(percentOf(9, 4)).toBe(100);
    expect(percentOf(1, 0)).toBeNull();
    expect(percentOf(undefined, 8)).toBeNull();
  });
});

describe("capacityTone", () => {
  it("escalates at the given limits", () => {
    const limits = { warn: 75, critical: 90 };
    expect(capacityTone(10, limits)).toBe("ok");
    expect(capacityTone(80, limits)).toBe("warn");
    expect(capacityTone(95, limits)).toBe("critical");
    expect(capacityTone(null, limits)).toBe("unknown");
  });
});

describe("buildCapacityRows", () => {
  const overview = {
    thresholds: { cpu: 90, memory: 90 },
    cpu_used: 12.5,
    cpu_total: 64,
    mem_used: 96 * 1024 ** 3,
    mem_total: 128 * 1024 ** 3,
    disk_used: 4 * 1024 ** 4,
    disk_total: 5 * 1024 ** 4,
  };

  it("turns the three sources into one comparable set of rows", () => {
    const rows = buildCapacityRows(
      {
        overview,
        ipStatus: { configured: true, used_ips: 200, total_ips: 254 },
        gpuMappings: { data: [{ used_count: 3, capacity_count: 4 }, { used_count: 0, capacity_count: 4 }] },
      },
      t,
    );

    expect(rows.map((row) => row.key)).toEqual(["cpu", "memory", "disk", "ip", "gpu"]);
    expect(rows.find((row) => row.key === "gpu").percent).toBeCloseTo(37.5);
    expect(rows.find((row) => row.key === "disk").tone).toBe("warn");
    expect(rows.find((row) => row.key === "cpu").tone).toBe("ok");
  });

  it("uses the configured CPU threshold rather than a hard-coded one", () => {
    const strict = buildCapacityRows(
      { overview: { ...overview, thresholds: { cpu: 15, memory: 90 } } },
      t,
    );
    expect(strict.find((row) => row.key === "cpu").tone).toBe("critical");
  });

  it("skips a source that failed instead of showing it as zero", () => {
    const rows = buildCapacityRows({ overview: null, ipStatus: null, gpuMappings: null }, t);
    expect(rows).toEqual([]);
  });

  it("omits an unconfigured subnet and a GPU-less deployment", () => {
    const rows = buildCapacityRows(
      { overview, ipStatus: { configured: false }, gpuMappings: { data: [] } },
      t,
    );
    expect(rows.map((row) => row.key)).toEqual(["cpu", "memory", "disk"]);
  });

  it("omits GPU when mappings exist but expose no capacity", () => {
    const rows = buildCapacityRows(
      { overview: null, gpuMappings: { data: [{ used_count: 0, capacity_count: 0 }] } },
      t,
    );
    expect(rows).toEqual([]);
  });
});
