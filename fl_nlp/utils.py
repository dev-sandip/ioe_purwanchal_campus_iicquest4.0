import json
import torch

def load_vocab(path):
    with open(path, "r") as f:
        return json.load(f)

def encode_sentence(sentence, vocab):
    return [vocab.get(w, vocab["<UNK>"]) for w in sentence]

def pad_sequence(seq, max_len=20, pad_id=0):
    seq = seq[:max_len]
    return seq + [pad_id] * (max_len - len(seq))