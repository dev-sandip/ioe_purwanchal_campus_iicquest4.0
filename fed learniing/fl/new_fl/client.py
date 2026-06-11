"""
fl/client.py

Flower FL Client for Nepali Grammar Correction.
Clients train NepaliSeq2SeqCorrector locally on their data
and send weights to server for aggregation.

Updated: Uses nepali_correction_best.pth model and NepaliCharTokenizer
"""

import sys
import logging
from pathlib import Path
from typing import Tuple, Dict, List

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
import flwr as fl
from flwr.common import NDArrays, Scalar

sys.path.append(str(Path(__file__).resolve().parent.parent))

from core.models import NepaliSeq2SeqCorrector
from core.tokenizer import NepaliCharTokenizer
from data_utils import load_pairs, build_correction_dataset, split_iid

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(name)s]  %(levelname)s  %(message)s"
)
log = logging.getLogger(__name__)


class NepaliCorrectionFlowerClient(fl.client.NumPyClient):
    """
    Flower NumPyClient for Nepali Seq2Seq Correction.
    
    Each client maintains a local NepaliSeq2SeqCorrector model,
    trains on local correction pairs, and communicates weights with server.
    """

    def __init__(
        self,
        model: NepaliSeq2SeqCorrector,
        train_loader: DataLoader,
        val_loader: DataLoader,
        device: torch.device,
        client_id: int = 0,
    ):
        """
        Initialize FL client.
        
        Args:
            model: NepaliSeq2SeqCorrector instance
            train_loader: DataLoader for local training data
            val_loader: DataLoader for local validation data
            device: torch.device (cuda/cpu)
            client_id: Client identifier for logging
        """
        self.model = model.to(device)
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.device = device
        self.client_id = client_id
        
        self.criterion = nn.CrossEntropyLoss(reduction="mean")
        self.optimizer = None  # Set during fit()
        
        log.info(
            f"[Client {client_id}] initialized  "
            f"train_size={len(train_loader.dataset)}  "
            f"val_size={len(val_loader.dataset)}"
        )

    def get_parameters(self, config: Dict) -> NDArrays:
        """
        Return model parameters as list of numpy arrays.
        Called by server to fetch weights.
        """
        return [val.cpu().numpy() for val in self.model.state_dict().values()]

    def set_parameters(self, parameters: NDArrays) -> None:
        """
        Set model parameters from list of numpy arrays.
        Called by server to push aggregated weights.
        """
        params_dict = zip(self.model.state_dict().keys(), parameters)
        state_dict = {k: torch.tensor(v) for k, v in params_dict}
        self.model.load_state_dict(state_dict, strict=True)

    def fit(
        self,
        parameters: NDArrays,
        config: Dict[str, float],
    ) -> Tuple[NDArrays, int, Dict]:
        """
        Local training round.
        
        Args:
            parameters: Aggregated weights from server
            config: Config with lr, epochs, batch_size from server
        
        Returns:
            (updated_weights, num_samples_used, metrics)
        """
        self.set_parameters(parameters)
        
        # Parse config
        lr = config.get("lr", 1e-4)
        epochs = config.get("epochs", 2)
        
        self.optimizer = torch.optim.Adam(self.model.parameters(), lr=lr)
        self.model.train()
        
        train_loss = 0.0
        num_samples = len(self.train_loader.dataset)
        
        for epoch in range(epochs):
            epoch_loss = 0.0
            for src, tgt in self.train_loader:
                src, tgt = src.to(self.device), tgt.to(self.device)
                
                self.optimizer.zero_grad()
                logits = self.model(src, tgt[:, :-1])  # exclude last token
                loss = self.criterion(
                    logits.reshape(-1, logits.size(-1)),
                    tgt[:, 1:].reshape(-1)  # exclude SOS
                )
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                self.optimizer.step()
                
                epoch_loss += loss.item() * src.size(0)
            
            epoch_loss /= num_samples
            train_loss = epoch_loss
            log.info(
                f"[Client {self.client_id}] Epoch {epoch+1}/{epochs}  "
                f"loss={train_loss:.4f}"
            )
        
        return self.get_parameters({}), num_samples, {"loss": train_loss}

    def evaluate(
        self,
        parameters: NDArrays,
        config: Dict[str, float],
    ) -> Tuple[float, int, Dict]:
        """
        Local validation round.
        
        Args:
            parameters: Aggregated weights from server
            config: Config dict from server
        
        Returns:
            (loss, num_samples_used, metrics)
        """
        self.set_parameters(parameters)
        self.model.eval()
        
        val_loss = 0.0
        num_samples = len(self.val_loader.dataset)
        
        with torch.no_grad():
            for src, tgt in self.val_loader:
                src, tgt = src.to(self.device), tgt.to(self.device)
                
                logits = self.model(src, tgt[:, :-1])
                loss = self.criterion(
                    logits.reshape(-1, logits.size(-1)),
                    tgt[:, 1:].reshape(-1)
                )
                val_loss += loss.item() * src.size(0)
        
        val_loss /= num_samples
        log.info(f"[Client {self.client_id}] Validation loss={val_loss:.4f}")
        
        return val_loss, num_samples, {"loss": val_loss}


