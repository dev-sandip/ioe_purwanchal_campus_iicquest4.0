import sys
from pathlib import Path
# Add parent directory to sys.path so we can import from core/ even when run directly as python fl/client.py
sys.path.append(str(Path(__file__).resolve().parent.parent))

import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import flwr as fl
from torch.utils.data import DataLoader, TensorDataset
from collections import OrderedDict

from core.models import CharTransformerDetector, Seq2SeqCorrector


class DetectorClient(fl.client.NumPyClient):
    """FL client for the detection model."""

    def __init__(
        self,
        model: CharTransformerDetector,
        train_dataset: TensorDataset,
        val_dataset: TensorDataset,
        device: torch.device,
        client_id: int = 0,
    ):
        self.model      = model
        self.train_ds   = train_dataset
        self.val_ds     = val_dataset
        self.device     = device
        self.client_id  = client_id
        self.criterion  = nn.BCELoss()

    def get_parameters(self, config):
        return [val.cpu().numpy() for val in self.model.state_dict().values()]

    def set_parameters(self, parameters):
        state_dict = OrderedDict(
            {k: torch.tensor(v, device=self.device)
             for k, v in zip(self.model.state_dict().keys(), parameters)}
        )
        self.model.load_state_dict(state_dict, strict=True)

    def fit(self, parameters, config):
        self.set_parameters(parameters)
        lr         = config.get("lr", 3e-4)
        epochs     = config.get("epochs", 1)
        batch_size = config.get("batch_size", 64)

        loader    = DataLoader(self.train_ds, batch_size=batch_size, shuffle=True)
        optimizer = optim.Adam(self.model.parameters(), lr=lr, weight_decay=1e-4)

        self.model.train()
        for _ in range(epochs):
            for bx, by in loader:
                bx, by = bx.to(self.device), by.to(self.device)
                optimizer.zero_grad()
                loss = self.criterion(self.model(bx), by)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                optimizer.step()

        return self.get_parameters(config), len(self.train_ds), {}

    def evaluate(self, parameters, config):
        self.set_parameters(parameters)
        loader = DataLoader(self.val_ds, batch_size=64, shuffle=False)
        self.model.eval()
        total_loss, correct, total = 0.0, 0, 0
        with torch.no_grad():
            for bx, by in loader:
                bx, by   = bx.to(self.device), by.to(self.device)
                preds    = self.model(bx)
                total_loss += self.criterion(preds, by).item()
                correct  += ((preds > 0.5).float() == by).sum().item()
                total    += by.size(0)
        accuracy = correct / total
        return total_loss / len(loader), total, {"accuracy": accuracy}


class CorrectorClient(fl.client.NumPyClient):
    """FL client for the seq2seq correction model."""

    def __init__(
        self,
        model: Seq2SeqCorrector,
        train_dataset: TensorDataset,
        val_dataset: TensorDataset,
        device: torch.device,
        pad_idx: int,
        client_id: int = 0,
    ):
        self.model     = model
        self.train_ds  = train_dataset
        self.val_ds    = val_dataset
        self.device    = device
        self.pad_idx   = pad_idx
        self.client_id = client_id
        self.criterion = nn.CrossEntropyLoss(ignore_index=pad_idx)

    def get_parameters(self, config):
        return [val.cpu().numpy() for val in self.model.state_dict().values()]

    def set_parameters(self, parameters):
        state_dict = OrderedDict(
            {k: torch.tensor(v, device=self.device)
             for k, v in zip(self.model.state_dict().keys(), parameters)}
        )
        self.model.load_state_dict(state_dict, strict=True)

    def fit(self, parameters, config):
        self.set_parameters(parameters)
        lr         = config.get("lr", 3e-4)
        epochs     = config.get("epochs", 1)
        batch_size = config.get("batch_size", 128)

        loader    = DataLoader(self.train_ds, batch_size=batch_size, shuffle=True)
        optimizer = optim.Adam(self.model.parameters(), lr=lr, weight_decay=1e-5)

        self.model.train()
        for _ in range(epochs):
            for src_b, tgt_b in loader:
                src_b, tgt_b = src_b.to(self.device), tgt_b.to(self.device)
                optimizer.zero_grad()
                out  = self.model(src_b, tgt_b, teacher_forcing_ratio=0.5)
                loss = self.criterion(
                    out[:, 1:].reshape(-1, self.model.vocab_size),
                    tgt_b[:, 1:].reshape(-1),
                )
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                optimizer.step()

        return self.get_parameters(config), len(self.train_ds), {}

    def evaluate(self, parameters, config):
        self.set_parameters(parameters)
        loader = DataLoader(self.val_ds, batch_size=128, shuffle=False)
        self.model.eval()
        total_loss, correct_w, total_w = 0.0, 0, 0
        with torch.no_grad():
            for src_b, tgt_b in loader:
                src_b, tgt_b = src_b.to(self.device), tgt_b.to(self.device)
                out          = self.model(src_b, tgt_b, teacher_forcing_ratio=0.0)
                total_loss  += self.criterion(
                    out[:, 1:].reshape(-1, self.model.vocab_size),
                    tgt_b[:, 1:].reshape(-1),
                ).item()
                pred_ids  = out[:, 1:].argmax(dim=-1)
                tgt_ids   = tgt_b[:, 1:]
                mask      = tgt_ids != self.pad_idx
                correct_w += ((pred_ids == tgt_ids) | ~mask).all(dim=1).sum().item()
                total_w   += src_b.size(0)
        word_acc = correct_w / total_w if total_w else 0
        return total_loss / len(loader), total_w, {"word_accuracy": word_acc}


