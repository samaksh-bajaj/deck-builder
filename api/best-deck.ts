// STUB — replaced in the best-deck PR.
//
// This handler exists only to prove that a plain Vite project on Vercel serves a
// top-level /api function with zero configuration. It deliberately does NOT call
// the Supercell API and does NOT read process.env.CR_API_TOKEN.
import decksFile from "../public/decks.json" with { type: "json" };
import type { BestDeckResponse, DeckSource } from "../shared/types";

export default {
  fetch(request: Request): Response {
    const source = decksFile.source as DeckSource;

    if (source === "placeholder") {
      console.warn(
        "public/decks.json is a hand-written placeholder, not crawler output. " +
          "Any recommendation derived from it is not real meta data.",
      );
    }

    const body: BestDeckResponse = {
      status: "stub",
      message: "Not implemented yet. This endpoint verifies deployment wiring only.",
      tag: new URL(request.url).searchParams.get("tag"),
      deckSource: source,
    };

    return Response.json(body);
  },
};
