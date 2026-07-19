import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Card from "./Card";
import type { CardWithWild } from "@/lib/types";

describe("Card", () => {
  it("renders a standard rank and suit", () => {
    render(<Card card={{ suit: "SPADES", rank: "KING" }} />);
    expect(screen.getByTestId("card-image")).toHaveAttribute("src", "/cards/KS.svg");
  });

  it("uses the compact asset code for numeric ranks", () => {
    render(<Card card={{ suit: "DIAMONDS", rank: "10" }} />);
    expect(screen.getByTestId("card-image")).toHaveAttribute("src", "/cards/10D.svg");
  });

  it("colors hearts and diamonds red", () => {
    render(<Card card={{ suit: "HEARTS", rank: "ACE" }} />);
    expect(screen.getByTestId("card")).toHaveClass("text-red-600");
  });

  it("colors clubs and spades black", () => {
    render(<Card card={{ suit: "CLUBS", rank: "ACE" }} />);
    expect(screen.getByTestId("card")).not.toHaveClass("text-red-600");
  });

  it("renders the red joker SVG", () => {
    render(<Card card={{ rank: "RED_JOKER" }} />);
    const card = screen.getByTestId("card");
    expect(card).toHaveAttribute("aria-label", "red joker");
    expect(card).toHaveClass("text-red-600");
    expect(screen.getByTestId("card-image")).toHaveAttribute("src", "/cards/RJ.svg");
  });

  it("renders the black joker SVG", () => {
    render(<Card card={{ rank: "BLACK_JOKER" }} />);
    const card = screen.getByTestId("card");
    expect(card).toHaveAttribute("aria-label", "black joker");
    expect(card).not.toHaveClass("text-red-600");
    expect(screen.getByTestId("card-image")).toHaveAttribute("src", "/cards/BJ.svg");
  });

  it("shows a wild indicator when actsAs is present", () => {
    const wildCard: CardWithWild = {
      suit: "HEARTS",
      rank: "5",
      actsAs: { suit: "SPADES", rank: "QUEEN" },
    };
    render(<Card card={wildCard} />);
    expect(screen.getByTestId("wild-indicator")).toHaveTextContent("as Q♠");
  });

  it("omits the wild indicator when actsAs is absent", () => {
    render(<Card card={{ suit: "HEARTS", rank: "5" }} />);
    expect(screen.queryByTestId("wild-indicator")).not.toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<Card card={{ suit: "CLUBS", rank: "2" }} onClick={onClick} />);
    await user.click(screen.getByTestId("card"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("reflects selected state via aria-pressed", () => {
    render(<Card card={{ suit: "CLUBS", rank: "2" }} selected />);
    expect(screen.getByTestId("card")).toHaveAttribute("aria-pressed", "true");
  });

  it("is disabled when no onClick is provided", () => {
    render(<Card card={{ suit: "CLUBS", rank: "2" }} />);
    expect(screen.getByTestId("card")).toBeDisabled();
  });
});
