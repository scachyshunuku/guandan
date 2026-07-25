import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TributeChoiceModal from "./TributeChoiceModal";
import type { Card } from "@/lib/types";

const THIRD_CARD: Card = { suit: "CLUBS", rank: "9" };
const FOURTH_CARD: Card = { suit: "SPADES", rank: "9" };

describe("TributeChoiceModal", () => {
  it("shows both tied cards and lets 1st place choose", async () => {
    const user = userEvent.setup();
    const onChoose = jest.fn();
    render(
      <TributeChoiceModal
        thirdPosition={1}
        thirdCard={THIRD_CARD}
        fourthPosition={3}
        fourthCard={FOURTH_CARD}
        isFirstPlace={true}
        onChoose={onChoose}
      />,
    );
    expect(screen.getByTestId("tribute-choice-prompt")).toBeInTheDocument();
    const options = screen.getAllByTestId("tribute-choice-option");
    expect(options).toHaveLength(2);

    await user.click(within(options[0]).getByTestId("card"));
    expect(onChoose).toHaveBeenCalledWith(1);
  });

  it("calls onChoose with the fourth position when that option is picked", async () => {
    const user = userEvent.setup();
    const onChoose = jest.fn();
    render(
      <TributeChoiceModal
        thirdPosition={1}
        thirdCard={THIRD_CARD}
        fourthPosition={3}
        fourthCard={FOURTH_CARD}
        isFirstPlace={true}
        onChoose={onChoose}
      />,
    );
    const options = screen.getAllByTestId("tribute-choice-option");
    await user.click(within(options[1]).getByTestId("card"));
    expect(onChoose).toHaveBeenCalledWith(3);
  });

  it("shows a waiting message, not the choice buttons, for anyone but 1st place", () => {
    render(
      <TributeChoiceModal
        thirdPosition={1}
        thirdCard={THIRD_CARD}
        fourthPosition={3}
        fourthCard={FOURTH_CARD}
        isFirstPlace={false}
        onChoose={jest.fn()}
      />,
    );
    expect(screen.getByTestId("tribute-choice-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("tribute-choice-option")).not.toBeInTheDocument();
  });

  it("disables the choice buttons while a submission is in flight", () => {
    render(
      <TributeChoiceModal
        thirdPosition={1}
        thirdCard={THIRD_CARD}
        fourthPosition={3}
        fourthCard={FOURTH_CARD}
        isFirstPlace={true}
        onChoose={jest.fn()}
        isSubmitting={true}
      />,
    );
    for (const option of screen.getAllByTestId("tribute-choice-option")) {
      expect(within(option).getByTestId("card")).toBeDisabled();
    }
  });
});
