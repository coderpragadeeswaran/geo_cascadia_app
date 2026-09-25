"""G1: small-model-first building use. A CLIP image embedding + logistic regression, trained on the VLM's
own answers, labels buildings locally when confident; only uncertain buildings go to the VLM."""
import numpy as np

CLIP_NAME = "openai/clip-vit-base-patch32"
USE3 = lambda u: "commercial" if u in ("commercial", "mixed") else ("residential" if u == "residential" else "other")


def clip_embed(paths, device="cpu", name=CLIP_NAME, batch=32):
    import torch
    from PIL import Image
    from transformers import CLIPModel, CLIPProcessor
    dev = "cuda" if device == "gpu" and torch.cuda.is_available() else "cpu"
    m = CLIPModel.from_pretrained(name).to(dev).eval(); p = CLIPProcessor.from_pretrained(name)
    out = []
    with torch.no_grad():
        for i in range(0, len(paths), batch):
            ims = [Image.open(x).convert("RGB") for x in paths[i:i + batch]]
            f = m.get_image_features(**p(images=ims, return_tensors="pt").to(dev))
            out.append(torch.nn.functional.normalize(f, dim=-1).cpu().numpy())
    return np.concatenate(out) if out else np.zeros((0, 512))


class UseRouter:
    def __init__(self, path, device="cpu"):
        import joblib
        d = joblib.load(path)
        self.clf, self.t, self.name, self.device = d["clf"], d["threshold"], d.get("clip", CLIP_NAME), device

    def predict(self, paths):
        if not paths: return []
        P = self.clf.predict_proba(clip_embed(paths, self.device, self.name))
        cls = self.clf.classes_
        return [(cls[i.argmax()], float(i.max())) for i in P]
