import flwr as fl
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader

from model import WordBiLSTM
from utils import load_vocab
from dataset import NepaliDataset


# -------------------------
# LOAD VOCAB + MODEL
# -------------------------
vocab = load_vocab("nepali_tokenizer_vocab.json")
vocab_size = len(vocab)

model = WordBiLSTM(vocab_size)

# optional: load initial global model
try:
    model.load_state_dict(torch.load("nepali_grammar_checker.pth"))
    print("Loaded pretrained model")
except:
    print("No pretrained model found, starting fresh")


# -------------------------
# LOCAL CLIENT DATA
# (simulate local user data)
# -------------------------
local_data = [
    ([1, 2, 3, 4], [0, 0, 0, 0]),   # correct sentence
    ([1, 5, 3, 4], [0, 1, 0, 0]),   # error sentence
    ([2, 3, 4], [0, 0, 0]),
]


dataset = NepaliDataset(local_data)
loader = DataLoader(dataset, batch_size=2, shuffle=True)


# -------------------------
# FL CLIENT
# -------------------------
class NepaliFLClient(fl.client.NumPyClient):

    # send model weights to server
    def get_parameters(self, config):
        return [val.detach().cpu().numpy() for val in model.parameters()]

    # receive model weights from server
    def set_parameters(self, parameters):
        for param, new_param in zip(model.parameters(), parameters):
            param.data = torch.tensor(new_param)

    # LOCAL TRAINING (MOST IMPORTANT PART)
    def fit(self, parameters, config):
        self.set_parameters(parameters)

        model.train()

        optimizer = optim.Adam(model.parameters(), lr=0.001)
        loss_fn = nn.BCELoss()

        epochs = 1  # local epochs per round

        for _ in range(epochs):
            for x, y in loader:

                optimizer.zero_grad()

                # forward pass
                pred = model(x).float()

                # loss
                loss = loss_fn(pred, y.float())

                # backward pass
                loss.backward()
                optimizer.step()

        return self.get_parameters(config), len(loader), {}

    # evaluation on local data
    def evaluate(self, parameters, config):
        self.set_parameters(parameters)

        model.eval()
        loss_fn = nn.BCELoss()

        total_loss = 0

        with torch.no_grad():
            for x, y in loader:
                pred = model(x).float()
                loss = loss_fn(pred, y.float())
                total_loss += loss.item()

        return total_loss, len(loader), {"loss": total_loss}


# -------------------------
# START CLIENT
# -------------------------
import flwr as fl

fl.client.start_client(
    server_address="localhost:8080",
    client=NepaliFLClient().to_client(),
)