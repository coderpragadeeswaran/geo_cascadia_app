# How questions are understood

The ask bar uses the pipeline's own **rule-based QueryEngine** (`pipeline/geo_cascadia/workspace.py`), unchanged, with
a thin layer in front of it (`backend/app/queryparse.py`). There is **no LLM**: the same question always gives the same
answer, nothing leaves the laptop, and every step can be shown.

1. **Synonyms** (table below) are replaced first, on the lower-cased question. A replaced phrase is not processed again.
2. **QueryEngine** reads the result with fixed patterns: what to show (buildings / dark stretches / poles or
   streetlights / review items), a street name of the area, use, floors (more than / at least / less than / exactly N),
   the register (no record / discrepancy), a difference type, "not in Google", "by street", and the gap interval.
3. **Understood vs ignored.** A meaningful word (floors, shops, register, lamp…) counts as understood only if its concept
   appears in the parsed filters; a number only if it became the floor count or the interval; any other word that is
   not filler or part of a matched street is **ignored** when removing it does not change the parse.
4. Nothing ignored → the answer is shown. Something ignored → **"partly understood"** (or "not understood"): the panel
   says what was understood and what was ignored, offers the closest supported questions, and applies nothing to the map
   until the person accepts it or edits the chips.
5. Every filter is an editable **chip**; **+ Filter** builds a question by clicking. Chip edits are turned into canonical
   text that QueryEngine must read back to exactly the same filters (else 422), so there is still one query engine.

## Patterns QueryEngine reads

| filter | example words |
|---|---|
| show: dark stretches | streetlight / street light / lamp + no, without, gap, dark, missing; "within 60 m" sets the interval |
| show: streetlights / poles | streetlight(s), lamp · pole(s) |
| show: review items | review, low confidence (+ "floor" → low-confidence floor count) |
| use | commercial, shop(s), business · residential, house(s), home(s) |
| floors | more than / over / above / at least / less than / under / exactly + number (digits or one–six) + (visible) floors |
| register | no (matching) (property) record, unmatched, not in the register, do not have a matching property record · discrepancy, mismatch, flagged |
| difference type | location shift, area understated, use change, extra floor |
| Google | not in Google, unlisted |
| chart | by street, per street |
| street | any analysed street name of the area (without "(approx.)") |

## Synonyms (backend/app/queryparse.py `SYNONYMS`)

| typed | read as |
|---|---|
| N+ floors | at least N floors |
| at most N floors | less than N+1 floors |
| taller / higher / bigger than N floors | more than N floors |
| fewer / lower / shorter / smaller than N floors; below N floors | less than N floors |
| N-storey (storied, floor, level) buildings / houses / shops | … with exactly N floors |
| with / having / of N (visible) floors (storeys, stories, levels) | with exactly N floors |
| storey(s), story, stories | floors |
| N level(s) | N floors |
| stores, retail, offices | commercial |
| residences, dwellings, flats, apartments | residential |
| not in (the) (property / tax) register | no record |
| missing from the register, missing (register / property) record | no record |
| no / without / lacking register record (entry) | no record |
| unregistered | no record |
| differ(s) / different from the register (records) | discrepancy |
| wrong / incorrect in the register | discrepancy |
| wrong location / wrong place / misplaced | location shift |
| bigger / larger than recorded | area understated |
| used differently, different use, use changed | use change |
| more floors than recorded | extra floor |
| street lamps, lamp posts, street lights | streetlights |
| dark stretches / streets / roads / spots, unlit (streets) | streetlight gaps |
| light(s) | streetlights |
| for each street, each street, street-wise | by street |
| uncertain, unsure, doubtful | low confidence |
| not on Google (Maps) | not in Google |

## Filler words (never "ignored")

Grammar and filler words are understood-neutral (`FILLER` in queryparse.py). Examples: show, me, display, the, that,
which, where, is, was, were, been, segments, sections, detected, found, visible, generate, create, bar, chart, please,
any, all. So the brief's "Show street segments where no streetlight was detected within 60 metres" runs directly.

## Words in any script

Words are tokenised in any script. A word the rules don't know, e.g. Tamil "கடைகள்", is listed under **Ignored** and the
question goes through the didn't-understand flow. It is never dropped silently. There are no Tamil synonyms yet.

## Street names (loose matching)

A street can be named loosely:
- case, spacing and punctuation don't matter;
- road ~ rd, street ~ st;
- the generic words (main, road, street, salai) are optional;
- a distinctive word may be a short or long form of the name's word, at least 4 letters:
  "sathy", "Sathy road", "Sathyamangalam road", "sathy main rd" → **Sathy Main Road**;
- a part after "/" or "," with 2+ words counts: "vinobaji st", "Gandhi nagar".

The Street chip shows the matched street, and a line says what was read ("read ‘sathy road’ as Sathy Main Road"). If the
words fit two streets equally ("ganapathy gardens"), nothing is guessed and the words are reported as ignored.

## The selected street

A typed question that names no street is answered on the street selected in the app. It gets a Street chip; remove it
(×) to ask about the whole area. A "by street" chart always covers every street.

## Dark stretches at other intervals

The pipeline stored only the 60 m gaps. For any other interval ("within 100 metres") the app computes them with the
pipeline's own method (`backend/app/gaps.py`, identical at 60 m) and labels them "computed by the app with the
pipeline's method". If they can't be computed (no camera plan), the answer says so; it is never shown as 0.

## Spec questions and variants (all run with nothing ignored)

- Show commercial buildings with more than two visible floors that do not have a matching property record
- Show all the commercial buildings that are more than 2 floors and have no record · Commercial buildings with more
  than 2 floors and no record
- Show street segments where no streetlight was detected within 60 metres · Show streets where no streetlight is
  detected within 60 m · Which streets have no streetlight within 60 metres? · Show me street segments without
  streetlights within 60 meters
- Display only low-confidence floor-count predictions and create a review queue · Low-confidence floor counts for review
- Generate a chart of unmatched buildings by street · Chart of unmatched buildings by street · Create a bar chart of the
  unmatched buildings by street

Tests: `backend/tests/test_query_ux.py` covers:
- every synonym above that changes a filter;
- the partly-understood and not-understood states;
- canonical chip text, which is always fully understood.

`backend/tests/test_review_fixes.py` covers:
- the spec questions and variants above, with zero ignored words;
- words in other scripts;
- loose street names and the ambiguous case;
- the selected-street scope;
- computed gap intervals.
