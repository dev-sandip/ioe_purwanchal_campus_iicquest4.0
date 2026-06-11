"""
Local Flower simulation for new_fl.

Examples:
    python new_fl/simulate.py --rounds 5 --clients 3
    python new_fl/simulate.py --rounds 1 --clients 3 --continuous --delay 10
"""

from __future__ import annotations

import argparse
import logging
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

sys.path.append(str(Path(__file__).resolve().parent.parent))

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "right_wrong.csv"
S2S_TOK_PATH = ROOT / "models" / "nepali_correction_tokenizer.json"
S2S_PTH = ROOT / "models" / "nepali_correction_best.pth"

StatusCallback = Callable[[dict[str, Any]], None]


@dataclass
class SimulationStatus:
    running: bool = False
    stop_requested: bool = False
    model: str = "corrector"
    round: int = 0
    total_rounds: int = 0
    clients: int = 0
    continuous: bool = False
    cycle: int = 0
    metrics: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    started_at: float | None = None
    finished_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if self.started_at is not None:
            data["started_at"] = self.started_at
        if self.finished_at is not None:
            data["finished_at"] = self.finished_at
        return data


def _build_model(tokenizer: Any, device: Any) -> Any:
    import torch
    from core.models import NepaliCorrectionModel

    model = NepaliCorrectionModel(
        vocab_size=tokenizer.vocab_size,
        embed_dim=64,
        hidden_dim=128,
        num_layers=2,
        dropout=0.2,
    ).to(device)
    if S2S_PTH.exists():
        model.load_state_dict(torch.load(str(S2S_PTH), map_location=device))
    return model


def simulate_corrector(
    n_clients: int = 3,
    n_rounds: int = 10,
    *,
    csv_path: str | Path = DATA_PATH,
    tokenizer_path: str | Path = S2S_TOK_PATH,
    batch_size: int = 32,
    epochs: int = 2,
    lr: float = 1e-4,
    max_len: int = 100,
    train_split: float = 0.9,
    client_cpus: float = 1.0,
    client_gpus: float = 0.0,
    status_callback: StatusCallback | None = None,
) -> Any:
    import flwr as fl
    import torch
    from torch.utils.data import DataLoader, random_split

    from core.tokenizer import CharTokenizer
    from new_fl.client import NepaliCorrectionFlowerClient
    from new_fl.data_utils import build_correction_dataset, load_pairs
    from new_fl.server import NepaliCorrectionFedAvg

    class ReportingFedAvg(NepaliCorrectionFedAvg):
        """FedAvg strategy that reports round progress to the API/CLI wrapper."""

        def __init__(self, *args: Any, status_callback: StatusCallback | None = None, **kwargs: Any):
            super().__init__(*args, **kwargs)
            self.status_callback = status_callback

        def aggregate_evaluate(self, server_round, results, failures):
            loss, metrics = super().aggregate_evaluate(server_round, results, failures)
            payload = {
                "event": "round_complete",
                "round": server_round,
                "loss": loss,
                "metrics": dict(metrics or {}),
                "best_round": self.best_round,
                "best_loss": self.best_loss,
            }
            if self.status_callback is not None:
                self.status_callback(payload)
            return loss, metrics

    if n_clients < 1:
        raise ValueError("n_clients must be at least 1")
    if n_rounds < 1:
        raise ValueError("n_rounds must be at least 1")
    if not 0.0 < train_split < 1.0:
        raise ValueError("train_split must be between 0 and 1")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = CharTokenizer.load(str(tokenizer_path))
    df = load_pairs(str(csv_path))
    dataset = build_correction_dataset(df, tokenizer, max_len=max_len)

    val_size = max(1, int((1.0 - train_split) * len(dataset)))
    train_size = len(dataset) - val_size
    if train_size < n_clients:
        raise ValueError(
            f"not enough training samples ({train_size}) for {n_clients} clients"
        )

    train_ds, val_ds = random_split(dataset, [train_size, val_size])
    base_size = train_size // n_clients
    split_lengths = [base_size] * n_clients
    split_lengths[-1] += train_size - sum(split_lengths)
    client_splits = random_split(train_ds, split_lengths)

    def client_fn(cid: str):
        cid_int = int(cid)
        train_loader = DataLoader(
            client_splits[cid_int],
            batch_size=batch_size,
            shuffle=True,
            num_workers=0,
        )
        val_loader = DataLoader(
            val_ds,
            batch_size=batch_size,
            shuffle=False,
            num_workers=0,
        )
        return NepaliCorrectionFlowerClient(
            model=_build_model(tokenizer, device),
            train_loader=train_loader,
            val_loader=val_loader,
            device=device,
            client_id=cid_int,
        )

    strategy = ReportingFedAvg(
        status_callback=status_callback,
        fraction_fit=1.0,
        fraction_evaluate=1.0,
        min_fit_clients=n_clients,
        min_evaluate_clients=n_clients,
        min_available_clients=n_clients,
        on_fit_config_fn=lambda r: {
            "lr": lr,
            "epochs": epochs,
            "batch_size": batch_size,
        },
    )

    log.info("Starting corrector simulation: clients=%s rounds=%s", n_clients, n_rounds)
    fl.simulation.start_simulation(
        client_fn=client_fn,
        num_clients=n_clients,
        config=fl.server.ServerConfig(num_rounds=n_rounds),
        strategy=strategy,
        client_resources={"num_cpus": client_cpus, "num_gpus": client_gpus},
    )
    log.info(
        "Simulation complete: best_round=%s best_loss=%.4f",
        strategy.best_round,
        strategy.best_loss,
    )
    return strategy


