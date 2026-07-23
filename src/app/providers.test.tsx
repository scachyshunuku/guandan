import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import Providers from "./providers";

// Confirms Providers actually supplies a QueryClient to its subtree -
// useQuery throws ("No QueryClient set") if no QueryClientProvider ancestor
// exists, so a component that calls it standing in for useGame/useGameActions
// (Tasks 4.3/4.4) is a more faithful check than asserting on internals.
function Probe() {
  const query = useQuery({ queryKey: ["probe"], queryFn: () => Promise.resolve("ok") });
  return <span data-testid="probe-status">{query.status}</span>;
}

describe("Providers", () => {
  it("supplies a QueryClient to descendants", () => {
    render(
      <Providers>
        <Probe />
      </Providers>,
    );
    expect(screen.getByTestId("probe-status")).toHaveTextContent("pending");
  });
});