def start_client(
    server_address: str = "localhost:8080",
    client_id: int = 0,
    csv_path: str = "data/nepali_correction_pairs.csv",
    tokenizer_path: str = "data/nepali_char_tokenizer.json",
    batch_size: int = 32,
    train_split: float = 0.8,
):
    """
    Start a Flower FL client for Nepali correction.
    
    Args:
        server_address: Server host:port
        client_id: Client identifier
        csv_path: Path to Nepali correction pairs CSV
        tokenizer_path: Path to saved NepaliCharTokenizer
        batch_size: Training batch size
        train_split: Train/val split ratio
    """
    log.info(f"Starting client {client_id} → {server_address}")
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log.info(f"Device: {device}")
    
    # Load tokenizer
    tokenizer = NepaliCharTokenizer.load(tokenizer_path)
    log.info(f"Tokenizer loaded: vocab_size={tokenizer.vocab_size}")
    
    # Load data
    df = load_pairs(csv_path)
    log.info(f"Loaded {len(df)} correction pairs from {csv_path}")
    
    # Build dataset
    dataset = build_correction_dataset(df, tokenizer, max_len=100)
    
    # Split into train/val
    train_size = int(len(dataset) * train_split)
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(
        dataset, [train_size, val_size]
    )
    
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=0,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
    )
    
    # Build model
    model = NepaliSeq2SeqCorrector(
        vocab_size=tokenizer.vocab_size,
        embed_dim=128,
        hidden_dim=128,
        enc_layers=2,
        dec_layers=2,
        ff_dim=512,
        num_heads=4,
        max_len=100,
        dropout=0.1,
    )
    log.info(f"Model created: {model.__class__.__name__}")
    
    # Create Flower client
    client = NepaliCorrectionFlowerClient(
        model=model,
        train_loader=train_loader,
        val_loader=val_loader,
        device=device,
        client_id=client_id,
    )
    
    # Connect to server
    fl.client.start_numpy_client(
        server_address=server_address,
        client=client,
    )


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Nepali Correction FL Client")
    parser.add_argument("--server", default="localhost:8080", help="Server address")
    parser.add_argument("--client-id", type=int, default=0, help="Client ID")
    parser.add_argument("--csv", default="data/nepali_correction_pairs.csv")
    parser.add_argument("--tokenizer", default="data/nepali_char_tokenizer.json")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--train-split", type=float, default=0.8)
    
    args = parser.parse_args()
    
    start_client(
        server_address=args.server,
        client_id=args.client_id,
        csv_path=args.csv,
        tokenizer_path=args.tokenizer,
        batch_size=args.batch_size,
        train_split=args.train_split,
    )