"""Plain-English questions → the pipeline's rule-based QueryEngine (design pass B §7; docs/QUERY.md). No LLM.

1. Cheap synonyms are applied before parsing (storeys → floors, shops → commercial, not in register → no record, …).
   Each rule is listed in SYNONYMS and in docs/QUERY.md.
2. What the engine understood and what it ignored is worked out against QueryEngine itself:
   - a meaningful word (floors, shops, register, lamp, …) counts as understood only if its concept shows up in the
     parsed filters (so "buildings with 2 floors" without an operator is not silently answered for all buildings);
   - a number counts only if it became the floor count or the gap interval;
   - any other word that is not filler and not part of a matched street name is "ignored" when removing it does not
     change the parse (ablation), i.e. it had no effect.
3. When something was ignored the status is "partial" (something was understood) or "not_understood", and the closest
   supported phrasings are suggested. The UI applies nothing until the person accepts or edits (never a silent guess).
4. Grammar and filler words (segments, was, were, detected, generate, …) are understood-neutral: they never make a
   question "partial" (review fix 1). Words in any script are tokenised; an unknown word (e.g. Tamil) is reported as
   ignored, never dropped silently (fix 7). No Tamil synonyms yet.
5. Street names are matched loosely (fix 8): case / spacing / punctuation, road ~ rd, street ~ st, the generic words
   (main, road, street, salai) optional, and a short or long form of a distinctive word (sathy ~ sathyamangalam). The
   matched span is rewritten to the full street name so QueryEngine reads it; the match is reported ("sathy road" →
   Sathy Main Road). Two streets matching equally well → no guess (the words stay "ignored").
"""
import re

NUMS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
N = r"(\d+|one|two|three|four|five|six)"
FL = r"(?:floors?|storeys?|stories|story|levels?)"


def _num(s):
    return int(s) if s.isdigit() else NUMS[s]


def plural(n, one, many=None):
    """"1 floor", "2 floors" (review fix 14; the web app has the same helper in lib/utils.ts)"""
    k = _num(str(n)) if str(n).isdigit() or str(n) in NUMS else n
    return f"{n} {one if k == 1 else (many or one + 's')}"


def _fl(n):
    return plural(n, "floor")


# (pattern, replacement) — applied in order on the lower-cased text; a replaced span is not re-processed.
SYNONYMS = [
    # floors
    (rf"\b{N}\s*\+\s*{FL}", lambda m: f"at least {_fl(m.group(1))}"),
    (rf"\bat most {N} {FL}", lambda m: f"less than {_fl(_num(m.group(1)) + 1)}"),
    (rf"\b(?:taller|higher|bigger) than {N} {FL}", lambda m: f"more than {_fl(m.group(1))}"),
    (rf"\b(?:fewer|lower|shorter|smaller) than {N} {FL}", lambda m: f"less than {_fl(m.group(1))}"),
    (rf"\bbelow {N} {FL}", lambda m: f"less than {_fl(m.group(1))}"),
    (rf"\b{N}[\s-]*(?:storey|story|storied|floor|level)(?:ed)?\s+(buildings?|houses?|homes?|shops?)", lambda m: f"{m.group(2)} with exactly {_fl(m.group(1))}"),
    (rf"\b(?:with|having|of) {N} (?:visible )?{FL}", lambda m: f"with exactly {_fl(m.group(1))}"),
    (r"\b(?:storeys|storey|stories|story)\b", "floors"),
    (rf"\b{N} levels?\b", lambda m: _fl(m.group(1))),
    # use
    (r"\b(?:stores?|retail|offices?)\b", "commercial"),
    (r"\b(?:residences?|dwellings?|flats?|apartments?)\b", "residential"),
    # register
    (r"\b(?:not|isn'?t|aren'?t) in (?:the )?(?:property |tax )?regist(?:er|ry)\b", "no record"),
    (r"\bmissing (?:from (?:the )?regist(?:er|ry)|(?:register |property )?records?)\b", "no record"),
    (r"\b(?:no|without(?: a)?|lacking(?: a)?) (?:regist(?:er|ry)) (?:records?|entry|entries)\b", "no record"),
    (r"\bunregistered\b", "no record"),
    (r"\b(?:differs?|different|differing) from (?:the )?(?:regist(?:er|ry)|records?)\b", "discrepancy"),
    (r"\b(?:wrong|incorrect) in (?:the )?regist(?:er|ry)\b", "discrepancy"),
    # discrepancy types (QueryEngine reads "location shift", "area understated", "use change", "extra floor")
    (r"\b(?:wrong (?:location|place)|misplaced|pinned in the wrong place)\b", "location shift"),
    (r"\b(?:bigger|larger) than recorded\b", "area understated"),
    (r"\b(?:used differently|different use|use changed)\b", "use change"),
    (r"\bmore floors than recorded\b", "extra floor"),
    # streetlights
    (r"\bstreet ?lamps?\b|\blamp ?posts?\b|\bstreet lights?\b", "streetlights"),
    (r"\bdark (?:stretch(?:es)?|streets?|roads?|spots?|patches|areas?|sections?)\b|\bunlit(?: streets?| roads?)?\b", "streetlight gaps"),
    (r"(?<!street)\blights?\b", "streetlights"),
    # grouping, review, google
    (r"\b(?:for each street|each street|street-?wise)\b", "by street"),
    (r"\b(?:uncertain|unsure|doubtful)\b", "low confidence"),
    (r"\bnot on google(?: maps)?\b", "not in google"),
]

