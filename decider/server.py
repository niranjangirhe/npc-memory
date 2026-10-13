"""
Runs GLiClass as Mira's typed decision model.

The game posts a description of Mira's history and the current state, plus
the options it supports for each question. GLiClass scores every option
against the others and the game picks the best one.

    pip install -r decider/requirements.txt
    python decider/server.py

POST /decide  {"text": str, "prompt": str, "questions": {"reaction": [label, ...], ...}}
           -> {"scores": {"reaction": {label: score, ...}, ...}, "ms": float}
GET  /health  -> {"model": str, "device": str, "load_seconds": float, "rss_mb": float | null, "gpu_mb": float | null}
"""

import json
import os
import time

try:
    import psutil
except ImportError:  # memory is reported as null without it
    psutil = None
from http.server import BaseHTTPRequestHandler, HTTPServer

import torch
from gliclass import GLiClassModel, ZeroShotClassificationPipeline
from transformers import AutoTokenizer

MODEL = os.environ.get("GLICLASS_MODEL", "knowledgator/gliclass-small-v1.0")
PORT = int(os.environ.get("DECIDER_PORT", "8765"))
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"

print(f"Loading {MODEL} on {DEVICE}...", flush=True)
_load_start = time.perf_counter()
model = GLiClassModel.from_pretrained(MODEL)
tokenizer = AutoTokenizer.from_pretrained(MODEL)
pipeline = ZeroShotClassificationPipeline(
    model, tokenizer, classification_type="single-label", device=DEVICE, progress_bar=False
)
LOAD_SECONDS = time.perf_counter() - _load_start


def health():
    rss = psutil.Process().memory_info().rss / 2**20 if psutil else None
    gpu = torch.cuda.memory_allocated() / 2**20 if DEVICE.startswith("cuda") else None
    return {"model": MODEL, "device": DEVICE, "load_seconds": LOAD_SECONDS, "rss_mb": rss, "gpu_mb": gpu}


def decide(text, prompt, questions):
    scores = {}
    for name, labels in questions.items():
        # Single-label mode compares the options with each other (a softmax over
        # them), so the scores add up to 1 and show which option clearly wins.
        # return_hierarchical keeps every option's score, not just the best one.
        scores[name] = pipeline(
            text,
            labels,
            classification_type="single-label",
            prompt=prompt or None,
            return_hierarchical=True,
        )[0]
    return scores


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, health())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/decide":
            return self._send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            start = time.perf_counter()
            scores = decide(body["text"], body.get("prompt"), body["questions"])
            self._send(200, {"scores": scores, "ms": (time.perf_counter() - start) * 1000})
        except (KeyError, ValueError, TypeError) as e:
            self._send(400, {"error": str(e)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"Decision model ready on http://127.0.0.1:{PORT}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
