"""
Federated Learning Server
==========================
Runs two separate FL rounds:
  1. DetectorServer  — aggregates CharTransformerDetector weights
  2. CorrectorServer — aggregates Seq2SeqCorrector weights

Also hosts a local FastAPI server concurrently to support ONNX/JSON model
importing and exporting for the frontend.

Run with:
    python fl/server.py --model detector
    python fl/server.py --model corrector
    python fl/server.py --model both

Requirements:
    pip install flwr torch numpy fastapi uvicorn onnx
"""

import sys
from pathlib import Path
# Add parent directory to sys.path so we can import from core/ even when run directly as python fl/server.py
sys.path.append(str(Path(__file__).resolve().parent.parent))

import argparse
import os
import shutil
import threading
import io
from typing import Dict, List, Optional, Tuple, Union
from functools import partial
from logging import INFO, WARNING
from collections import OrderedDict

import numpy as np
import torch
import flwr as fl
from flwr.common import (
    FitRes,
    EvaluateRes,
    Parameters,
    Scalar,
    parameters_to_ndarrays,
)
from flwr.server.client_proxy import ClientProxy
from flwr.server.strategy import FedAvg
from flwr.common.logger import log

from fastapi import FastAPI, UploadFile, File, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from core.models import CharTransformerDetector, NepaliCorrectionModel, Seq2SeqCorrector
from core.tokenizer import CharTokenizer

# Try importing onnx helper
try:
    import onnx
    from onnx import numpy_helper
    ONNX_AVAILABLE = True
except ImportError:
    ONNX_AVAILABLE = False


# ── CONFIG ────────────────────────────────────────────────────────────────────
DEFAULT_HOST            = "0.0.0.0"
DEFAULT_PORT_DETECTOR   = 8080
DEFAULT_PORT_CORRECTOR  = 8081
DEFAULT_PORT_API        = 8082

DETECTOR_ROUNDS   = 10
CORRECTOR_ROUNDS  = 10
MIN_CLIENTS       = 2

DETECTOR_FIT_CONFIG = {
    "lr":         3e-4,
    "epochs":     1,
    "batch_size": 64,
}
CORRECTOR_FIT_CONFIG = {
    "lr":         3e-4,
    "epochs":     1,
    "batch_size": 128,
}


# ── HELPERS ───────────────────────────────────────────────────────────────────
def fit_config(base_cfg: dict, server_round: int) -> Dict[str, Scalar]:
    """Send per-round training config to clients. LR halved after round 5."""
    cfg = dict(base_cfg)
    if server_round > 5:
        cfg["lr"] = base_cfg["lr"] * 0.5
    cfg["server_round"] = server_round
    return cfg


def evaluate_config(server_round: int) -> Dict[str, Scalar]:
    return {"server_round": server_round}


def weighted_average(metrics: List[Tuple[int, Dict[str, Scalar]]]) -> Dict[str, Scalar]:
    """Weighted average of client metrics by number of examples."""
    total = sum(n for n, _ in metrics)
    if total == 0:
        return {}
    result = {}
    for key in metrics[0][1].keys():
        result[key] = sum(m[key] * n for n, m in metrics) / total
    return result


def save_npy_to_pth(model_name: str, npy_path: str, pth_path: str):
    """Loads aggregated Flower weights (.npy format) and exports to PyTorch .pth."""
    try:
        parameters = np.load(npy_path, allow_pickle=True)
        parameters_list = [arr for arr in parameters]

        if "detector" in model_name.lower():
            tokenizer = CharTokenizer.load("data/detect_char_tokenizer.json")
            model = CharTransformerDetector(
                vocab_size=tokenizer.vocab_size,
                embed_dim=64, num_heads=4, num_layers=3,
                ff_dim=256, max_len=30, dropout=0.0
            )
        else:
            tokenizer = CharTokenizer.load("models/nepali_correction_tokenizer.json")
            model = NepaliCorrectionModel(
                vocab_size=tokenizer.vocab_size,
                embed_dim=64, hidden_dim=128,
                num_layers=2, dropout=0.0
            )

        state_dict = OrderedDict(
            {k: torch.tensor(v) for k, v in zip(model.state_dict().keys(), parameters_list)}
        )
        model.load_state_dict(state_dict, strict=True)
        os.makedirs(os.path.dirname(pth_path), exist_ok=True)
        torch.save(model.state_dict(), pth_path)
        log(INFO, "[%s] Successfully saved aggregated weights as .pth → %s", model_name, pth_path)
    except Exception as e:
        log(WARNING, "[%s] Error converting npy to pth: %s", model_name, str(e))


