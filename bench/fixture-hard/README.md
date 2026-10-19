# shiftboard

Shift scheduling for a small team: managers publish shifts, workers claim them,
payroll counts the hours per local day. Used by the cc-tiers benchmark.

- `src/index.js` is the public API. `reset()` puts the process back to a clean state.
- Shifts store `start` and `end` as epoch milliseconds plus an IANA `zone`; every
  calendar date is a local date in that zone.
- The store is async and copies values in and out, like a remote database.
  `configure({ storeLatencyMs })` makes every call wait.
- `handle({ method, path, headers, body })` serves the HTTP routes without a socket.

Run the tests with `npm test`. Node 18 or later, no dependencies.
