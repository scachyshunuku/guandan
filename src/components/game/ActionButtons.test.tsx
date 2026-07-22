import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActionButtons from "./ActionButtons";
import { PASS } from "@/lib/types";
import type { CardWithWild, CurrentTrick } from "@/lib/types";

const HAND: CardWithWild[] = [
  { suit: "CLUBS", rank: "8" },
  { suit: "DIAMONDS", rank: "9" },
];

describe("ActionButtons", () => {
  it("disables both buttons when it isn't the viewer's turn", () => {
    render(
      <ActionButtons
        hand={HAND}
        selectedCards={[HAND[0]]}
        currentTrick={[]}
        levelRank="2"
        isMyTurn={false}
        onPlay={jest.fn()}
        onPass={jest.fn()}
      />,
    );
    expect(screen.getByTestId("play-button")).toBeDisabled();
    expect(screen.getByTestId("pass-button")).toBeDisabled();
  });

  it("disables Play when no cards are selected", () => {
    render(
      <ActionButtons
        hand={HAND}
        selectedCards={[]}
        currentTrick={[]}
        levelRank="2"
        isMyTurn={true}
        onPlay={jest.fn()}
        onPass={jest.fn()}
      />,
    );
    expect(screen.getByTestId("play-button")).toBeDisabled();
  });

  it("disables Play when the selected cards don't form a valid combination", () => {
    render(
      <ActionButtons
        hand={HAND}
        selectedCards={HAND} // an 8 and a 9 - not a valid combo together
        currentTrick={[]}
        levelRank="2"
        isMyTurn={true}
        onPlay={jest.fn()}
        onPass={jest.fn()}
      />,
    );
    expect(screen.getByTestId("play-button")).toBeDisabled();
    expect(screen.getByTestId("play-invalid-reason")).toBeInTheDocument();
  });

  it("enables Play when the selected cards are a valid combo that beats the trick", () => {
    render(
      <ActionButtons
        hand={HAND}
        selectedCards={[HAND[0]]}
        currentTrick={[]}
        levelRank="2"
        isMyTurn={true}
        onPlay={jest.fn()}
        onPass={jest.fn()}
      />,
    );
    expect(screen.getByTestId("play-button")).toBeEnabled();
    expect(screen.queryByTestId("play-invalid-reason")).not.toBeInTheDocument();
  });

  it("disables Pass on an empty trick (the leader must play)", () => {
    render(
      <ActionButtons
        hand={HAND}
        selectedCards={[HAND[0]]}
        currentTrick={[]}
        levelRank="2"
        isMyTurn={true}
        onPlay={jest.fn()}
        onPass={jest.fn()}
      />,
    );
    expect(screen.getByTestId("pass-button")).toBeDisabled();
  });

  it("enables Pass once a trick has a play to respond to", () => {
    const currentTrick: CurrentTrick = [{ position: 0, play: [{ suit: "CLUBS", rank: "7" }] }];
    render(
      <ActionButtons
        hand={HAND}
        selectedCards={[]}
        currentTrick={currentTrick}
        levelRank="2"
        isMyTurn={true}
        onPlay={jest.fn()}
        onPass={jest.fn()}
      />,
    );
    expect(screen.getByTestId("pass-button")).toBeEnabled();
  });

  it("disables both buttons while a submission is in flight", () => {
    const currentTrick: CurrentTrick = [{ position: 0, play: [{ suit: "CLUBS", rank: "7" }] }];
    render(
      <ActionButtons
        hand={HAND}
        selectedCards={[HAND[1]]}
        currentTrick={currentTrick}
        levelRank="2"
        isMyTurn={true}
        onPlay={jest.fn()}
        onPass={jest.fn()}
        isSubmitting={true}
      />,
    );
    expect(screen.getByTestId("play-button")).toBeDisabled();
    expect(screen.getByTestId("pass-button")).toBeDisabled();
  });

  it("calls onPlay with the selected cards when clicked", async () => {
    const user = userEvent.setup();
    const onPlay = jest.fn();
    render(
      <ActionButtons
        hand={HAND}
        selectedCards={[HAND[0]]}
        currentTrick={[]}
        levelRank="2"
        isMyTurn={true}
        onPlay={onPlay}
        onPass={jest.fn()}
      />,
    );
    await user.click(screen.getByTestId("play-button"));
    expect(onPlay).toHaveBeenCalledWith([HAND[0]]);
  });

  it("calls onPass when clicked", async () => {
    const user = userEvent.setup();
    const onPass = jest.fn();
    const currentTrick: CurrentTrick = [{ position: 0, play: PASS }];
    render(
      <ActionButtons
        hand={HAND}
        selectedCards={[]}
        currentTrick={currentTrick}
        levelRank="2"
        isMyTurn={true}
        onPlay={jest.fn()}
        onPass={onPass}
      />,
    );
    await user.click(screen.getByTestId("pass-button"));
    expect(onPass).toHaveBeenCalled();
  });
});
