"""Dashboard data (KPI cards, charts, cost panel) + plain-English query engine (M3)."""
import re
from collections import Counter


def build_dashboard(results, assets, gaps, queue, run_stats):
    streets = sorted({m["street"] for m in results})
    kpi = {"streets_covered": len(streets), "buildings_analysed": len(results),
           "unmatched_properties": sum(m["match_status"] == "no_record" for m in results),
           "buildings_with_discrepancy": sum(m["match_status"] == "discrepancy" for m in results),
           "streetlights": sum(a["cls"] == "streetlight" for a in assets), "poles": sum(a["cls"] == "pole" for a in assets),
           "named_businesses": sum(m.get("name_quality") == "good" for m in results),
           "sign_text_unverified": sum(m.get("name_quality") in ("tamil_unverified", "fragment") for m in results),
           "names_confirmed_by_google": sum(bool(m.get("name_verified_google")) for m in results),
           "low_confidence_observations": len(queue)}
    charts = {"building_use": dict(Counter(m["obs_use"] or "not observed" for m in results)),
              "floor_distribution": dict(sorted(Counter(m["obs_floors"] for m in results if m["floors_status"] == "measured").items())),
              "floors_status": dict(Counter(m["floors_status"] for m in results)),
              "asset_type": dict(Counter(a["cls"] for a in assets)),
              "match_status": dict(Counter(m["match_status"] for m in results)),
              "discrepancy_type": dict(Counter(d for m in results for d in m["discrepancies"])),
              "by_street": {s: {"buildings": sum(m["street"] == s for m in results),
                                "no_record": sum(m["street"] == s and m["match_status"] == "no_record" for m in results),
                                "discrepancy": sum(m["street"] == s and m["match_status"] == "discrepancy" for m in results),
                                "streetlights": sum(a.get("street") == s and a["cls"] == "streetlight" for a in assets),
                                "poles": sum(a.get("street") == s and a["cls"] == "pole" for a in assets),
                                "gap_m_60": sum(g["length_m"] for g in gaps.get("60", []) if g["street"] == s)}
                            for s in streets}}
    return {"kpi": kpi, "charts": charts, "cost_panel": run_stats, "streets": streets}


NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


class QueryEngine:
    def __init__(self, results, assets, gaps, queue):
        self.M, self.A, self.G, self.Q = results, assets, gaps, queue
        self.streets = sorted({m["street"] for m in results})

    def parse(self, q):
        ql = q.lower(); f = {}
        key = lambda x: " ".join(re.sub(r"[^a-z0-9]+", " ", x.lower()).split())
        qn = key(q)
        for s in sorted(self.streets, key=len, reverse=True):
            base = re.sub(r"\s*\(approx\.\)", "", s)
            if any(c and f" {c} " in f" {qn} " for c in [key(base)] + [key(p) for p in base.split("/")]):
                f["street"] = s; break
        m = re.search(r"(?:within|every|interval of|more than|over)\s+(\d+)\s*m(?:etres|eters)?\b", ql)
        if "streetlight" in ql or "street light" in ql or "lamp" in ql:
            if re.search(r"\bno\b|without|gap|dark|missing", ql):
                f["intent"] = "streetlight_gaps"; f["interval_m"] = int(m.group(1)) if m else 60; return f
            f["intent"] = "assets"; f["asset_type"] = "streetlight"; return f
        if re.search(r"\bpoles?\b", ql): f["intent"] = "assets"; f["asset_type"] = "pole"; return f
        if "review" in ql or "low-confidence" in ql or "low confidence" in ql:
            f["intent"] = "review"
            if "floor" in ql: f["reason_has"] = "floor count low confidence"
            return f
        f["intent"] = "buildings"
        if re.search(r"commercial|shops?|business", ql): f["use"] = "commercial"
        elif re.search(r"residential|houses?|homes?", ql): f["use"] = "residential"
        m = re.search(r"(more than|over|above|at least|less than|under|exactly)\s+(\w+)\s+(?:visible\s+)?(?:floors?|storeys?)", ql)
        n = (int(m.group(2)) if m and m.group(2).isdigit() else NUM.get(m.group(2))) if m else None
        if n:
            f["floors_op"] = {"more than": ">", "over": ">", "above": ">", "at least": ">=", "less than": "<",
                              "under": "<", "exactly": "=="}[m.group(1)]; f["floors_n"] = n
        if re.search(r"no (?:matching )?(?:property )?record|unmatched|not (?:in the )?regist|without (?:a )?(?:matching )?"
                     r"(?:property )?record|(?:do|does|did) ?n[o']t have (?:a |any )?(?:matching )?(?:property )?record", ql):
            f["match_status"] = "no_record"
        elif re.search(r"discrepan|mismatch|flagged", ql): f["match_status"] = "discrepancy"
        for d in ("location_shift", "area_understated", "use_change", "extra_floor"):
            if d.replace("_", " ") in ql: f["discrepancy"] = d
        if "not in google" in ql or "unlisted" in ql: f["ref_flag"] = "sign_not_in_google_within_40m"
        if re.search(r"by street|per street", ql): f["group_by"] = "street"
        return f

    def run(self, q):
        f = self.parse(q); it = f["intent"]
        if it == "streetlight_gaps":
            k = str(min((40, 60, 100), key=lambda v: abs(v - f["interval_m"])))
            return f, sorted([g for g in self.G.get(k, []) if not f.get("street") or g["street"] == f["street"]],
                             key=lambda g: -g["length_m"])
        if it == "assets":
            return f, [a for a in self.A if a["cls"] == f["asset_type"] and (not f.get("street") or a.get("street") == f["street"])]
        if it == "review":
            return f, [x for x in self.Q if (not f.get("street") or x.get("street") == f["street"])
                       and (not f.get("reason_has") or any(f["reason_has"] in r for r in x["reasons"]))]
        OPS = {">": lambda a, b: a > b, ">=": lambda a, b: a >= b, "<": lambda a, b: a < b, "==": lambda a, b: a == b}
        steps = []
        if f.get("street"): steps.append((f"on {f['street']}", lambda m: m["street"] == f["street"]))
        if f.get("match_status"): steps.append((f"match status = {f['match_status']}", lambda m: m["match_status"] == f["match_status"]))
        if f.get("discrepancy"): steps.append((f"has {f['discrepancy']}", lambda m: f["discrepancy"] in m["discrepancies"]))
        if f.get("use") == "commercial": steps.append(("observed commercial/mixed", lambda m: m["obs_use"] in ("commercial", "mixed")))
        if f.get("use") == "residential": steps.append(("observed residential", lambda m: m["obs_use"] == "residential"))
        if f.get("floors_op"):
            steps.append(("floor count measured", lambda m: m["floors_status"] == "measured" and m["obs_floors"] is not None))
            steps.append((f"floors {f['floors_op']} {f['floors_n']}", lambda m: OPS[f["floors_op"]](m["obs_floors"], f["floors_n"])))
        if f.get("ref_flag"): steps.append(("sign not in Google", lambda m: f["ref_flag"] in m.get("ref_flags", [])))
        rows, funnel = list(self.M), [("all buildings", len(self.M))]
        for label, pred in steps:
            rows = [m for m in rows if pred(m)]; funnel.append((label, len(rows)))
        if not rows: f["why_empty"] = funnel
        if f.get("group_by") == "street": return f, dict(Counter(r["street"] for r in rows).most_common())
        return f, rows