def run_simulation(
    *,
    n_clients: int = 3,
    n_rounds: int = 10,
    continuous: bool = False,
    delay: float = 0.0,
    stop_event: threading.Event | None = None,
    status: SimulationStatus | None = None,
    **kwargs: Any,
) -> SimulationStatus:
    stop_event = stop_event or threading.Event()
    status = status or SimulationStatus()
    status.running = True
    status.stop_requested = False
    status.round = 0
    status.total_rounds = n_rounds
    status.clients = n_clients
    status.continuous = continuous
    status.error = None
    status.started_at = time.time()
    status.finished_at = None

    def on_status(payload: dict[str, Any]) -> None:
        if payload.get("event") == "round_complete":
            status.round = int(payload["round"])
            status.metrics.append(payload)

    try:
        while not stop_event.is_set():
            status.cycle += 1
            status.round = 0
            simulate_corrector(
                n_clients=n_clients,
                n_rounds=n_rounds,
                status_callback=on_status,
                **kwargs,
            )
            if not continuous:
                break
            if delay > 0:
                stop_event.wait(delay)
    except Exception as exc:
        status.error = str(exc)
        log.exception("Simulation failed")
    finally:
        status.stop_requested = stop_event.is_set()
        status.running = False
        status.finished_at = time.time()
    return status


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run local new_fl simulation")
    parser.add_argument("--model", choices=["corrector", "both"], default="corrector")
    parser.add_argument("--rounds", type=int, default=10)
    parser.add_argument("--clients", type=int, default=3)
    parser.add_argument("--csv", default=str(DATA_PATH))
    parser.add_argument("--tokenizer", default=str(S2S_TOK_PATH))
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--max-len", type=int, default=100)
    parser.add_argument("--train-split", type=float, default=0.9)
    parser.add_argument("--client-cpus", type=float, default=1.0)
    parser.add_argument("--client-gpus", type=float, default=0.0)
    parser.add_argument(
        "--continuous",
        action="store_true",
        help="Run simulations repeatedly until interrupted",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.0,
        help="Seconds to wait between continuous simulation cycles",
    )
    return parser


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  [%(name)s]  %(levelname)s  %(message)s",
    )
    args = build_parser().parse_args()
    if args.model not in ("corrector", "both"):
        raise ValueError("new_fl supports model='corrector' or model='both'")
    run_simulation(
        n_clients=args.clients,
        n_rounds=args.rounds,
        continuous=args.continuous,
        delay=args.delay,
        csv_path=args.csv,
        tokenizer_path=args.tokenizer,
        batch_size=args.batch_size,
        epochs=args.epochs,
        lr=args.lr,
        max_len=args.max_len,
        train_split=args.train_split,
        client_cpus=args.client_cpus,
        client_gpus=args.client_gpus,
    )


if __name__ == "__main__":
    main()
