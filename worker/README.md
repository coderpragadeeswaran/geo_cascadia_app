# Colab worker

`colab_worker.py` (built in P6) is a single cell pasted into Colab **after** the owner's setup cells
(S0 install package, S1a deps, S1b keys → `cfg`, `run_area`, `D`). It polls the backend's `/worker/*`
endpoints through a `cloudflared` quick tunnel. The tunnel URL changes on every restart, so the cell takes
`API_URL` and `WORKER_TOKEN` as variables at the top. AWS keys stay in Colab only.
