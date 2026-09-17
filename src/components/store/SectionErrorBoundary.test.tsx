import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SectionErrorBoundary } from "./SectionErrorBoundary";
import type { ReactNode } from "react";

function ThrowError({ message }: { message?: string }): ReactNode {
  throw new Error(message ?? "Test error");
}

describe("SectionErrorBoundary", () => {
  describe("Renders children normally", () => {
    it("displays child content when no error is thrown", () => {
      render(
        <SectionErrorBoundary sectionName="Test Section">
          <div data-testid="child-content">Hello from child</div>
        </SectionErrorBoundary>
      );

      expect(screen.getByTestId("child-content")).toBeTruthy();
      expect(screen.getByText("Hello from child")).toBeTruthy();
    });

    it("renders multiple children", () => {
      render(
        <SectionErrorBoundary sectionName="Test Section">
          <p>First child</p>
          <p>Second child</p>
        </SectionErrorBoundary>
      );

      expect(screen.getByText("First child")).toBeTruthy();
      expect(screen.getByText("Second child")).toBeTruthy();
    });
  });

  describe("Renders fallback UI when child throws", () => {
    it("displays fallback UI with section name when child throws", async () => {
      render(
        <SectionErrorBoundary sectionName="Daily Store">
          <ThrowError message="API Error" />
        </SectionErrorBoundary>
      );

      await waitFor(() => {
        expect(screen.getByText("Daily Store Unavailable")).toBeTruthy();
      });
    });

    it("displays retry button in fallback UI", async () => {
      render(
        <SectionErrorBoundary sectionName="Daily Store">
          <ThrowError />
        </SectionErrorBoundary>
      );

      await waitFor(() => {
        const buttons = document.querySelectorAll("button");
        const retryButton = Array.from(buttons).find(btn => btn.textContent?.includes("Retry"));
        expect(retryButton).toBeTruthy();
      });
    });
  });

  describe("Compact fallback (narrow header slot)", () => {
    it("isolates a wallet failure — sibling header content keeps rendering", async () => {
      const { container } = render(
        <div>
          <SectionErrorBoundary sectionName="Wallet" compact>
            <ThrowError message="401 from Riot" />
          </SectionErrorBoundary>
          <button>Logout</button>
        </div>
      );

      await waitFor(() => {
        expect(container.textContent).toContain("Wallet Unavailable");
      });
      expect(container.textContent).toContain("Logout");
    });

    it("fits the narrow slot — no full-width section card padding", async () => {
      const { container } = render(
        <SectionErrorBoundary sectionName="Wallet" compact>
          <ThrowError />
        </SectionErrorBoundary>
      );

      await waitFor(() => {
        expect(container.textContent).toContain("Wallet Unavailable");
      });

      const fallback = container.firstElementChild as HTMLElement;
      expect(fallback.className).not.toMatch(/py-12/);
      expect(fallback.className).not.toMatch(/px-6/);
      expect(fallback.className).toMatch(/h-10/);
    });
  });
});
