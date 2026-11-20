/**
 * Memory budget for the P4 stack, and the summary of a RAM probe (ADR 0006).
 *
 * Budget: 14 GiB (14336 MiB) of a 16 GB runner. The OS, the runner agent and the Docker daemon need about 1 GiB, and the
 * sampler reads container RSS, not page cache. The last ~1 GiB covers image unpacking and the readiness burst. The
 * number is committed here. Only an explicit P4_RAM_BUDGET_MIB can change the value a run uses.
 */
export declare const RAM_BUDGET_MIB = 14336;
/**
 * Parses the "used" half of a docker stats MemUsage value, for example "884.3MiB / 15.71GiB" -> 884.3. Returns NaN for
 * anything it cannot read.
 */
export declare function parseMemUsageMiB(raw: string): number;
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
    containers: {
        name: string;
        peakMiB: number;
    }[];
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
/**
 * Builds the report. Samples with a NaN value are ignored. With no usable samples, `fit` is false and `containers` is
 * empty: an empty probe never passes.
 */
export declare function summarize(samples: RamSample[], meta: SummaryMeta): RamReport;
//# sourceMappingURL=p4-ram.d.ts.map