FILLER = set("""show me display find get give all only the a an of in on at for to with and or that which where what who whose are is
be there do does did not have has having any please building buildings street streets road roads create queue predictions prediction
count counts chart charts graph plot map highlight how many much number numbers detected detection visible matching property within m metre
metres meter meters every interval by per each more than over above least less under exactly those these them their i want see can you from
my our area ward city here now also just like near nearby around total tell about whether if as it its this we us they sign signs name names
items item queue s
segments segment sections section stretches stretch parts portions lengths places spots locations
was were been being will would should could had got detect detects found seen spotted observed identified
generate generated make draw produce bar pie column diagram histogram visualise visualize visualisation
please kindly provide return listing results result ones some currently still along between across inside
properties then so when why whose""".split())
# command words are filler only at the start of a question ("list all…"); elsewhere ("tax list") they are content
START = {"list", "lists", "show", "display", "find", "give", "get", "plot", "map", "highlight"}
PLACE = re.compile(r"^\s+(?:main road|road|street|st|nagar|colony|salai|layout)\b")

# a meaningful word counts as understood only when its concept is in the parsed filters
CONCEPTS = [
    (re.compile(r"^(?:floors?|floor-count|floor-counts)$"), lambda f: "floors_op" in f or f.get("reason_has") == "floor count low confidence"),
    (re.compile(r"^(?:commercial|shops?|business(?:es)?)$"), lambda f: f.get("use") == "commercial"),
    (re.compile(r"^(?:residential|houses?|homes?)$"), lambda f: f.get("use") == "residential"),
    (re.compile(r"^(?:records?|regist(?:er|ered|ry|ers)?|unmatched)$"), lambda f: f.get("match_status") in ("no_record", "discrepancy")),
    (re.compile(r"^(?:discrepanc(?:y|ies)|mismatch(?:es|ed)?|flagged)$"), lambda f: f.get("match_status") == "discrepancy" or bool(f.get("discrepancy"))),
    (re.compile(r"^(?:streetlights?|lamps?)$"), lambda f: f["intent"] == "streetlight_gaps" or f.get("asset_type") == "streetlight"),
    (re.compile(r"^poles?$"), lambda f: f.get("asset_type") == "pole"),
    (re.compile(r"^(?:gaps?|dark|without|missing|no)$"), lambda f: True),                 # glue words of known patterns
    (re.compile(r"^(?:review|confidence|low-confidence|low)$"), lambda f: f["intent"] == "review"),
    (re.compile(r"^(?:google|unlisted)$"), lambda f: bool(f.get("ref_flag"))),
    (re.compile(r"^(?:location|shift|understated|change|extra|use)$"), lambda f: bool(f.get("discrepancy")) or bool(f.get("use"))),
]
NUMBER = re.compile(r"^(?:\d+|one|two|three|four|five|six)$")
# ASCII words as before, plus any run of non-ASCII letters (Tamil, …) so an unknown script is reported, not dropped
WORD = re.compile(r"[a-z0-9][a-z0-9'+-]*|[^\x00-\x7f\s\u2000-\u206f\u3000-\u303f\uff01-\uff0f]+")

# ---------------------------------------------------------------- loose street names (review fix 8)
GENERIC = {"road", "street", "main", "salai", "lane", "avenue", "cross"}
_ABBR = {"rd": "road", "st": "street", "str": "street", "ave": "avenue", "ln": "lane"}
_TOK = re.compile(r"[a-z0-9]+")


def _canon(t):
    return _ABBR.get(t, t)


def _same(t, c):
    """a typed token matches a street-name token: equal, or one is a prefix of the other (both ≥ 4 letters:
    sathy ~ sathyamangalam, korathot ~ korathottam)."""
    return t == c or (len(t) >= 4 and len(c) >= 4 and (t.startswith(c) or c.startswith(t)))