# ── CUSTOM STRATEGY ───────────────────────────────────────────────────────────
class LoomwoodFedAvg(FedAvg):
    """
    FedAvg with:
      - Per-round metric logging
      - Best model saving to disk
      - Saving parameters directly as PyTorch .pth weights
      - Graceful failure handling
    """

    def __init__(self, model_name: str, save_dir: str, **kwargs):
        super().__init__(**kwargs)
        self.model_name  = model_name
        self.save_dir    = save_dir
        self.best_metric = 0.0
        self.round_logs  = []
        os.makedirs(save_dir, exist_ok=True)

    # ── FIT AGGREGATION ───────────────────────────────────────────────────────
    def aggregate_fit(
        self,
        server_round: int,
        results: List[Tuple[ClientProxy, FitRes]],
        failures: List[Union[Tuple[ClientProxy, FitRes], BaseException]],
    ) -> Tuple[Optional[Parameters], Dict[str, Scalar]]:

        if failures:
            log(WARNING, "[%s] Round %d — %d client(s) failed in fit.",
                self.model_name, server_round, len(failures))

        if not results:
            log(WARNING, "[%s] Round %d — no fit results.", self.model_name, server_round)
            return None, {}

        log(INFO, "[%s] Round %d — aggregating %d client(s).",
            self.model_name, server_round, len(results))

        aggregated_params, metrics = super().aggregate_fit(server_round, results, failures)

        # Save round weights
        if aggregated_params is not None:
            weights = parameters_to_ndarrays(aggregated_params)
            path = os.path.join(self.save_dir, f"round_{server_round:03d}.npy")
            np.save(path, np.array(weights, dtype=object), allow_pickle=True)
            log(INFO, "[%s] Saved round %d weights → %s",
                self.model_name, server_round, path)

        return aggregated_params, metrics

    # ── EVAL AGGREGATION ──────────────────────────────────────────────────────
    def aggregate_evaluate(
        self,
        server_round: int,
        results: List[Tuple[ClientProxy, EvaluateRes]],
        failures: List[Union[Tuple[ClientProxy, EvaluateRes], BaseException]],
    ) -> Tuple[Optional[float], Dict[str, Scalar]]:

        if failures:
            log(WARNING, "[%s] Round %d — %d client(s) failed in evaluate.",
                self.model_name, server_round, len(failures))

        if not results:
            return None, {}

        loss_agg, metrics_agg = super().aggregate_evaluate(server_round, results, failures)

        log(INFO, "[%s] Round %d | Loss: %.4f | %s",
            self.model_name, server_round, loss_agg or 0.0, metrics_agg)

        self.round_logs.append({
            "round":   server_round,
            "loss":    loss_agg,
            "metrics": metrics_agg,
        })

        # Save best model
        primary = "accuracy" if "accuracy" in metrics_agg else "word_accuracy"
        if primary in metrics_agg and metrics_agg[primary] > self.best_metric:
            self.best_metric = metrics_agg[primary]
            best_src  = os.path.join(self.save_dir, f"round_{server_round:03d}.npy")
            best_dst  = os.path.join(self.save_dir, "best.npy")
            if os.path.exists(best_src):
                shutil.copy(best_src, best_dst)
                log(INFO, "[%s] New best %s=%.4f — saved to %s",
                    self.model_name, primary, self.best_metric, best_dst)

                # Export to global .pth path for API consumption
                is_detector = "detector" in self.model_name.lower()
                pth_dest = "models/detector_best.pth" if is_detector else "models/nepali_correction_best.pth"
                save_npy_to_pth(self.model_name, best_src, pth_dest)

        return loss_agg, metrics_agg

    # ── SUMMARY ───────────────────────────────────────────────────────────────
    def print_summary(self):
        print(f"\n{'='*60}")
        print(f"  {self.model_name} — Training Summary")
        print(f"{'='*60}")
        print(f"  {'Round':<8} {'Loss':<12} {'Metrics'}")
        print(f"  {'-'*55}")
        for entry in self.round_logs:
            r = entry["round"]
            l = f"{entry['loss']:.4f}" if entry["loss"] is not None else "N/A"
            m = {k: f"{v:.4f}" for k, v in entry["metrics"].items()}
            print(f"  {r:<8} {l:<12} {m}")
        print(f"{'='*60}")
        print(f"  Best metric: {self.best_metric:.4f}")
        print(f"  Weights saved in: {self.save_dir}/")
        print(f"{'='*60}\n")


