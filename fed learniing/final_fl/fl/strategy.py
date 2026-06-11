import os
from pathlib import Path
from typing import Optional, Union
import numpy as np
import flwr as fl
from flwr.common import Parameters, Scalar, FitRes, EvaluateRes
from flwr.server.client_proxy import ClientProxy


CHECKPOINT_DIR = Path("models/checkpoints")
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)


class SaveBestFedAvg(fl.server.strategy.FedAvg):
    """
    FedAvg strategy that saves aggregated weights every round
    and keeps track of the best round by val loss.
    """

    def __init__(self, model_name: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.model_name = model_name      # "detector" or "corrector"
        self.best_loss  = float("inf")
        self.best_round = 0
        self.round_metrics: list[dict] = []

    def aggregate_fit(
        self,
        server_round: int,
        results: list[tuple[ClientProxy, FitRes]],
        failures,
    ) -> tuple[Optional[Parameters], dict[str, Scalar]]:
        aggregated, metrics = super().aggregate_fit(server_round, results, failures)

        if aggregated is not None:
            # Save weights for this round
            weights = fl.common.parameters_to_ndarrays(aggregated)
            path    = CHECKPOINT_DIR / f"{self.model_name}_round_{server_round}.npz"
            np.savez(str(path), *weights)
            print(f"[FL] Round {server_round} weights saved → {path}")

        return aggregated, metrics

    def aggregate_evaluate(
        self,
        server_round: int,
        results: list[tuple[ClientProxy, EvaluateRes]],
        failures,
    ) -> tuple[Optional[float], dict[str, Scalar]]:
        agg_loss, metrics = super().aggregate_evaluate(server_round, results, failures)

        if agg_loss is not None:
            record = {"round": server_round, "loss": agg_loss, **metrics}
            self.round_metrics.append(record)
            print(f"[FL] Round {server_round} | Loss: {agg_loss:.4f} | Metrics: {metrics}")

            if agg_loss < self.best_loss:
                self.best_loss  = agg_loss
                self.best_round = server_round
                # Copy best round weights to best.npz
                src  = CHECKPOINT_DIR / f"{self.model_name}_round_{server_round}.npz"
                dest = CHECKPOINT_DIR / f"{self.model_name}_best.npz"
                if src.exists():
                    import shutil
                    shutil.copy(src, dest)
                    
                    # Also save to PyTorch .pth format for FastAPI/inference
                    pth_dest = Path("models") / (
                        "detector_best.pth"
                        if self.model_name == "detector"
                        else "nepali_correction_best.pth"
                    )
                    try:
                        from core.tokenizer import CharTokenizer
                        from core.models import CharTransformerDetector, NepaliCorrectionModel
                        from collections import OrderedDict
                        import torch
                        
                        data = np.load(str(src))
                        parameters_list = [data[f] for f in data.files]
                        
                        if self.model_name == "detector":
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
                        torch.save(model.state_dict(), pth_dest)
                        print(f"[FL] Saved PyTorch weights → {pth_dest}")
                        # PyTorch weights saved to pth_dest; no duplicate copy needed
                    except Exception as e:
                        print(f"[FL] Error saving .pth file: {e}")
                print(f"[FL] New best round: {server_round} (loss {agg_loss:.4f})")

        return agg_loss, metrics
