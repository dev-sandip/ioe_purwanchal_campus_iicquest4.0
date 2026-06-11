"""
fl/main.py

Main entry point for Nepali Grammar Correction Federated Learning.
Provides CLI interface for running server or clients.

FIXED: Removed run_detector_server import (detector no longer exists)
"""

import argparse
import logging
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(name)s]  %(levelname)s  %(message)s"
)
log = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(
        description="Nepali Grammar Correction - Federated Learning",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:

  # Start server on port 8080 for 10 rounds
  python main.py server --port 8080 --rounds 10 --min-clients 2

  # Start client 0 connecting to localhost:8080
  python main.py client --server localhost:8080 --client-id 0

  # Start client 1 with custom batch size
  python main.py client --server localhost:8080 --client-id 1 \\
    --batch-size 64 --csv data/right_wrong.csv

  # Run local simulation without separate clients
  python main.py simulate --rounds 5 --clients 3

  # Run continuous simulation until Ctrl+C
  python main.py simulate --rounds 1 --clients 3 --continuous --delay 10
        """,
    )
    
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # ── Server subcommand ──────────────────────────────────────────────────
    server_parser = subparsers.add_parser(
        "server",
        help="Start Flower FL server",
    )
    server_parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Server bind address (default: 0.0.0.0)",
    )
    server_parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Server port (default: 8080)",
    )
    server_parser.add_argument(
        "--rounds",
        type=int,
        default=10,
        help="Number of FL rounds (default: 10)",
    )
    server_parser.add_argument(
        "--min-clients",
        type=int,
        default=2,
        help="Minimum clients per round (default: 2)",
    )
    server_parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Training batch size (default: 32)",
    )
    
    # ── Client subcommand ──────────────────────────────────────────────────
    client_parser = subparsers.add_parser(
        "client",
        help="Start Flower FL client",
    )
    client_parser.add_argument(
        "--server",
        default="localhost:8080",
        help="Server address host:port (default: localhost:8080)",
    )
    client_parser.add_argument(
        "--client-id",
        type=int,
        default=0,
        help="Client identifier (default: 0)",
    )
    client_parser.add_argument(
        "--csv",
        default="data/right_wrong.csv",
        help="Path to CSV with correction pairs (default: data/right_wrong.csv)",
    )
    client_parser.add_argument(
        "--tokenizer",
        default="models/nepali_correction_tokenizer.json",
        help="Path to tokenizer JSON (default: models/nepali_correction_tokenizer.json)",
    )
    client_parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Training batch size (default: 32)",
    )
    client_parser.add_argument(
        "--train-split",
        type=float,
        default=0.8,
        help="Train/val split ratio (default: 0.8)",
    )

    # ── Simulation subcommand ──────────────────────────────────────────────
    sim_parser = subparsers.add_parser(
        "simulate",
        help="Run local Flower simulation",
    )
    sim_parser.add_argument(
        "--model",
        choices=["corrector", "both"],
        default="corrector",
        help="Model to simulate (default: corrector; both aliases corrector)",
    )
    sim_parser.add_argument(
        "--rounds",
        type=int,
        default=10,
        help="Number of FL rounds per simulation cycle (default: 10)",
    )
    sim_parser.add_argument(
        "--clients",
        type=int,
        default=3,
        help="Number of virtual clients (default: 3)",
    )
    sim_parser.add_argument(
        "--csv",
        default="data/right_wrong.csv",
        help="Path to CSV with correction pairs (default: data/right_wrong.csv)",
    )
    sim_parser.add_argument(
        "--tokenizer",
        default="models/nepali_correction_tokenizer.json",
        help="Path to tokenizer JSON (default: models/nepali_correction_tokenizer.json)",
    )
    sim_parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Training batch size (default: 32)",
    )
    sim_parser.add_argument(
        "--epochs",
        type=int,
        default=2,
        help="Local epochs per FL round (default: 2)",
    )
    sim_parser.add_argument(
        "--lr",
        type=float,
        default=1e-4,
        help="Local learning rate (default: 1e-4)",
    )
    sim_parser.add_argument(
        "--max-len",
        type=int,
        default=100,
        help="Maximum correction sequence length (default: 100)",
    )
    sim_parser.add_argument(
        "--train-split",
        type=float,
        default=0.9,
        help="Train split ratio before validation split (default: 0.9)",
    )
    sim_parser.add_argument(
        "--client-cpus",
        type=float,
        default=1.0,
        help="CPU resources per virtual client (default: 1.0)",
    )
    sim_parser.add_argument(
        "--client-gpus",
        type=float,
        default=0.0,
        help="GPU resources per virtual client (default: 0.0)",
    )
    sim_parser.add_argument(
        "--continuous",
        action="store_true",
        help="Repeat simulation cycles until interrupted",
    )
    sim_parser.add_argument(
        "--delay",
        type=float,
        default=0.0,
        help="Seconds between continuous cycles (default: 0)",
    )
    
    args = parser.parse_args()
    
    if args.command == "server":
        log.info("Starting Flower FL Server for Nepali Grammar Correction")
        from server import run_corrector_server
        
        run_corrector_server(
            host=args.host,
            port=args.port,
            num_rounds=args.rounds,
            min_clients=args.min_clients,
            batch_size=args.batch_size,
        )
    
    elif args.command == "client":
        log.info(f"Starting Flower FL Client {args.client_id}")
        from client import start_client
        
        start_client(
            server_address=args.server,
            client_id=args.client_id,
            csv_path=args.csv,
            tokenizer_path=args.tokenizer,
            batch_size=args.batch_size,
            train_split=args.train_split,
        )

    elif args.command == "simulate":
        log.info("Starting local Flower simulation")
        from simulate import run_simulation

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
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
