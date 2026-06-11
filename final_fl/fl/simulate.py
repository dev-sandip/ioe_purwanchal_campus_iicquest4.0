"""
Run full FL simulation locally.

Usage:
    python -m fl.simulate --model corrector --rounds 10 --clients 3
"""
import argparse
import torch
import flwr as fl
from pathlib import Path
from torch.utils.data import random_split

from core.models import CharTransformerDetector, NepaliCorrectionModel
from core.tokenizer import CharTokenizer
from fl.client import DetectorClient, CorrectorClient
from fl.data_utils import load_pairs, build_detection_dataset, build_correction_dataset, split_iid
from fl.strategy import SaveBestFedAvg


DATA_PATH    = "data/right_wrong.csv"
DET_TOK_PATH = "data/detect_char_tokenizer.json"
S2S_TOK_PATH = "models/nepali_correction_tokenizer.json"
DET_PTH      = "models/detector_best.pth"
S2S_PTH      = "models/nepali_correction_best.pth"


def simulate_detector(n_clients: int, n_rounds: int):
    device  = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = CharTokenizer.load(DET_TOK_PATH)

    print("Loading data...")
    df      = load_pairs(DATA_PATH)
    dataset = build_detection_dataset(df, tokenizer)

    # 10% held-out global val
    val_size   = int(0.10 * len(dataset))
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])

    client_splits = split_iid(train_ds.dataset, n_clients)

    def client_fn(cid: str):
        cid_int = int(cid)
        model   = CharTransformerDetector(
            vocab_size=tokenizer.vocab_size,
            embed_dim=64, num_heads=4, num_layers=3,
            ff_dim=256, max_len=30, dropout=0.3
        ).to(device)
        # Load existing weights as starting point
        if Path(DET_PTH).exists():
            model.load_state_dict(torch.load(DET_PTH, map_location=device))
        return DetectorClient(
            model, client_splits[cid_int], val_ds.dataset,
            device, cid_int
        )

    strategy = SaveBestFedAvg(
        model_name="detector",
        fraction_fit=1.0,
        fraction_evaluate=1.0,
        min_fit_clients=n_clients,
        min_evaluate_clients=n_clients,
        min_available_clients=n_clients,
        on_fit_config_fn=lambda r: {"lr": 3e-4, "epochs": 1, "batch_size": 64},
    )

    print(f"Starting detector FL: {n_clients} clients, {n_rounds} rounds")
    fl.simulation.start_simulation(
        client_fn=client_fn,
        num_clients=n_clients,
        config=fl.server.ServerConfig(num_rounds=n_rounds),
        strategy=strategy,
        client_resources={"num_cpus": 1, "num_gpus": 0.0},
    )
    print(f"Best round: {strategy.best_round} | Best loss: {strategy.best_loss:.4f}")


def simulate_corrector(n_clients: int, n_rounds: int):
    device    = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = CharTokenizer.load(S2S_TOK_PATH)
    pad_idx   = tokenizer.char2idx[CharTokenizer.PAD]

    print("Loading data...")
    df      = load_pairs(DATA_PATH)
    dataset = build_correction_dataset(df, tokenizer, max_len=100)

    val_size   = int(0.10 * len(dataset))
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])

    client_splits = split_iid(train_ds.dataset, n_clients)

    def client_fn(cid: str):
        cid_int = int(cid)
        model   = NepaliCorrectionModel(
            vocab_size=tokenizer.vocab_size,
            embed_dim=64, hidden_dim=128,
            num_layers=2, dropout=0.2
        ).to(device)
        if Path(S2S_PTH).exists():
            model.load_state_dict(torch.load(S2S_PTH, map_location=device))
        return CorrectorClient(
            model, client_splits[cid_int], val_ds.dataset,
            device, pad_idx, cid_int
        )

    strategy = SaveBestFedAvg(
        model_name="corrector",
        fraction_fit=1.0,
        fraction_evaluate=1.0,
        min_fit_clients=n_clients,
        min_evaluate_clients=n_clients,
        min_available_clients=n_clients,
        on_fit_config_fn=lambda r: {"lr": 3e-4, "epochs": 1, "batch_size": 128},
    )

    print(f"Starting corrector FL: {n_clients} clients, {n_rounds} rounds")
    fl.simulation.start_simulation(
        client_fn=client_fn,
        num_clients=n_clients,
        config=fl.server.ServerConfig(num_rounds=n_rounds),
        strategy=strategy,
        client_resources={"num_cpus": 1, "num_gpus": 0.0},
    )
    print(f"Best round: {strategy.best_round} | Best loss: {strategy.best_loss:.4f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model",   choices=["corrector", "both"], default="corrector")
    parser.add_argument("--rounds",  type=int, default=10)
    parser.add_argument("--clients", type=int, default=3)
    args = parser.parse_args()

    if args.model in ("corrector", "both"):
        simulate_corrector(args.clients, args.rounds)