# ── BUILD STRATEGIES ──────────────────────────────────────────────────────────
def build_strategy(model_name: str, save_dir: str, fit_cfg: dict) -> LoomwoodFedAvg:
    return LoomwoodFedAvg(
        model_name = model_name,
        save_dir   = save_dir,
        # FedAvg core params
        fraction_fit                    = 1.0,
        fraction_evaluate               = 1.0,
        min_fit_clients                 = MIN_CLIENTS,
        min_evaluate_clients            = MIN_CLIENTS,
        min_available_clients           = MIN_CLIENTS,
        on_fit_config_fn                = partial(fit_config, fit_cfg),
        on_evaluate_config_fn           = evaluate_config,
        evaluate_metrics_aggregation_fn = weighted_average,
    )


# ── SERVER RUNNERS ────────────────────────────────────────────────────────────
def run_detector_server(host: str, port: int):
    strategy = build_strategy(
        model_name = "DetectorServer",
        save_dir   = "weights/detector",
        fit_cfg    = DETECTOR_FIT_CONFIG,
    )
    addr = f"{host}:{port}"
    print(f"\n[DetectorServer] Listening on {addr}")
    print(f"[DetectorServer] Rounds={DETECTOR_ROUNDS}  MinClients={MIN_CLIENTS}\n")

    fl.server.start_server(
        server_address = addr,
        config         = fl.server.ServerConfig(num_rounds=DETECTOR_ROUNDS),
        strategy       = strategy,
    )
    strategy.print_summary()


def run_corrector_server(host: str, port: int):
    strategy = build_strategy(
        model_name = "CorrectorServer",
        save_dir   = "weights/corrector",
        fit_cfg    = CORRECTOR_FIT_CONFIG,
    )
    addr = f"{host}:{port}"
    print(f"\n[CorrectorServer] Listening on {addr}")
    print(f"[CorrectorServer] Rounds={CORRECTOR_ROUNDS}  MinClients={MIN_CLIENTS}\n")

    fl.server.start_server(
        server_address = addr,
        config         = fl.server.ServerConfig(num_rounds=CORRECTOR_ROUNDS),
        strategy       = strategy,
    )
    strategy.print_summary()


# ── FASTAPI SERVER FOR ONNX & JSON EXPORT/IMPORT ──────────────────────────────
api_app = FastAPI(
    title="Local FL ONNX Bridge API",
    description="Interface to export current local models to ONNX and accept models/weights from the frontend.",
)

api_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DecoderWrapper(torch.nn.Module):
    def __init__(self, decoder):
        super().__init__()
        self.decoder = decoder

    def forward(self, token, h, c, enc_out):
        step_out = self.decoder.forward_step(token, h, c, enc_out)
        pred, new_h, new_c = step_out[:3]
        return pred, new_h, new_c


