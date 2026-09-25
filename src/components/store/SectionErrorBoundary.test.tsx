import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SectionErrorBoundary } from "./SectionErrorBoundary";
import { Component, type ReactNode } from "react";

// The real `redirect` — the global next/navigation mock replaces it with a no-op.
const { redirect } = await vi.importActual<typeof import("next/navigation")>(
  "next/navigation"
);

function ThrowError({ message }: { message?: string }): ReactNode {
  throw new Error(message ?? "Test error");
}

/** Mounts a live app router so the boundary's retry has a segment to refresh. */
function withRouter(router: Partial<AppRouterInstance>, children: ReactNode): ReactNode {
  return (
    <AppRouterContext.Provider value={router as AppRouterInstance}>
      {children}
    </AppRouterContext.Provider>
  );
}

/** Stands in for the boundary Next mounts above ours to handle redirect/notFound. */
class OuterBoundary extends Component<
  { onCatch: (error: unknown) => void; children: ReactNode },
  { caught: boolean }
> {
  constructor(props: { onCatch: (error: unknown) => void; children: ReactNode }) {
    super(props);
    this.state = { caught: false };
  }

  static getDerivedStateFromError(): { caught: boolean } {
    return { caught: true };
  }

  componentDidCatch(error: Error): void {
    this.props.onCatch(error);
  }

  render(): ReactNode {
    return this.state.caught ? null : this.props.children;
  }
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

  describe("Retry recovers the section", () => {
    it("refreshes the segment so the section's data is re-fetched", async () => {
      const user = userEvent.setup();
      const refresh = vi.fn();

      const { container } = render(
        withRouter(
          { refresh },
          <SectionErrorBoundary sectionName="Daily Store">
            <ThrowError message="storefront 500" />
          </SectionErrorBoundary>
        )
      );

      const view = within(container);
      await view.findByText("Daily Store Unavailable");

      await user.click(view.getByRole("button", { name: /retry section/i }));

      expect(refresh).toHaveBeenCalledOnce();
    });

    it("recovers a section that fails once and succeeds on retry", async () => {
      const user = userEvent.setup();
      let failing = true;
      // Refreshing the segment is what yields fresh server data; model that by
      // letting the next render of the section succeed.
      const refresh = vi.fn(() => {
        failing = false;
      });

      function Bundle(): ReactNode {
        if (failing) throw new Error("bundle fetch failed");
        return <div>Bundle loaded</div>;
      }

      const { container } = render(
        withRouter(
          { refresh },
          <SectionErrorBoundary sectionName="Featured Bundle">
            <Bundle />
          </SectionErrorBoundary>
        )
      );

      const view = within(container);
      await view.findByText("Featured Bundle Unavailable");

      await user.click(view.getByRole("button", { name: /retry section/i }));

      expect(await view.findByText("Bundle loaded")).toBeTruthy();
    });

    it("compact fallback also refreshes the segment", async () => {
      const user = userEvent.setup();
      const refresh = vi.fn();

      const { container } = render(
        withRouter(
          { refresh },
          <SectionErrorBoundary sectionName="Wallet" compact>
            <ThrowError message="401 from Riot" />
          </SectionErrorBoundary>
        )
      );

      const view = within(container);
      await view.findByText("Wallet Unavailable");

      await user.click(view.getByRole("button", { name: /retry/i }));

      expect(refresh).toHaveBeenCalledOnce();
    });
  });

  describe("Router control-flow errors", () => {
    it("lets a redirect thrown by a child pass through to the boundary above", async () => {
      const onCatch = vi.fn();

      function RedirectingChild(): ReactNode {
        return redirect("/login");
      }

      const { container } = render(
        <OuterBoundary onCatch={onCatch}>
          <SectionErrorBoundary sectionName="Daily Store">
            <RedirectingChild />
          </SectionErrorBoundary>
        </OuterBoundary>
      );

      await waitFor(() => {
        expect(onCatch).toHaveBeenCalled();
      });

      const caught = onCatch.mock.calls[0]?.[0] as { digest?: string };
      expect(caught.digest).toContain("NEXT_REDIRECT");
      expect(container.textContent).not.toContain("Daily Store Unavailable");
    });
  });
});
