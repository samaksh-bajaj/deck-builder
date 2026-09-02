# fixtures/

**Only real, captured API responses belong in this directory.**

Never hand-write a file here to make a parser compile. A fabricated fixture that
looks plausible is worse than no fixture at all: the next person cannot tell it
from a real capture, and every parser built on it inherits the guess.

To add one, write a script under `scripts/` that calls the API through the shared
client and writes the raw response body here verbatim. Redact player tags and
names if the response contains them, but do not otherwise reshape the JSON.

This directory is intentionally empty as of the scaffold PR — we had no API token
and therefore no real responses to capture.
