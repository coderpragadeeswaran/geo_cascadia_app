"""P7 R3: the worker retries a failed result upload (with fresh file handles), and the warm-up's cache files are the ones
the API reads."""
import os
import types

import pytest
import requests

from app import minimap
from app.settings import ROOT


@pytest.fixture
def W(tmp_path, monkeypatch):
    src = open(os.path.join(ROOT, "worker", "colab_worker.py"), encoding="utf-8").read()
    g = {"__name__": "colab_worker_test"}
    monkeypatch.chdir(tmp_path)
    for v in ("HOME", "USERPROFILE"):
        monkeypatch.setenv(v, str(tmp_path))
    exec(compile(src.rstrip()[:-len("main()")], "colab_worker.py", "exec"), g)
    g["time"] = types.SimpleNamespace(sleep=lambda s: None, time=__import__("time").time,
                                      monotonic=__import__("time").monotonic)
    return g


def _files(tmp_path):
    names = []
    for n, body in (("export.json", b'{"meta": {}, "buildings": [], "assets": []}'), ("plan.json", b"[]")):
        p = tmp_path / n
        p.write_bytes(body)
        names.append(str(p))
    return names


class FakeApi:
    """fails the first `fail` calls after reading the files (as a dropped connection would), then answers"""
    def __init__(self, fail, then=None):
        self.fail, self.then, self.calls, self.url = fail, then, [], "https://x"

    def call(self, path, body=None, files=None, data=None, timeout=30):
        got = {name: fh.read() for _, (name, fh, _) in files}       # the request body is read whether or not it arrives
        self.calls.append(got)
        if len(self.calls) <= self.fail:
            raise requests.ConnectionError("connection reset")
        if self.then:
            raise self.then
        return {"ok": True}


def test_upload_retried_with_full_files(W, tmp_path):
    names = _files(tmp_path)
    api = FakeApi(fail=2)
    assert W["upload_result"](api, "job1", "w1", names) == {"ok": True}
    assert len(api.calls) == 3
    assert all(c["export.json"].startswith(b'{"meta"') and c["plan.json"] == b"[]" for c in api.calls)


def test_upload_lost_answer_counts_as_delivered(W, tmp_path):
    names = _files(tmp_path)
    r = requests.Response()
    r.status_code, r._content = 409, b'{"detail": "job is done"}'
    api = FakeApi(fail=1, then=requests.HTTPError(response=r))
    assert W["upload_result"](api, "job1", "w1", names) is None
    assert len(api.calls) == 2


def test_upload_client_error_not_retried(W, tmp_path):
    names = _files(tmp_path)
    r = requests.Response()
    r.status_code, r._content = 422, b'{"detail": "export.json is required"}'
    api = FakeApi(fail=0, then=requests.HTTPError(response=r))
    with pytest.raises(requests.HTTPError):
        W["upload_result"](api, "job1", "w1", names)
    assert len(api.calls) == 1


def test_minimap_queries_shared_with_warmup():
    bb = [11.0, 76.9, 11.01, 76.91]
    assert minimap.roads_query(bb).startswith('[out:json][timeout:25];way["highway"~')
    assert minimap.job_bounds({"lines": {"type": "LineString", "coordinates": [[76.9, 11.0], [76.91, 11.0]]}})[0] < 11.0
    assert minimap.job_bounds({}) is None


def test_planner_never_caches_no_street_view_when_google_unreachable(tmp_path, monkeypatch):
    """A network failure during planning must fail (not cached), never stick as a 0-photo "no Street View" estimate."""
    from shapely.geometry import box
    from app import planest
    import geo_cascadia.streetview as sv
    monkeypatch.setattr(sv.StreetView, "discover", lambda self, *a, **k: ([], None))   # what the pipeline returns on any error

    def down(*a, **k):
        raise requests.ConnectionError("blocked")
    monkeypatch.setattr(requests, "get", down)
    with pytest.raises(planest.StreetViewUnreachable):
        planest.plan_street(box(76.97, 11.03, 76.971, 11.031).__geo_interface__, [], str(tmp_path), "KEY")

    class Ok:
        def json(self):
            return {"status": "ZERO_RESULTS"}
    monkeypatch.setattr(requests, "get", lambda *a, **k: Ok())
    res = planest.plan_street(box(76.97, 11.03, 76.971, 11.031).__geo_interface__, [], str(tmp_path), "KEY")
    assert res["panoramas"] == 0 and "no outdoor Street View" in res["note"]
