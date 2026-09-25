import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GlobalError from "./global-error";

describe("GlobalError", () => {
  // Silences two expected messages: the boundary's own "[Global Error Boundary]"
  // log, and React's html-in-a-div nesting warning (this component renders its
  // own <html>/<body>, which cannot be a legal child of a test container).
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("invokes the retry callback the error boundary passes when Try Again is clicked", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();

    render(<GlobalError error={new Error("root layout is down")} retry={retry} />);

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(retry).toHaveBeenCalledOnce();
  });
});
