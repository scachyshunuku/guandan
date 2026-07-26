import { render, screen } from "@testing-library/react";
import ConnectionStatus from "./ConnectionStatus";

describe("ConnectionStatus", () => {
  it("renders nothing while connecting", () => {
    render(<ConnectionStatus status="connecting" />);
    expect(screen.queryByTestId("connection-status-banner")).not.toBeInTheDocument();
  });

  it("renders nothing while connected", () => {
    render(<ConnectionStatus status="connected" />);
    expect(screen.queryByTestId("connection-status-banner")).not.toBeInTheDocument();
  });

  it("shows a reconnecting banner", () => {
    render(<ConnectionStatus status="reconnecting" />);
    expect(screen.getByTestId("connection-status-banner")).toHaveTextContent("Reconnecting");
  });

  it("shows a disconnected banner", () => {
    render(<ConnectionStatus status="disconnected" />);
    expect(screen.getByTestId("connection-status-banner")).toHaveTextContent("Connection lost");
  });
});
