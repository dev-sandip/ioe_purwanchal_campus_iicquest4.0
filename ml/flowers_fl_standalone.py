"""
Federated Learning with Flowers Framework
For Nepali Grammar Checking System

This script demonstrates:
1. Multi-client federated learning setup
2. FedAvg algorithm implementation
3. Privacy-preserving training
4. Model aggregation across clients
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import numpy as np
import flwr as fl
from typing import List, Tuple, Dict
import json
from pathlib import Path


# ============================================================================
# 1. MODEL DEFINITION
# ============================================================================

class NepaliGrammarChecker(nn.Module):
    """
    BiLSTM-based model for Nepali grammar checking
    
    Architecture:
        Input (B, T) indices
        ↓
        Embedding (B, T, E)
        ↓
        BiLSTM (B, T, 2H)
        ↓
        Attention Pooling (B, 2H)
        ↓
        Classification Head (B, 1)
        ↓
        Output (B,) binary prediction
    """
    
    def __init__(self, vocab_size: int, embedding_dim: int = 64, 
                 hidden_dim: int = 128, dropout: float = 0.3):
        super().__init__()
        
        # Token embedding
        self.embedding = nn.Embedding(vocab_size, embedding_dim, padding_idx=0)
        
        # Bidirectional LSTM
        self.lstm = nn.LSTM(
            embedding_dim,
            hidden_dim,
            bidirectional=True,
            batch_first=True,
            dropout=dropout if dropout > 0 else 0
        )
        
        # Attention mechanism
        self.attention = nn.Linear(hidden_dim * 2, 1)
        
        # Classification layers
        self.fc1 = nn.Linear(hidden_dim * 2, 64)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(dropout)
        self.fc2 = nn.Linear(64, 1)
        self.sigmoid = nn.Sigmoid()
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass
        
        Args:
            x: (batch_size, seq_len) - token indices
            
        Returns:
            output: (batch_size,) - probability of correct grammar [0, 1]
        """
        # Embedding: (B, T) → (B, T, E)
        emb = self.embedding(x)
        
        # BiLSTM: (B, T, E) → (B, T, 2H)
        lstm_out, _ = self.lstm(emb)
        
        # Attention-based pooling: (B, T, 2H) → (B, 2H)
        attn_weights = self.attention(lstm_out)  # (B, T, 1)
        attn_weights = torch.softmax(attn_weights, dim=1)  # Normalize
        context = torch.sum(lstm_out * attn_weights, dim=1)  # (B, 2H)
        
        # Classification: (B, 2H) → (B, 1) → (B,)
        x = self.fc1(context)
        x = self.relu(x)
        x = self.dropout(x)
        logits = self.fc2(x)
        output = self.sigmoid(logits)
        
        return output.squeeze(-1)


# ============================================================================
# 2. FEDERATED LEARNING CLIENT
# ============================================================================

