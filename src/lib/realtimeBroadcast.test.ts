jest.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    channel: jest.fn(() => ({ httpSend: jest.fn() })),
    removeChannel: jest.fn(),
  },
}));

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { broadcastToGame } from "./realtimeBroadcast";

const channel = supabaseAdmin.channel as jest.Mock;
const removeChannel = supabaseAdmin.removeChannel as jest.Mock;
let httpSend: jest.Mock;

describe("broadcastToGame", () => {
  beforeEach(() => {
    httpSend = jest.fn();
    channel.mockReset().mockImplementation(() => ({ httpSend }));
    removeChannel.mockReset();
  });

  it("sends the payload as a broadcast on the game's channel", async () => {
    httpSend.mockResolvedValue({ success: true });

    await broadcastToGame("game-1", "game_updated", { status: "in_progress" });

    expect(channel).toHaveBeenCalledWith("games:game-1");
    expect(httpSend).toHaveBeenCalledWith("game_updated", { status: "in_progress" });
  });

  it("removes the channel after sending, even on success", async () => {
    httpSend.mockResolvedValue({ success: true });

    await broadcastToGame("game-1", "game_updated", {});

    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("logs and does not throw when the send fails", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    httpSend.mockResolvedValue({ success: false, status: 500, error: "boom" });

    await expect(
      broadcastToGame("game-1", "game_updated", {}),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    expect(removeChannel).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
  });
});
