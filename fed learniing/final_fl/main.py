"""
fl/main.py

Main entry point for Nepali Grammar Correction Federated Learning.
Provides CLI interface for running server or clients.
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
  python fl/main.py server --port 8080 --rounds 10 --min-clients 2

  # Start client 0 connecting to localhost:8080
  python fl/main.py client --server localhost:8080 --client-id 0

  # Start client 1 with custom batch size
  python fl/main.py client --server localhost:8080 --client-id 1 \\
    --batch-size 64 --csv data/right_wrong.csv
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
    
    args = parser.parse_args()
    
    if args.command == "server":
        log.info("Starting Flower FL Server for Nepali Grammar Correction")
        from new_fl.server import run_corrector_server
        
        run_corrector_server(
            host=args.host,
            port=args.port,
            num_rounds=args.rounds,
            min_clients=args.min_clients,
            batch_size=args.batch_size,
        )
    
    elif args.command == "client":
        log.info(f"Starting Flower FL Client {args.client_id}")
        from new_fl.client import start_client
        
        start_client(
            server_address=args.server,
            client_id=args.client_id,
            csv_path=args.csv,
            tokenizer_path=args.tokenizer,
            batch_size=args.batch_size,
            train_split=args.train_split,
        )
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