class FederatedGrammarCheckerClient(fl.client.NumPyClient):
    """
    Federated Learning Client for Nepali Grammar Checking
    
    Implements the Flower client interface for distributed training.
    Each client:
    1. Receives global model from server
    2. Trains on local data
    3. Sends back trained weights
    4. Server averages all client weights
    """
    
    def __init__(
        self,
        model: nn.Module,
        X_train: torch.Tensor,
        y_train: torch.Tensor,
        X_test: torch.Tensor,
        y_test: torch.Tensor,
        device: torch.device,
        client_id: int = 0
    ):
        """
        Initialize federated client
        
        Args:
            model: PyTorch model
            X_train: Training indices (N_train, seq_len)
            y_train: Training labels (N_train,)
            X_test: Test indices (N_test, seq_len)
            y_test: Test labels (N_test,)
            device: torch.device
            client_id: Client identifier for logging
        """
        self.model = model
        self.X_train = X_train
        self.y_train = y_train
        self.X_test = X_test
        self.y_test = y_test
        self.device = device
        self.client_id = client_id
        self.criterion = nn.BCELoss()
    
    def get_parameters(self, config: Dict) -> List[np.ndarray]:
        """
        Extract model parameters as NumPy arrays
        
        Called by server to get current model weights
        
        Returns:
            List of NumPy arrays representing model parameters
        """
        return [val.cpu().numpy() for _, val in self.model.state_dict().items()]
    
    def set_parameters(self, parameters: List[np.ndarray]):
        """
        Update model parameters from NumPy arrays
        
        Called by server to set global model weights
        
        Args:
            parameters: List of NumPy arrays with new weights
        """
        params_dict = zip(self.model.state_dict().keys(), parameters)
        state_dict = {k: torch.tensor(v, device=self.device) 
                     for k, v in params_dict}
        self.model.load_state_dict(state_dict, strict=True)
    
    def fit(self, parameters: List[np.ndarray], 
            config: Dict) -> Tuple[List[np.ndarray], int, Dict]:
        """
        Train model on local data
        
        This is the core of federated learning:
        1. Receive global weights from server
        2. Train on local data
        3. Send back updated weights
        
        Args:
            parameters: Global model weights from server
            config: Configuration with hyperparameters
                   {'epochs': int, 'batch_size': int, 'lr': float}
        
        Returns:
            (updated_params, num_samples, metrics_dict)
        """
        # Update model with global weights
        self.set_parameters(parameters)
        
        # Extract config
        epochs = config.get('epochs', 1)
        batch_size = config.get('batch_size', 4)
        learning_rate = config.get('lr', 0.001)
        
        # Setup local training
        self.model.train()
        optimizer = optim.Adam(self.model.parameters(), lr=learning_rate)
        
        train_dataset = TensorDataset(self.X_train, self.y_train)
        train_loader = DataLoader(
            train_dataset,
            batch_size=batch_size,
            shuffle=True
        )
        
        # Local training loop
        total_loss = 0
        for epoch in range(epochs):
            epoch_loss = 0
            for batch_x, batch_y in train_loader:
                batch_x = batch_x.to(self.device)
                batch_y = batch_y.to(self.device)
                
                # Forward pass
                optimizer.zero_grad()
                outputs = self.model(batch_x)
                loss = self.criterion(outputs, batch_y)
                
                # Backward pass
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                optimizer.step()
                
                epoch_loss += loss.item()
            
            total_loss = epoch_loss / len(train_loader)
        
        # Return updated parameters
        return self.get_parameters(config), len(self.X_train), {}
    
    def evaluate(
        self,
        parameters: List[np.ndarray],
        config: Dict
    ) -> Tuple[float, int, Dict]:
        """
        Evaluate model on local test data
        
        Args:
            parameters: Model weights to evaluate
            config: Configuration dict
        
        Returns:
            (loss, num_samples, metrics_dict with accuracy)
        """
        # Update model
        self.set_parameters(parameters)
        
        # Evaluate
        self.model.eval()
        with torch.no_grad():
            X_test_device = self.X_test.to(self.device)
            y_test_device = self.y_test.to(self.device)
            
            outputs = self.model(X_test_device)
            loss = self.criterion(outputs, y_test_device).item()
            
            preds = (outputs > 0.5).float()
            accuracy = (preds == y_test_device).float().mean().item()
        
        return loss, len(self.X_test), {'accuracy': accuracy}


# ============================================================================
# 3. FEDERATED LEARNING STRATEGY
# ============================================================================

