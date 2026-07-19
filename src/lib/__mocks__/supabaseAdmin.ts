// Manual Jest mock, picked up automatically by `jest.mock("@/lib/supabaseAdmin")`
// (no factory needed — see https://jestjs.io/docs/manual-mocks). Backed by
// the in-memory fake in src/testUtils/fakeSupabase.ts.
import { createFakeSupabase } from "@/testUtils/fakeSupabase";

export const supabaseAdmin = createFakeSupabase();
