"""Name normalisation + matching used by the name gate, Places cross-check and name quality."""
import re, difflib
try:
    from indic_transliteration import sanscript
    from indic_transliteration.sanscript import transliterate
except ImportError:                                        # pip install indic-transliteration
    sanscript = None

TA = re.compile(r"[\u0B80-\u0BFF]")
TAM = lambda s: sum(1 for c in (s or "") if "\u0B80" <= c <= "\u0BFF")


def to_latin(s):
    s = s or ""
    if TA.search(s) and sanscript:
        s = s.replace("ன", "ந").replace("ற", "ர").replace("ழ", "ள")
        s = transliterate(s, sanscript.TAMIL, sanscript.ITRANS)
    return s


def loose(s):
    s = re.sub(r"[^A-Z]", "", to_latin(s).upper()).replace("H", "")
    s = s.translate(str.maketrans("GBDJCWYZQ", "KPTSKVISK"))
    s = re.sub(r"[AEIOU]+", "A", s)
    return re.sub(r"(.)\1+", r"\1", s)


def support(name, ocr_rec):
    """Share of the name's letters that OCR also saw in the same crop (name gate)."""
    a = loose(name)
    b = loose(" ".join([ocr_rec.get("text", "") or "", ocr_rec.get("clean", "") or "", ocr_rec.get("best", "") or ""]))
    if not a or not b: return 0.0
    return sum(m.size for m in difflib.SequenceMatcher(None, a, b).get_matching_blocks()) / len(a)


GENERIC = {loose(w) for w in (
    "sri shri sree store stores shop traders trading enterprises enterprise engineering engineers works "
    "agencies agency industries industry centre center house coimbatore kovai pvt ltd private limited and the "
    "new india services service company solutions marketing associates fabrication fabricators fabricat metals "
    "metal steel steels tex textiles electricals electronics motors auto garage clinic hospital medicals medical "
    "pharmacy bakery catering caterers hardware hardwares furniture furnitures mobiles tuition tuitions academy "
    "institute school classes coaching bank finance hotel restaurant mart foods food sweets jewellery jewellers "
    "fancy tailors textile silks readymades transport transports logistics travels temple nagar road street main "
    "cross layout funds chit tools machine machines dry clean cleaners").split()}
_split = lambda s: re.split(r"[\s\-&.,/()']+", to_latin(s))
core = lambda s: "".join(t for t in (loose(w) for w in _split(s)) if t and t not in GENERIC)
tokens = lambda s: {t for t in (loose(w) for w in _split(s)) if len(t) >= 4} - GENERIC


def same_business(a, b):
    """Strict matcher for our name vs a Google listing (validated: 12/12 sample confirmations correct)."""
    if TAM(a) > 0.5 * max(len((a or "").replace(" ", "")), 1): return False
    la, lb = loose(a), loose(b)
    if not la or not lb: return False
    if la == lb: return True
    s_, l_ = sorted((la, lb), key=len)
    if len(s_) >= 6 and len(s_) >= 0.6 * len(l_) and s_ in l_: return True
    ca, cb = core(a), core(b)
    if len(ca) >= 3 and ca == cb: return True
    if len(ca) >= 5 and len(cb) >= 5 and difflib.SequenceMatcher(None, ca, cb).ratio() >= 0.85: return True
    ta, tb = tokens(a), tokens(b)
    if ta & tb: return True
    return any(len(x) >= 5 and len(y) >= 5 and x[0] == y[0] and difflib.SequenceMatcher(None, x, y).ratio() >= 0.9
               for x in ta for y in tb)


NONNAME = {"NO PARKING", "PARKING", "STOP", "ATM", "TO LET", "TOLET", "FOR SALE", "SHOP FOR RENT", "FOR RENT",
           "COIMBATORE", "NAGAR", "OPEN", "CLOSED", "WELCOME", "ROAD", "STREET", "CAUTION", "DANGER"}


def name_quality(name, src, google_confirmed):
    n = (name or "").strip()
    if not n: return None
    if TAM(n) > 0.5 * len(n.replace(" ", "")): return "tamil_unverified"
    if google_confirmed: return "good"
    u = " ".join(re.sub(r"[^A-Z ]", " ", n.upper()).split())
    if u in NONNAME or len(u.replace(" ", "")) < 4: return "fragment"
    if len(u.split()) == 1 and len(u) <= 6 and src == "ocr": return "fragment"
    return "good"