def _forms(street):
    """(core tokens) per way of naming a street: the full name and each '/' part; comma parts too when they have 2+
    distinctive words ("Gandhi Nagar"). Core = tokens without the generic road words."""
    base = re.sub(r"\s*\(approx\.\)", "", street).lower()
    core = lambda form: [_canon(t) for t in _TOK.findall(form) if _canon(t) not in GENERIC]
    slash = base.split("/") if "/" in base else []
    comma = [p for part in (slash or [base]) for p in part.split(",")[1:]]
    out = [core(f) for f in [base] + slash] + [c for c in map(core, comma) if len(c) >= 2]
    return [c for c in out if c]


def match_street(norm, streets):
    """→ (start, end, street) of the loosest-but-unambiguous street reference in `norm`, or None."""
    toks = [(_canon(m.group(0)), m.start(), m.end()) for m in _TOK.finditer(norm)]
    best, tie = None, False
    for st in streets:
        for core in _forms(st):
            for i in range(len(toks)):
                k, j = 0, i
                while j < len(toks) and k < len(core):
                    t = toks[j][0]
                    if _same(t, core[k]):
                        k += 1
                    elif not (k > 0 and t in GENERIC):
                        break
                    j += 1
                if k < len(core):
                    continue
                while j < len(toks) and toks[j][0] in GENERIC:            # trailing "main road", "rd", "st"
                    j += 1
                span = (toks[i][1], toks[j - 1][2], st, j - i, core)
                if best is None or span[3] > best[3]:
                    best, tie = span, False
                elif span[3] == best[3] and span[2] != best[2] and span[:2] == best[:2]:
                    tie = True
    if not best or tie:
        return None
    # the words typed also name part of another street ("ganapathy gardens": 2nd Street, Ganapathy Gardens and Sri
    # Ganapathy Gardens 3rd Street) → ambiguous, no guess
    typed = [t for t, a, b in toks if best[0] <= a and b <= best[1] and t not in GENERIC]
    for st in streets:
        if st == best[2]:
            continue
        for core in _forms(st):
            if any(all(_same(typed[k], core[i + k]) for k in range(len(typed))) for i in range(len(core) - len(typed) + 1)):
                return None
    return best[:3]


def normalize(text):
    """→ (normalized lower-case text, [{from, to}] synonyms applied). Replaced spans are not re-processed."""
    segs = [(text.lower(), False)]
    applied = []
    for pat, rep in SYNONYMS:
        out = []
        for t, done in segs:
            if done:
                out.append((t, True))
                continue
            pos = 0
            for m in re.finditer(pat, t):
                new = rep(m) if callable(rep) else rep
                out.append((t[pos:m.start()], False))
                out.append((new, True))
                if m.group(0).strip() != new:
                    applied.append({"from": m.group(0).strip(), "to": new})
                pos = m.end()
            out.append((t[pos:], False))
        segs = [s for s in out if s[0]]
    return re.sub(r"\s+", " ", "".join(t for t, _ in segs)).strip(), applied


def _parse(qe, text):
    return {k: v for k, v in qe.parse(text).items() if k != "why_empty"}


def meaning(f):
    """Plain words for each parsed filter (the "Understood:" line)."""
    it = f["intent"]
    out = []
    if it == "streetlight_gaps":
        out.append(f"dark stretches (no streetlight within {f.get('interval_m', 60)} m)")
    elif it == "assets":
        out.append("streetlights" if f.get("asset_type") == "streetlight" else "poles")
    elif it == "review":
        out.append("review items" + (", low-confidence floor count" if f.get("reason_has") else ""))
    else:
        out.append({"commercial": "shops & businesses", "residential": "homes"}.get(f.get("use"), "buildings"))
        if f.get("floors_op"):
            out.append(f"{ {'>': 'more than', '>=': 'at least', '<': 'less than', '==': 'exactly'}[f['floors_op']]} {_fl(f['floors_n'])}")
        if f.get("match_status"):
            out.append("not in the register" if f["match_status"] == "no_record" else "differ from the register")
        if f.get("discrepancy"):
            out.append(f["discrepancy"].replace("_", " "))
        if f.get("ref_flag"):
            out.append("sign not on Google")
        if f.get("group_by"):
            out.append("by street")
    if f.get("street"):
        out.append(f"on {f['street']}")
    return out


