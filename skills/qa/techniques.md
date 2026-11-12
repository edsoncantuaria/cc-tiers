# Techniques for designing cases

Pick the technique that fits the risk from step 2 of the flow. One case per item it yields.

## Black box (ISTQB CTFL 4.0, ch. 4.2)

- **Equivalence partitioning.** Split each input, output, setting or time into classes the code treats alike, valid and invalid, without overlap. One case per class, invalid ones included. With several parameters, each class of each parameter appears at least once (each-choice coverage); that does not cover combinations of classes, so add them where the risk is in the interaction.
- **Boundary values** (ordered classes only). The boundary is the minimum and maximum of each class. 2-value: the boundary and its neighbour in the next class (`x <= 10`: 10 and 11). 3-value: the boundary and both neighbours (9, 10, 11), which catches `x <= 10` written as `x == 10`. Our own advice, not the syllabus's: use 3-value where the error is costly.
- **Decision table.** For a rule that combines conditions: conditions in rows, rules in columns (T, F, `-` irrelevant), the expected action per column. Drop infeasible columns, merge those a condition does not change. A column with no defined action is a gap in the requirement: ask.
- **State transition.** For states and events (`event [guard] / action`): build the state x event table; an empty cell is an unhandled transition. Coverage, weakest to strongest: all states, valid transitions (the usual), all transitions including the invalid ones (for what is critical). One invalid transition per case, so one defect does not mask another.

## White box and experience (ISTQB CTFL 4.0, ch. 4.3-4.4)

- 100% statement coverage only guarantees every line ran. 100% branch coverage (each `if` true and false, each `case`, entering and leaving a loop) implies 100% statement, not the reverse. Statement coverage misses data-dependent defects (division by zero), branch coverage those that need a specific path. Neither finds a requirement that was never implemented.
- **Error guessing.** List the likely failures by category (input, output, logic, calculation, interface, data) and write one case per item.
- **Fault attack.** The deliberate form: build the list from defect data and the area's fix history (`git log` of the corrections there), and design a case for each fault on it.

## Variables (Explore It!, Hendrickson, ch. 4)

Exploring is varying what the code did not expect. Look for what can be counted, positioned, formatted, sized, nested and timed (time, frequency, duration), locale (time zone, language, date and number format), hidden configuration (flag, env, profile), and variables you only control indirectly (how many times the setup ran, how many files instead of how many bytes). In a state machine, vary the previous state, the path to it, how many times it was passed, and the time spent in it.

## Heuristics (Explore It!, appendix A2)

| Heuristic | What to vary or watch |
|---|---|
| Zero, One, Many | item, child or result counts: wrong plural, division by zero, off-by-one, growing slowness |
| Beginning, Middle, End | position: insert, delete or paste at the start, the middle, the end |
| Goldilocks | too big, too small, just right: raw stack trace, truncation, silent save failure |
| Some, None, All | subset of permissions, flags, tags: "none" handled as "all" |
| Too Few, Too Many | fewer items than expected; sessions, connections, requests past the limit |
| CRUD (ch. 7) | create, read, update, delete each entity, with 0, 1 and N dependents |
| Follow the Data | the data stays intact at each stage: import, search, display, report, export, log, other system |
| Violate Data Format Rules | broken domain rule (negative age, 31 February, IP 999.999.999.999); null, wrong type, unicode, injection (SQL, HTML, shell); empty, truncated or corrupt file |
| Interrupt | kill the process, drop the network, expire the session, cancel midway; then: back to normal? data lost or corrupted? |
| Reverse | reverse order, undo everything, go to the end and back |
| Starve | lack of CPU, memory, disk, bandwidth |
| All the Ways (ch. 8) | the same operation through every path that does it (one by one against batch or import) |
| Back, Forward, History; Bookmark It | resend the same request (replay, duplicate POST); enter directly at a middle step of a flow |
| Zoom, Abstract, Change the Model | break an event into substeps, summarise it, or swap the diagram for a table to see what is missing |

## What If? (Explore It!, ch. 9)

For each connection and file in the ecosystem: missing, empty, corrupt, huge, read-only, no permission, locked, slow. Database, file and network are trust boundaries even when "internal": data coming from them may break the rules (null, empty, huge, accented, malicious).

## Oracles, when there is no exact expected result (Explore It!, ch. 5)

- **Never and Always**: the invariants from step 1.
- **Internal Consistency**: similar parts of the system behave alike.
- **Standards** and **Comparables**: a norm, a specification, the previous version, another system.
- **Evaluate Against a Range** and **Evaluate Characteristics**: a plausible value, a trend, a property that holds across many runs.
- **Invert the Result**: undo the result and compare with the input (encode then decode).

## Non-functional (Agile Testing, Crispin and Gregory, quadrant 4)

Quadrant 4 covers performance, robustness and security. Ask for the goal before testing (how many users or messages at once, acceptable response time, what happens when a dependency fails or is slow, hostile input, access to another user's object). With no goal, report a coverage gap. Say when the environment does not mirror production.

## Signs of a misleading suite (our own checklist, not from the books)

- It does not fail when you break the code on purpose.
- It repeats the implementation's logic to compute the expected value.
- It passes in one order only, shares data between tests, or depends on the clock or the network.
- A mock that does not follow the real partner; a test database without production's constraints.
- A weak assertion: only "did not throw", only status 200, a snapshot accepted unread.