class CorrectorEncoderWrapper(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.encoder = model.encoder
        self.fc_h = model.fc_h
        self.fc_c = model.fc_c

    def forward(self, x):
        enc_out = self.encoder(x)
        enc_mean = enc_out.mean(dim=1)
        h = torch.tanh(self.fc_h(enc_mean))
        c = torch.tanh(self.fc_c(enc_mean))
        return enc_out, h, c


def load_model(model_type: str):
    """Helper to load model structure and weights."""
    if model_type == "detector":
        tokenizer = CharTokenizer.load("data/detect_char_tokenizer.json")
        model = CharTransformerDetector(
            vocab_size=tokenizer.vocab_size,
            embed_dim=64, num_heads=4, num_layers=3,
            ff_dim=256, max_len=30, dropout=0.0
        )
        path = "models/detector_best.pth"
        if os.path.exists(path):
            model.load_state_dict(torch.load(path, map_location="cpu"))
        return model, tokenizer
    elif model_type == "corrector":
        tokenizer = CharTokenizer.load("models/nepali_correction_tokenizer.json")
        model = NepaliCorrectionModel(
            vocab_size=tokenizer.vocab_size,
            embed_dim=64, hidden_dim=128,
            num_layers=2, dropout=0.0
        )
        path = "models/nepali_correction_best.pth"
        if os.path.exists(path):
            model.load_state_dict(torch.load(path, map_location="cpu"))
        return model, tokenizer
    else:
        raise ValueError(f"Unknown model_type: {model_type}")


@api_app.get("/onnx/export/detector")
def export_detector_onnx():
    """Download detector as ONNX."""
    try:
        model, _ = load_model("detector")
        model.eval()
        buffer = io.BytesIO()
        dummy_input = torch.zeros((1, 30), dtype=torch.long)
        torch.onnx.export(
            model,
            dummy_input,
            buffer,
            input_names=["input"],
            output_names=["output"],
            dynamic_axes={
                "input": {0: "batch_size", 1: "seq_len"},
                "output": {0: "batch_size"},
            },
            opset_version=14,
        )
        buffer.seek(0)
        return Response(
            content=buffer.read(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=detector.onnx"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ONNX Export failed: {str(e)}")


@api_app.get("/onnx/export/corrector/encoder")
def export_corrector_encoder_onnx():
    """Download corrector encoder as ONNX."""
    try:
        model, _ = load_model("corrector")
        model.eval()
        buffer = io.BytesIO()
        wrapper = CorrectorEncoderWrapper(model)
        dummy_x = torch.zeros((1, 100), dtype=torch.long)
        torch.onnx.export(
            wrapper,
            (dummy_x,),
            buffer,
            input_names=["x"],
            output_names=["enc_out", "h", "c"],
            dynamic_axes={
                "x": {0: "batch_size", 1: "seq_len"},
                "enc_out": {0: "batch_size", 1: "seq_len"},
                "h": {1: "batch_size"},
                "c": {1: "batch_size"},
            },
            opset_version=14,
        )
        buffer.seek(0)
        return Response(
            content=buffer.read(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=corrector_encoder.onnx"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Encoder ONNX Export failed: {str(e)}")


@api_app.get("/onnx/export/corrector/decoder")
def export_corrector_decoder_onnx():
    """Download corrector decoder step as ONNX."""
    try:
        model, _ = load_model("corrector")
        model.eval()
        wrapper = DecoderWrapper(model.decoder)
        buffer = io.BytesIO()
        dummy_token = torch.zeros((1,), dtype=torch.long)
        dummy_h = torch.zeros((1, 128), dtype=torch.float)
        dummy_c = torch.zeros((1, 128), dtype=torch.float)
        dummy_enc_out = torch.zeros((1, 100, 64), dtype=torch.float)
        torch.onnx.export(
            wrapper,
            (dummy_token, dummy_h, dummy_c, dummy_enc_out),
            buffer,
            input_names=["token", "h", "c", "enc_out"],
            output_names=["pred", "new_h", "new_c"],
            dynamic_axes={
                "token": {0: "batch_size"},
                "h": {0: "batch_size"},
                "c": {0: "batch_size"},
                "enc_out": {0: "batch_size", 1: "seq_len"},
                "pred": {0: "batch_size"},
                "new_h": {0: "batch_size"},
                "new_c": {0: "batch_size"},
            },
            opset_version=14,
        )
        buffer.seek(0)
        return Response(
            content=buffer.read(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=corrector_decoder.onnx"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decoder ONNX Export failed: {str(e)}")


@api_app.post("/onnx/import/{model_type}")
async def import_onnx(model_type: str, file: UploadFile = File(...)):
    """Import weights from an uploaded ONNX file."""
    if not ONNX_AVAILABLE:
        raise HTTPException(status_code=500, detail="onnx package not installed on the server.")
    if model_type not in ("detector", "corrector"):
        raise HTTPException(status_code=400, detail="model_type must be detector or corrector")

    try:
        contents = await file.read()
        model, _ = load_model(model_type)
        onnx_model = onnx.load_model_from_string(contents)
        onnx_weights = {init.name: numpy_helper.to_array(init) for init in onnx_model.graph.initializer}

        state_dict = model.state_dict()
        new_state_dict = {}

        for key in state_dict.keys():
            matched = False
            if key in onnx_weights:
                new_state_dict[key] = torch.tensor(onnx_weights[key])
                matched = True
            else:
                for ok in onnx_weights.keys():
                    if ok.endswith(key) or key.endswith(ok):
                        new_state_dict[key] = torch.tensor(onnx_weights[ok])
                        matched = True
                        break
            if not matched:
                new_state_dict[key] = state_dict[key]

        model.load_state_dict(new_state_dict, strict=True)
        dest_path = "models/detector_best.pth" if model_type == "detector" else "models/nepali_correction_best.pth"
        torch.save(model.state_dict(), dest_path)
        # Saved PyTorch weights to dest_path for API consumption

        return {"status": "success", "detail": f"Loaded weights from ONNX into {model_type} model."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import ONNX weights: {str(e)}")


@api_app.post("/onnx/import-json/{model_type}")
async def import_json(model_type: str, payload: dict):
    """Import weights from a JSON payload (flat dictionary of param_name -> array)."""
    if model_type not in ("detector", "corrector"):
        raise HTTPException(status_code=400, detail="model_type must be detector or corrector")

    try:
        weights = payload.get("weights")
        if not weights:
            raise HTTPException(status_code=400, detail="Payload must contain a 'weights' key.")

        model, _ = load_model(model_type)
        state_dict = model.state_dict()
        new_state_dict = {}

        for key in state_dict.keys():
            if key in weights:
                new_state_dict[key] = torch.tensor(weights[key])
            else:
                new_state_dict[key] = state_dict[key]

        model.load_state_dict(new_state_dict, strict=True)
        dest_path = "models/detector_best.pth" if model_type == "detector" else "models/nepali_correction_best.pth"
        torch.save(model.state_dict(), dest_path)
        if model_type == "detector":
            shutil.copy(dest_path, "models/detector_best.pth.pth")

        return {"status": "success", "detail": f"Loaded weights from JSON into {model_type} model."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import JSON weights: {str(e)}")


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    # Apply CLI overrides
    global DETECTOR_ROUNDS, CORRECTOR_ROUNDS, MIN_CLIENTS

    parser = argparse.ArgumentParser(description="FL Server — Detector / Corrector")
    parser.add_argument(
        "--model",
        choices = ["detector", "corrector", "both"],
        default = "detector",
        help    = "Which model server to run (default: detector)",
    )
    parser.add_argument("--host",             type=str, default=DEFAULT_HOST)
    parser.add_argument("--port-detector",    type=int, default=DEFAULT_PORT_DETECTOR)
    parser.add_argument("--port-corrector",   type=int, default=DEFAULT_PORT_CORRECTOR)
    parser.add_argument("--api-port",         type=int, default=DEFAULT_PORT_API)
    parser.add_argument("--rounds-detector",  type=int, default=DETECTOR_ROUNDS)
    parser.add_argument("--rounds-corrector", type=int, default=CORRECTOR_ROUNDS)
    parser.add_argument("--min-clients",      type=int, default=MIN_CLIENTS)
    args = parser.parse_args()

    DETECTOR_ROUNDS  = args.rounds_detector
    CORRECTOR_ROUNDS = args.rounds_corrector
    MIN_CLIENTS      = args.min_clients

    print("=" * 60)
    print("  Federated Learning Server")
    print("=" * 60)
    print(f"  Model:        {args.model}")
    print(f"  Host:         {args.host}")
    print(f"  MinClients:   {MIN_CLIENTS}")
    print(f"  Bridge API:   http://{args.host}:{args.api_port}")
    print("=" * 60)

    # Start FastAPI Local Bridge Server in a background thread
    def start_api():
        print(f"\n[Bridge API] Starting on port {args.api_port}...")
        uvicorn.run(api_app, host=args.host, port=args.api_port, log_level="warning")

    api_thread = threading.Thread(target=start_api, daemon=True)
    api_thread.start()

    if args.model == "detector":
        run_detector_server(args.host, args.port_detector)

    elif args.model == "corrector":
        run_corrector_server(args.host, args.port_corrector)

    elif args.model == "both":
        import multiprocessing
        p_det = multiprocessing.Process(
            target=run_detector_server,
            args=(args.host, args.port_detector),
        )
        p_cor = multiprocessing.Process(
            target=run_corrector_server,
            args=(args.host, args.port_corrector),
        )
        print("\n[Main] Launching DetectorServer and CorrectorServer in parallel...\n")
        p_det.start()
        p_cor.start()
        p_det.join()
        p_cor.join()
        print("\n[Main] Both servers finished.")


if __name__ == "__main__":
    main()