def understand(qe, text, compose=None):
    """→ (text for QueryEngine, understanding dict)."""
    norm, synonyms = normalize(text)
    parsed = _parse(qe, norm)
    if not parsed.get("street"):
        hit = match_street(norm, qe.streets)
        if hit:
            a, b, st = hit
            full = re.sub(r"\s*\(approx\.\)", "", st)
            typed = norm[a:b]
            norm = re.sub(r"\s+", " ", norm[:a] + full.lower() + norm[b:]).strip()
            parsed = _parse(qe, norm)
            if parsed.get("street") == st and typed != full.lower():
                synonyms.append({"from": typed, "to": st, "street": True})
    street = parsed.get("street")
    street_words = set(WORD.findall(re.sub(r"\s*\(approx\.\)", "", street.lower()))) if street else set()
    words = [(m.group(0), m.start(), m.end()) for m in WORD.finditer(norm)]
    ignored = []
    for i, (w, a, b) in enumerate(words):
        wl = w.strip("'")
        if (wl in START and i < 2) or wl in FILLER or wl in street_words:
            continue
        concept = next((ok for pat, ok in CONCEPTS if pat.match(wl)), None)
        if concept is not None:
            if not concept(parsed):
                ignored.append((w, a, b))
            continue
        if NUMBER.match(wl):
            n = _num(wl)
            if parsed.get("floors_n") != n and parsed.get("interval_m") != n:
                ignored.append((w, a, b))
            continue
        # any other word: ignored when removing it does not change the parse
        if _parse(qe, (norm[:a] + " " + norm[b:]).strip()) == parsed:
            ignored.append((w, a, b))
    # join neighbouring ignored words into phrases ("tax list")
    phrases, cur, last_end = [], [], -10
    for w, a, b in ignored:
        gap = norm[last_end:a]
        if cur and re.fullmatch(r"[\s,./-]*(?:(?:of|the|a|and|in|on)\s+)*", gap or ""):
            cur.append(norm[last_end:b])
        else:
            if cur:
                phrases.append("".join(cur).strip())
            cur = [w]
        last_end = b
    if cur:
        phrases.append("".join(cur).strip())
    # an unknown street name: keep its "Road" / "Street" with it ("mg road", not "mg")
    phrases = [p + m.group(0) if (m := PLACE.match(norm[norm.find(p) + len(p):])) else p for p in phrases]
    phrases = [re.sub(r"\s+", " ", p).strip() for p in phrases]
    means = meaning(parsed)
    specific = len(parsed) > 1 or parsed["intent"] != "buildings"
    status = "ok" if not phrases else ("partial" if specific else "not_understood")
    und = {"status": status, "understood": [{"phrase": "", "meaning": m} for m in means] if specific or not phrases else [],
           "ignored": phrases, "synonyms": synonyms, "suggestions": [], "read_as": norm}
    if status != "ok":
        und["suggestions"] = suggestions(parsed, norm, compose, specific)
    return norm, und


TEMPLATES = [
    ({"intent": "buildings", "use": "commercial", "floors_op": ">", "floors_n": 2, "match_status": "no_record"}, {"commercial", "floors", "record"}),
    ({"intent": "buildings", "match_status": "no_record"}, {"record", "register"}),
    ({"intent": "buildings", "match_status": "discrepancy"}, {"register", "discrepancy"}),
    ({"intent": "buildings", "match_status": "no_record", "group_by": "street"}, {"record", "street", "chart"}),
    ({"intent": "buildings", "use": "commercial", "floors_op": "==", "floors_n": 2}, {"commercial", "floors"}),
    ({"intent": "buildings", "use": "residential", "floors_op": ">", "floors_n": 1}, {"residential", "floors"}),
    ({"intent": "streetlight_gaps", "interval_m": 60}, {"streetlights", "dark", "gap", "lamp", "light"}),
    ({"intent": "assets", "asset_type": "pole"}, {"pole"}),
    ({"intent": "review", "reason_has": "floor count low confidence"}, {"review", "confidence", "floors"}),
    ({"intent": "buildings", "ref_flag": "sign_not_in_google_within_40m"}, {"google", "sign", "name"}),
]


def suggestions(parsed, norm, compose, specific, k=3):
    """The closest questions QueryEngine answers exactly: what was understood (as canonical text), then templates by
    word overlap with the question."""
    if compose is None:
        return []
    out = []
    if specific:
        out.append(compose(parsed))
    words = set(WORD.findall(norm))
    stems = {w.rstrip("s") for w in words}
    scored = []
    for f, keys in TEMPLATES:
        f2 = {**f, **({"street": parsed["street"]} if parsed.get("street") else {})}
        score = len({x.rstrip("s") for x in keys} & stems) + sum(1 for key, v in parsed.items() if f2.get(key) == v and key != "intent") * 2
        scored.append((score, compose(f2)))
    for s, q in sorted(scored, key=lambda x: -x[0]):
        if q not in out and s > 0:
            out.append(q)
        if len(out) >= k:
            break
    if not out:                                                   # nothing in common: the most asked questions
        out = [compose(f) for f, _ in TEMPLATES[:k]]
    return out[:k]
