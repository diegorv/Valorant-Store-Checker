import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StoreError from "./error";

describe("StoreError", () => {
  // Silences the boundary's own "[Store Error Boundary]" log.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("invokes the retry callback the error boundary passes when Retry is clicked", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();

    render(<StoreError error={new Error("storefront returned 500")} retry={retry} />);

    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(retry).toHaveBeenCalledOnce();
  });
});
