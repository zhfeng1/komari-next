import type { PingTaskInfo } from "@/lib/pingRecords";

export type PingChartPoint = {
  time: string;
  timeMs: number;
  isNoDataBoundary?: boolean;
  [key: string]: string | number | boolean | null | undefined;
};

export type PingNoDataRegion = {
  startMs: number;
  endMs: number;
};

const DEFAULT_INTERVAL_MS = 60_000;
const NO_DATA_GAP_MULTIPLIER = 2.5;

function finiteTimeMs(value: string | number | Date | null | undefined) {
  const timeMs = value instanceof Date ? value.getTime() : new Date(value ?? "").getTime();
  return Number.isFinite(timeMs) ? timeMs : null;
}

export function getPingChartWindow(hours: number, endTime?: string | number | Date) {
  const endMs = finiteTimeMs(endTime) ?? Date.now();
  const durationMs = Math.max(1, hours) * 3600_000;

  return {
    startMs: endMs - durationMs,
    endMs,
  };
}

export function getPingNoDataGapThresholdMs(tasks: PingTaskInfo[]) {
  const intervals = tasks
    .map((task) => task.interval)
    .filter((interval): interval is number => typeof interval === "number" && interval > 0);
  const expectedIntervalMs = (intervals.length ? Math.min(...intervals) : DEFAULT_INTERVAL_MS) * 1000;

  return Math.max(DEFAULT_INTERVAL_MS, expectedIntervalMs * NO_DATA_GAP_MULTIPLIER);
}

function createNullPoint(timeMs: number, keys: string[]): PingChartPoint {
  const point: PingChartPoint = {
    time: new Date(timeMs).toISOString(),
    timeMs,
    isNoDataBoundary: true,
  };

  for (const key of keys) {
    point[key] = null;
  }

  return point;
}

function clampRegion(region: PingNoDataRegion, startMs: number, endMs: number) {
  return {
    startMs: Math.max(startMs, region.startMs),
    endMs: Math.min(endMs, region.endMs),
  };
}

export function preparePingChartTimeline(
  rows: PingChartPoint[],
  keys: string[],
  tasks: PingTaskInfo[],
  hours: number
) {
  const window = getPingChartWindow(hours);
  const gapThresholdMs = getPingNoDataGapThresholdMs(tasks);
  const normalizedRows = rows
    .map((row) => {
      const timeMs = finiteTimeMs(row.timeMs || row.time);
      if (timeMs === null) return null;
      return {
        ...row,
        timeMs,
        time: new Date(timeMs).toISOString(),
      };
    })
    .filter((row): row is PingChartPoint => {
      if (!row) return false;
      return row.timeMs >= window.startMs && row.timeMs <= window.endMs;
    })
    .sort((left, right) => left.timeMs - right.timeMs);

  if (!keys.length) {
    return {
      chartData: normalizedRows,
      noDataRegions: [] as PingNoDataRegion[],
      xDomain: [window.startMs, window.endMs] as [number, number],
    };
  }

  const noDataRegions: PingNoDataRegion[] = [];
  const realTimes = normalizedRows.map((row) => row.timeMs);

  if (realTimes.length === 0) {
    noDataRegions.push({ startMs: window.startMs, endMs: window.endMs });
  } else {
    const firstTime = realTimes[0];
    const lastTime = realTimes[realTimes.length - 1];

    if (firstTime - window.startMs > gapThresholdMs) {
      noDataRegions.push({ startMs: window.startMs, endMs: firstTime });
    }

    for (let index = 1; index < realTimes.length; index++) {
      const previousTime = realTimes[index - 1];
      const currentTime = realTimes[index];

      if (currentTime - previousTime > gapThresholdMs) {
        noDataRegions.push({ startMs: previousTime, endMs: currentTime });
      }
    }

    if (window.endMs - lastTime > gapThresholdMs) {
      noDataRegions.push({ startMs: lastTime, endMs: window.endMs });
    }
  }

  const boundaryPoints = noDataRegions
    .map((region) => clampRegion(region, window.startMs, window.endMs))
    .filter((region) => region.endMs > region.startMs)
    .map((region) => createNullPoint(region.startMs + (region.endMs - region.startMs) / 2, keys));

  return {
    chartData: [...normalizedRows, ...boundaryPoints].sort(
      (left, right) => left.timeMs - right.timeMs
    ),
    noDataRegions,
    xDomain: [window.startMs, window.endMs] as [number, number],
  };
}
