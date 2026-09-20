import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Footer } from "./Footer";
import { GITHUB_REPO_URL } from "@/lib/constants";

afterEach(() => {
  cleanup();
});

describe("Footer", () => {
  it("links to the GitHub repository in a new tab", () => {
    render(<Footer />);

    const link = screen.getByRole("link", { name: /source on github/i });
    expect(link.getAttribute("href")).toBe(GITHUB_REPO_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("carries the Riot disclaimer", () => {
    render(<Footer />);

    expect(screen.getByText(/not affiliated with riot games/i)).toBeTruthy();
  });
});
