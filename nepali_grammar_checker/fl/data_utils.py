import numpy as np
import pandas as pd
import torch
from torch.utils.data import TensorDataset
from core.tokenizer import CharTokenizer


def load_pairs(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, encoding="utf-8")
    df.columns = ["correct", "wrong"]
    df = df.dropna()
    df = df[df["correct"] != df["wrong"]].reset_index(drop=True)
    return df


def build_detection_dataset(
    df: pd.DataFrame,
    tokenizer: CharTokenizer,
    max_len: int = 30,
) -> TensorDataset:
    """Build word-level detection dataset from correction pairs."""
    df_correct = pd.DataFrame({"word": df["correct"].values, "label": 0})
    df_wrong   = pd.DataFrame({"word": df["wrong"].values,   "label": 1})
    df_all     = pd.concat([df_correct, df_wrong]).sample(frac=1, random_state=42)
    df_all     = df_all.reset_index(drop=True)

    X = np.array(
        [tokenizer.encode(w, max_len) for w in df_all["word"]], dtype=np.int64
    )
    y = df_all["label"].values.astype(np.float32)
    return TensorDataset(
        torch.tensor(X, dtype=torch.long),
        torch.tensor(y, dtype=torch.float32),
    )


def build_correction_dataset(
    df: pd.DataFrame,
    tokenizer: CharTokenizer,
    max_len: int = 30,
) -> TensorDataset:
    """Build seq2seq correction dataset."""
    src = np.array(
        [tokenizer.encode(w, max_len) for w in df["wrong"]], dtype=np.int64
    )
    tgt = np.array(
        [tokenizer.encode(w, max_len, add_sos=True, add_eos=True)
         for w in df["correct"]], dtype=np.int64
    )
    return TensorDataset(
        torch.tensor(src, dtype=torch.long),
        torch.tensor(tgt, dtype=torch.long),
    )


def split_iid(dataset: TensorDataset, n_clients: int) -> list[TensorDataset]:
    """Split dataset IID across n_clients."""
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
