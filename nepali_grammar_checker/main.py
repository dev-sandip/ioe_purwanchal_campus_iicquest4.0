import argparse
import os
import sys
import multiprocessing
import uvicorn

# Append current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def run_api(host, port):
    print(f"\n[Hosted API] Starting server on http://{host}:{port}...")
    uvicorn.run("api.main:app", host=host, port=port, reload=False)

def run_fl(host, port_det, port_cor, port_api, model):
    print(f"\n[FL Server] Starting local Federated Learning Server & ONNX Bridge...")
    # Dynamically import and run fl/server.py's runners
    from fl.server import run_detector_server, run_corrector_server, api_app
    import threading
    
    # Start the local bridge API in a background thread
    def start_bridge_api():
        print(f"[Bridge API] Starting on http://{host}:{port_api}...")
        uvicorn.run(api_app, host=host, port=port_api, log_level="warning")

    bridge_thread = threading.Thread(target=start_bridge_api, daemon=True)
    bridge_thread.start()

    if model == "detector":
        run_detector_server(host, port_det)
    elif model == "corrector":
        run_corrector_server(host, port_cor)
    elif model == "both":
        p_det = multiprocessing.Process(
            target=run_detector_server,
            args=(host, port_det),
        )
        p_cor = multiprocessing.Process(
            target=run_corrector_server,
            args=(host, port_cor),
        )
        p_det.start()
        p_cor.start()
        p_det.join()
        p_cor.join()

def main():
    parser = argparse.ArgumentParser(description="Nepali Grammar Checker — Unified Runner")
    parser.add_argument(
        "--mode",
        choices=["api", "fl", "both"],
        default="api",
        help="What mode to run: 'api' (hosted FastAPI app), 'fl' (local FL server & ONNX bridge), 'both' (both in parallel)."
    )
    # API configuration
    parser.add_argument("--host", default="0.0.0.0", help="Binding host")
    parser.add_argument("--port", type=int, default=8000, help="Hosted API port")
    
    # FL configuration
    parser.add_argument("--fl-model", choices=["detector", "corrector", "both"], default="both", help="FL model server")
    parser.add_argument("--port-detector", type=int, default=8080, help="FL detector server port")
    parser.add_argument("--port-corrector", type=int, default=8081, help="FL corrector server port")
    parser.add_argument("--port-bridge", type=int, default=8082, help="FL ONNX bridge API port")
    
    args = parser.parse_args()

    if args.mode == "api":
        run_api(args.host, args.port)
    elif args.mode == "fl":
        run_fl(args.host, args.port_detector, args.port_corrector, args.port_bridge, args.fl_model)
    elif args.mode == "both":
        p_api = multiprocessing.Process(target=run_api, args=(args.host, args.port))
        p_fl = multiprocessing.Process(
            target=run_fl, 
            args=(args.host, args.port_detector, args.port_corrector, args.port_bridge, args.fl_model)
        )
        p_api.start()
        p_fl.start()
        p_api.join()
        p_fl.join()

if __name__ == "__main__":
    # Ensure multiprocessing works correctly
    multiprocessing.freeze_support()
    main()