def main():
    import argparse
    from fl.data_utils import load_pairs, build_detection_dataset, build_correction_dataset, split_iid
    from core.tokenizer import CharTokenizer
    from torch.utils.data import random_split
    import os

    parser = argparse.ArgumentParser(description="Flower FL Client")
    parser.add_argument("--model", type=str, choices=["detector", "corrector"], default="detector")
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--client-id", type=int, default=0)
    parser.add_argument("--total-clients", type=int, default=2)
    parser.add_argument("--data-path", type=str, default="data/right_wrong.csv")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Set default port if not provided
    port = args.port if args.port is not None else (8080 if args.model == "detector" else 8081)
    server_address = f"{args.host}:{port}"

    # Determine tokenizers and dataset path
    det_tok_path = "data/detect_char_tokenizer.json"
    s2s_tok_path = "data/seq2seq_char_tokenizer.json"
    
    # Check if they exist or check root directories
    if not os.path.exists(det_tok_path):
        # Fallback
        det_tok_path = "../data/detect_char_tokenizer.json"
    if not os.path.exists(s2s_tok_path):
        s2s_tok_path = "../data/seq2seq_char_tokenizer.json"
        
    data_path = args.data_path
    if not os.path.exists(data_path):
        data_path = "../" + data_path

    # Generate dummy data if no dataset is present for testing local FL runs
    if not os.path.exists(data_path):
        os.makedirs(os.path.dirname(data_path), exist_ok=True)
        print(f"No dataset found at {data_path}, creating a dummy right_wrong.csv for simulation...")
        with open(data_path, "w", encoding="utf-8") as f:
            f.write("correct,wrong\n")
            f.write("घर,घरर\n")
            f.write("नेपाल,नेपालल\n")
            f.write("कलम,कलमम\n")
            f.write("किताब,किताबब\n")

    if args.model == "detector":
        if not os.path.exists(det_tok_path):
            raise FileNotFoundError(f"Tokenizer not found at {det_tok_path}")
        tokenizer = CharTokenizer.load(det_tok_path)
        df = load_pairs(data_path)
        dataset = build_detection_dataset(df, tokenizer)
        
        val_size = int(0.10 * len(dataset))
        train_size = len(dataset) - val_size
        train_ds, val_ds = random_split(dataset, [train_size, val_size])
        
        client_splits = split_iid(train_ds.dataset, args.total_clients)
        client_train_ds = client_splits[args.client_id]
        
        model = CharTransformerDetector(
            vocab_size=tokenizer.vocab_size,
            embed_dim=64, num_heads=4, num_layers=3,
            ff_dim=256, max_len=30, dropout=0.3
        ).to(device)
        
        client = DetectorClient(model, client_train_ds, val_ds.dataset, device, args.client_id)
        
    else: # corrector
        if not os.path.exists(s2s_tok_path) and os.path.exists(det_tok_path):
            s2s_tok_path = det_tok_path
            
        if not os.path.exists(s2s_tok_path):
            raise FileNotFoundError(f"Tokenizer not found at {s2s_tok_path}")
            
        tokenizer = CharTokenizer.load(s2s_tok_path)
        pad_idx = tokenizer.char2idx[CharTokenizer.PAD]
        
        df = load_pairs(data_path)
        dataset = build_correction_dataset(df, tokenizer)
        
        val_size = int(0.10 * len(dataset))
        train_size = len(dataset) - val_size
        train_ds, val_ds = random_split(dataset, [train_size, val_size])
        
        client_splits = split_iid(train_ds.dataset, args.total_clients)
        client_train_ds = client_splits[args.client_id]
        
        model = Seq2SeqCorrector(
            vocab_size=tokenizer.vocab_size,
            embed_dim=128, hidden_dim=128,
            enc_layers=3, dropout=0.1
        ).to(device)
        
        client = CorrectorClient(model, client_train_ds, val_ds.dataset, device, pad_idx, args.client_id)

    print(f"Connecting to FL server at {server_address}...")
    fl.client.start_numpy_client(server_address=server_address, client=client)


if __name__ == "__main__":
    main()