class FederatedLearningStrategy:
    """
    Orchestrates federated learning with FedAvg algorithm
    """
    
    def __init__(
        self,
        vocab_size: int,
        num_clients: int = 3,
        num_rounds: int = 5,
        device: str = 'cpu'
    ):
        self.vocab_size = vocab_size
        self.num_clients = num_clients
        self.num_rounds = num_rounds
        self.device = torch.device(device)
        self.history = {
            'round': [],
            'client_losses': [],
            'client_accuracies': [],
            'global_loss': [],
            'global_accuracy': []
        }
    
    def initialize_global_model(self) -> nn.Module:
        """Initialize global model for server"""
        return NepaliGrammarChecker(
            vocab_size=self.vocab_size,
            embedding_dim=64,
            hidden_dim=128,
            dropout=0.3
        ).to(self.device)
    
    def create_client_model(self) -> nn.Module:
        """Create fresh model for each client"""
        return NepaliGrammarChecker(
            vocab_size=self.vocab_size,
            embedding_dim=64,
            hidden_dim=128,
            dropout=0.3
        ).to(self.device)
    
    def federated_average(
        self,
        client_weights: List[List[np.ndarray]],
        client_sizes: List[int]
    ) -> List[np.ndarray]:
        """
        FedAvg Algorithm: Average weights from all clients
        
        FedAvg formula:
            w_new = (1 / sum(n_k)) * sum(n_k * w_k)
            
        where:
            n_k = number of samples on client k
            w_k = weights on client k
        
        This weights the average by local data size (important!)
        
        Args:
            client_weights: List of weight lists from each client
            client_sizes: Number of samples on each client
        
        Returns:
            Averaged weights
        """
        total_size = sum(client_sizes)
        
        # Initialize averaged weights
        averaged_weights = [
            np.zeros_like(weights[0]) 
            for weights in client_weights
        ]
        
        # Compute weighted average
        for i, weights in enumerate(client_weights):
            weight = client_sizes[i] / total_size
            for j, w in enumerate(weights):
                averaged_weights[j] += weight * w
        
        return averaged_weights
    
    def run_federated_learning_simulation(
        self,
        clients_data: List[Tuple[torch.Tensor, torch.Tensor]],
        test_data: Tuple[torch.Tensor, torch.Tensor],
        config: Dict = None
    ):
        """
        Simulate federated learning
        
        Args:
            clients_data: List of (X_train, y_train) for each client
            test_data: (X_test, y_test) for evaluation
            config: Training config with epochs, batch_size, lr
        """
        if config is None:
            config = {
                'epochs': 2,
                'batch_size': 4,
                'lr': 0.001
            }
        
        X_test, y_test = test_data
        
        print("\n" + "="*70)
        print(f"FEDERATED LEARNING SIMULATION")
        print("="*70)
        print(f"Clients: {self.num_clients}")
        print(f"Rounds: {self.num_rounds}")
        print(f"Algorithm: FedAvg (Federated Averaging)")
        print("="*70 + "\n")
        
        # Initialize global model
        global_model = self.initialize_global_model()
        
        # Run FL rounds
        for round_num in range(1, self.num_rounds + 1):
            print(f"\n--- ROUND {round_num}/{self.num_rounds} ---\n")
            
            client_weights = []
            client_sizes = []
            client_losses = []
            client_accuracies = []
            
            # Client training phase
            for client_id in range(self.num_clients):
                print(f"  Client {client_id + 1}: ", end='')
                
                # Create client
                client_model = self.create_client_model()
                X_train, y_train = clients_data[client_id]
                
                client = FederatedGrammarCheckerClient(
                    client_model,
                    X_train,
                    y_train,
                    X_test,
                    y_test,
                    self.device,
                    client_id
                )
                
                # Get global weights to client
                global_params = [
                    val.cpu().numpy() 
                    for _, val in global_model.state_dict().items()
                ]
                
                # Client trains locally
                new_params, num_samples, _ = client.fit(global_params, config)
                
                # Client evaluation
                loss, _, metrics = client.evaluate(new_params, config)
                accuracy = metrics['accuracy']
                
                client_weights.append(new_params)
                client_sizes.append(num_samples)
                client_losses.append(loss)
                client_accuracies.append(accuracy)
                
                print(f"Loss={loss:.4f}, Acc={accuracy:.4f}")
            
            # Server aggregation (FedAvg)
            print(f"\n  Server: Aggregating {self.num_clients} client models...")
            averaged_weights = self.federated_average(
                client_weights,
                client_sizes
            )
            
            # Update global model
            params_dict = zip(
                global_model.state_dict().keys(),
                averaged_weights
            )
            state_dict = {
                k: torch.tensor(v, device=self.device)
                for k, v in params_dict
            }
            global_model.load_state_dict(state_dict, strict=True)
            
            # Evaluate global model
            global_model.eval()
            with torch.no_grad():
                X_test_device = X_test.to(self.device)
                y_test_device = y_test.to(self.device)
                
                outputs = global_model(X_test_device)
                criterion = nn.BCELoss()
                global_loss = criterion(outputs, y_test_device).item()
                
                preds = (outputs > 0.5).float()
                global_accuracy = (preds == y_test_device).float().mean().item()
            
            # Log results
            print(f"\n  Global Model: Loss={global_loss:.4f}, Acc={global_accuracy:.4f}")
            print(f"  Avg Client Accuracy: {np.mean(client_accuracies):.4f}")
            
            self.history['round'].append(round_num)
            self.history['client_losses'].append(np.mean(client_losses))
            self.history['client_accuracies'].append(np.mean(client_accuracies))
            self.history['global_loss'].append(global_loss)
            self.history['global_accuracy'].append(global_accuracy)
        
        print("\n" + "="*70)
        print("✓ FEDERATED LEARNING COMPLETED")
        print("="*70 + "\n")
        
        return global_model
    
    def print_summary(self):
        """Print federated learning summary"""
        print("\nFEDERATED LEARNING SUMMARY")
        print("="*70)
        print(f"Total Rounds: {len(self.history['round'])}")
        
        if self.history['round']:
            final_acc = self.history['global_accuracy'][-1]
            initial_acc = self.history['global_accuracy'][0]
            improvement = final_acc - initial_acc
            
            print(f"Initial Global Accuracy: {initial_acc:.4f}")
            print(f"Final Global Accuracy: {final_acc:.4f}")
            print(f"Improvement: {improvement:.4f} (+{improvement*100:.2f}%)")
            print(f"\nBest Accuracy: {max(self.history['global_accuracy']):.4f}")
        
        print("="*70 + "\n")


