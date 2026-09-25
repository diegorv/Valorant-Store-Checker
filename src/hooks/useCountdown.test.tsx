import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { useCountdown } from "./useCountdown";
import { BundleCountdownTimer } from "@/components/store/bundle/BundleCountdownTimer";

const NOW = new Date("2026-01-01T00:00:00.000Z").getTime();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const EXPIRES_AT = new Date(NOW + 5 * HOUR + 30 * MINUTE + 15 * SECOND).toISOString();

function Probe({ expiresAt }: { expiresAt: string }) {
  const t = useCountdown(expiresAt);
  return <span aria-label={t.formatted}>{`${t.hours}:${t.minutes}:${t.seconds}`}</span>;
}

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("server-rendered markup does not depend on the time of the render", () => {
    it("renders the same HTML at two different moments", () => {
      const first = renderToString(<Probe expiresAt={EXPIRES_AT} />);
      vi.setSystemTime(NOW + 7 * SECOND);
      const second = renderToString(<Probe expiresAt={EXPIRES_AT} />);

      expect(second).toBe(first);
    });
  });

  describe("the clock starts after mount", () => {
    it("shows the real remaining time once mounted, then ticks every second", () => {
      const { result } = renderHook(() => useCountdown(EXPIRES_AT));

      expect(result.current).toMatchObject({ hours: 5, minutes: 30, seconds: 15, isExpired: false });

      act(() => {
        vi.advanceTimersByTime(SECOND);
      });

      expect(result.current).toMatchObject({ hours: 5, minutes: 30, seconds: 14 });
    });

    it("flips isExpired when the deadline passes", () => {
      const expiresAt = new Date(NOW + 2 * SECOND).toISOString();
      const { result } = renderHook(() => useCountdown(expiresAt));
      expect(result.current.isExpired).toBe(false);

      act(() => {
        vi.advanceTimersByTime(2 * SECOND);
      });

      expect(result.current).toMatchObject({ isExpired: true, formatted: "Expired" });
    });
  });

  describe("formatting", () => {
    it.each([
      [2 * DAY + 3 * HOUR + 4 * MINUTE + 5 * SECOND, "2d 3h 4m remaining"],
      [3 * HOUR + 4 * MINUTE + 5 * SECOND, "3h 4m 5s remaining"],
      [4 * MINUTE + 5 * SECOND, "4m 5s remaining"],
    ])("formats %i ms left as %s", (msLeft, expected) => {
      const expiresAt = new Date(NOW + msLeft).toISOString();
      const { result } = renderHook(() => useCountdown(expiresAt));
      expect(result.current.formatted).toBe(expected);
    });
  });

  describe("hydration", () => {
    it("hydrates a countdown rendered seconds earlier on the server without a mismatch", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const recoverable = vi.fn();

      const container = document.createElement("div");
      container.innerHTML = renderToString(<BundleCountdownTimer expiresAt={EXPIRES_AT} />);
      document.body.appendChild(container);

      vi.setSystemTime(NOW + 7 * SECOND);
      const root = await act(async () =>
        hydrateRoot(container, <BundleCountdownTimer expiresAt={EXPIRES_AT} />, {
          onRecoverableError: recoverable,
        }),
      );

      try {
        expect(recoverable).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        expect(container.querySelector('[role="timer"]')?.getAttribute("aria-label")).toBe("05:30:08 remaining");
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });
  });
});
