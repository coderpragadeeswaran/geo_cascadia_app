"""G1: small-model-first building use. A CLIP image embedding + logistic regression, trained on the VLM's
own answers, labels buildings locally when confident; only uncertain buildings go to the VLM."""
import numpy as np

CLIP_NAME = "openai/clip-vit-base-patch32"
USE3 = lambda u: "commercial" if u in ("commercial", "mixed") else ("residential" if u == "residential" else "other")


def feature_tensor(f, kind="image", dim=None):
    """get_image_features / get_text_features return a tensor up to transformers 4.x; newer versions return an output
    object whose pooler_output holds the same projected features. A full CLIPOutput carries image_embeds / text_embeds.
    dim: the model's projection_dim, to fail loudly instead of classifying unprojected features."""
    if not hasattr(f, "norm"):
        emb = getattr(f, f"{kind}_embeds", None)
        f = emb if emb is not None else getattr(f, "pooler_output", None)
        if f is None:
            raise TypeError(f"CLIP get_{kind}_features returned no usable features")
    if dim and f.shape[-1] != dim:
        raise ValueError(f"CLIP {kind} features have size {f.shape[-1]}, expected {dim} (projected)")
    return f


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
            f = feature_tensor(m.get_image_features(**p(images=ims, return_tensors="pt").to(dev)), "image",
                               getattr(m.config, "projection_dim", None))
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