# ============================================================================
# 4. EXAMPLE USAGE
# ============================================================================

if __name__ == "__main__":
    print("\n" + "="*70)
    print("FEDERATED LEARNING EXAMPLE - Nepali Grammar Checking")
    print("="*70 + "\n")
    
    # Setup
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Device: {device}\n")
    
    # Create example data (in practice, would come from multiple sources)
    np.random.seed(42)
    torch.manual_seed(42)
    
    vocab_size = 100
    seq_len = 20
    num_samples = 12
    
    # Create dummy data
    X = torch.randint(0, vocab_size, (num_samples, seq_len), dtype=torch.long)
    y = torch.randint(0, 2, (num_samples,), dtype=torch.float32)
    
    # Split for clients and test
    X_clients = torch.split(X[:9], 3)
    y_clients = torch.split(y[:9], 3)
    X_test = X[9:]
    y_test = y[9:]
    
    clients_data = list(zip(X_clients, y_clients))
    test_data = (X_test, y_test)
    
    print(f"Number of clients: 3")
    print(f"Samples per client: 3")
    print(f"Test samples: 3")
    print(f"Vocabulary size: {vocab_size}")
    print(f"Sequence length: {seq_len}\n")
    
    # Initialize FL strategy
    fl_strategy = FederatedLearningStrategy(
        vocab_size=vocab_size,
        num_clients=3,
        num_rounds=5,
        device=device
    )
    
    # Run federated learning
    global_model = fl_strategy.run_federated_learning_simulation(
        clients_data,
        test_data,
        config={'epochs': 2, 'batch_size': 2, 'lr': 0.001}
    )
    
    # Print summary
    fl_strategy.print_summary()
    
    # Save model
    torch.save(global_model.state_dict(), 'fl_global_model.pth')
    print("✓ Global model saved to 'fl_global_model.pth'")