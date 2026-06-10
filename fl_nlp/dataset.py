import torch
from torch.utils.data import Dataset

class NepaliDataset(Dataset):
    def __init__(self, data):
        """
        data = [
            (["म", "विद्यालय", "जान्छु"], [0,0,0]),
            (["म", "विध्यालय", "जान्छु"], [0,1,0])
        ]
        """
        self.data = data

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        x, y = self.data[idx]

        return torch.tensor(x), torch.tensor(y)