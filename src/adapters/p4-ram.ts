/**
 * Memory budget for the P4 stack, and the summary of a RAM probe (ADR 0006).
 *
 * Budget: 14 GiB (14336 MiB) of a 16 GB runner. The OS, the runner agent and the Docker daemon need about 1 GiB, and the
 * sampler reads container RSS, not page cache. The last ~1 GiB covers image unpacking and the readiness burst. The
 * number is committed here. Only an explicit P4_RAM_BUDGET_MIB can change the value a run uses.
 */
export const RAM_BUDGET_MIB = 14336;

/** Units docker stats prints. Decimal (kB, MB, GB) and binary (KiB, MiB, GiB) are both used. */
const UNIT_TO_MIB: Record<string, number> = {
  B: 1 / 1048576,
  kB: 1000 / 1048576,
  KB: 1000 / 1048576,
  KiB: 1024 / 1048576,
  MB: 1000000 / 1048576,
  MiB: 1,
  GB: 1000000000 / 1048576,
  GiB: 1024,
  TB: 1000000000000 / 1048576,
  TiB: 1048576,
};

/**
 * Parses the "used" half of a docker stats MemUsage value, for example "884.3MiB / 15.71GiB" -> 884.3. Returns NaN for
 * anything it cannot read.
 */
export function parseMemUsageMiB(raw: string): number {
  const used = raw.split("/")[0]?.trim() ?? "";
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)$/.exec(used);
  if (!match) {
    return Number.NaN;
  }
  const value = Number(match[1] ?? "");
  const factor = UNIT_TO_MIB[match[2] ?? ""];
  return factor === undefined ? Number.NaN : value * factor;
}

export interface RamSample {
  /** Epoch seconds at the time of the sample. Samples with the same t form one instant. */
  t: number;
  container: string;
  mib: number;
}

export interface RamReport {
  schema: 1;
  budgetMiB: number;
  products: string[];
  containers: { name: string; peakMiB: number }[];
  /** Peak of the per-instant SUM across containers. This is the number the budget is checked against. */
  totalPeakMiB: number;
  /** Sum of each container's own peak. Always >= totalPeakMiB. Reported for transparency. */
  sumOfPeaksMiB: number;
  hostUsedPeakMiB: number | null;
  diskFreeGiB: number | null;
  readyMs: number | null;
  fit: boolean;
}

export interface SummaryMeta {
  products: string[];
  budgetMiB?: number;
  hostUsedPeakMiB?: number;
  diskFreeGiB?: number;
  readyMs?: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Builds the report. Samples with a NaN value are ignored. With no usable samples, `fit` is false and `containers` is
 * empty: an empty probe never passes.
 */
export function summarize(samples: RamSample[], meta: SummaryMeta): RamReport {
  const budgetMiB = meta.budgetMiB ?? RAM_BUDGET_MIB;
  const usable = samples.filter((s) => Number.isFinite(s.mib));

  const peakByContainer = new Map<string, number>();
  const sumByInstant = new Map<number, number>();
  for (const s of usable) {
    peakByContainer.set(s.container, Math.max(peakByContainer.get(s.container) ?? 0, s.mib));
    sumByInstant.set(s.t, (sumByInstant.get(s.t) ?? 0) + s.mib);
  }

  const containers = [...peakByContainer.entries()]
    .map(([name, peak]) => ({ name, peakMiB: round1(peak) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalPeakMiB = round1(Math.max(0, ...sumByInstant.values()));
  const sumOfPeaksMiB = round1(containers.reduce((acc, c) => acc + c.peakMiB, 0));
  const fit = containers.length > 0 && totalPeakMiB <= budgetMiB;

  return {
    schema: 1,
    budgetMiB,
    products: meta.products,
    containers,
    totalPeakMiB,
    sumOfPeaksMiB,
    hostUsedPeakMiB: meta.hostUsedPeakMiB === undefined ? null : round1(meta.hostUsedPeakMiB),
    diskFreeGiB: meta.diskFreeGiB === undefined ? null : round1(meta.diskFreeGiB),
    readyMs: meta.readyMs ?? null,
    fit,
  };
}
