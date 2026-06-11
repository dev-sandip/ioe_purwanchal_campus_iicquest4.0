import numpy as np
import pandas as pd
import torch
from torch.utils.data import TensorDataset
from core.tokenizer import NepaliCharTokenizer


def load_pairs(csv_path: str) -> pd.DataFrame:
    """
    Load Nepali correction pairs from CSV.
    
    Expected format: CSV with columns [correct, wrong]
    
    Args:
        csv_path: Path to CSV file with Nepali word pairs
    
    Returns:
        DataFrame with 'correct' and 'wrong' columns, cleaned
    """
    df = pd.read_csv(csv_path, encoding="utf-8")
    df.columns = ["correct", "wrong"]
    df = df.dropna()
    df = df[df["correct"] != df["wrong"]].reset_index(drop=True)
    return df


def build_correction_dataset(
    df: pd.DataFrame,
    tokenizer: NepaliCharTokenizer,
    max_len: int = 100,
) -> TensorDataset:
    """
    Build seq2seq correction dataset for Nepali grammar correction.
    
    Encodes:
      - src: wrong words (noisy Nepali)
      - tgt: correct words with SOS/EOS tokens
    
    Args:
        df: DataFrame with 'correct' and 'wrong' columns
        tokenizer: NepaliCharTokenizer instance
        max_len: Maximum sequence length (default 100)
    
    Returns:
        TensorDataset with (src_ids, tgt_ids) tensors
    """
    src = np.array(
        [tokenizer.encode(w, max_len) for w in df["wrong"]],
        dtype=np.int64
    )
    tgt = np.array(
        [tokenizer.encode(
            w,
            max_len,
            add_sos=True,
            add_eos=True
        ) for w in df["correct"]],
        dtype=np.int64
    )
    
    return TensorDataset(
        torch.tensor(src, dtype=torch.long),
        torch.tensor(tgt, dtype=torch.long),
    )


def split_iid(dataset: TensorDataset, n_clients: int) -> list[TensorDataset]:
    """
    Split dataset IID (independently & identically distributed) across n_clients.
    
    Useful for federated learning to simulate multiple local datasets.
    
    Args:
        dataset: TensorDataset to split
        n_clients: Number of clients
    
    Returns:
        List of n_clients TensorDataset objects
    """
    total  = len(dataset)
    size   = total // n_clients
    splits = []
    
    for i in range(n_clients):
        start = i * size
        end   = start + size if i < n_clients - 1 else total
        indices = list(range(start, end))
        tensors = [t[indices] for t in dataset.tensors]
        splits.append(TensorDataset(*tensors))
    
    return splits