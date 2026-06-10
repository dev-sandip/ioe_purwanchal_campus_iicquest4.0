# Nepali Grammar Checker — Frontend Integration Documentation

This document describes all API endpoints, requests, and response schemas for integrating the frontend with both the hosted FastAPI production server and the local Federated Learning & ONNX bridge server.

---

## Architecture Overview (Hybrid Setup)

```mermaid
graph TD
    subgraph Frontend / Browser
        A[Grammar Checker Web UI]
        B[onnxruntime-web]
    end
    
    subgraph Local Environment
        C[Local FL Server & ONNX Bridge:8082]
        D[Flower FL Clients:8080/8081]
    end
    
    subgraph Hugging Face Spaces (Hosted API)
        E[Hosted FastAPI App:7860]
    end
    
    A -->|1. Perform Check/Correction| E
    A -->|2. Download ONNX Models| C
    A -->|3. Run Local Inference / Training| B
    A -->|4. Push Local Client Updates| C
    C <-->|5. Federated Learning Rounds| D
```

- **Hosted API (Hugging Face)**: Handles the standard web requests (e.g. `/detect`, `/correct`, `/check`) from production users.
- **Local FL & ONNX Bridge**: Runs locally on a developer/client's machine. It hosts the Flower server for training and provides the endpoints for downloading local models as ONNX or uploading updated weights.

---

## 1. Production / Hosted FastAPI App (Default Port: 8000)

These endpoints are used for standard grammar checker tasks, inference, and model downloads.

### Health Status
- **Endpoint**: `GET /health`
- **Response**: `200 OK`
  ```json
  {
    "status": "healthy",
    "device": "cpu",
    "detector_loaded": true,
    "corrector_loaded": true
  }
  ```

### Detect Wrong Word
- **Endpoint**: `POST /detect`
- **Request Body**:
  ```json
  {
    "word": "कलमम"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "word": "कलमम",
    "correct": false,
    "confidence": 0.1284
  }
  ```

### Get Word Corrections
- **Endpoint**: `POST /correct`
- **Request Body**:
  ```json
  {
    "word": "कलमम"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "word": "कलमम",
    "suggestions": [
      {
        "word": "कलम",
        "score": 0.9421
      },
      {
        "word": "कमल",
        "score": 0.8124
      }
    ]
  }
  ```

### Check Full Sentence
- **Endpoint**: `POST /check`
- **Request Body**:
  ```json
  {
    "sentence": "ीसरय नेपालमा वतु्स पिबी",
    "threshold": 0.5,
    "beam_width": 5
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "input": "ीसरय नेपालमा वतु्स पिबी",
    "output": "यसले नेपालमा वस्तु पिउने",
    "status": "corrected",
    "details": [
      {
        "word": "ीसरय",
        "status": "wrong",
        "confidence": 0.0824,
        "suggestions": [
          { "word": "यसले", "score": 0.9124 }
        ],
        "corrected": "यसले"
      },
      {
        "word": "नेपालमा",
        "status": "correct",
        "confidence": 0.9982,
        "suggestions": [],
        "corrected": "नेपालमा"
      }
    ]
  }
  ```

---

## 2. Local FL & ONNX Bridge Server (Default Port: 8082)

Run locally using `python fl/server.py --model both`. Exposes endpoints to download ONNX versions of the models and upload weights directly from the frontend.

### Export Models to ONNX
Used by the frontend to download optimized `.onnx` models for running local browser-based inference with `onnxruntime-web`.

- **Export Detector Model**:
  - **Endpoint**: `GET /onnx/export/detector`
  - **Returns**: Binary stream of `detector.onnx`.

- **Export Corrector Encoder**:
  - **Endpoint**: `GET /onnx/export/corrector/encoder`
  - **Returns**: Binary stream of `corrector_encoder.onnx`.

- **Export Corrector Decoder (Single LSTM Step)**:
  - **Endpoint**: `GET /onnx/export/corrector/decoder`
  - **Returns**: Binary stream of `corrector_decoder.onnx`.

### Import Weights from Frontend
Used by the frontend to push updated model weights back to the local FL server after local browser training.

- **ONNX File Upload**:
  - **Endpoint**: `POST /onnx/import/{model_type}` (where `{model_type}` is `detector` or `corrector`)
  - **Content-Type**: `multipart/form-data`
  - **Payload**: Form parameter `file` with the updated `.onnx` model file binary.
  - **Response**:
    ```json
    {
      "status": "success",
      "detail": "Loaded weights from ONNX into detector model."
    }
    ```

- **JSON Weights Upload**:
  - **Endpoint**: `POST /onnx/import-json/{model_type}` (where `{model_type}` is `detector` or `corrector`)
  - **Content-Type**: `application/json`
  - **Payload**:
    ```json
    {
      "weights": {
        "embedding.weight": [[0.01, -0.02, ...], ...],
        "classifier.0.weight": [...]
      }
    }
    ```
  - **Response**:
    ```json
    {
      "status": "success",
      "detail": "Loaded weights from JSON into detector model."
    }
    ```

---

## 3. Local Federated Learning (Flower)
To run a local Federated Learning client that connects to the local FL server:
```bash
python fl/client.py --model detector --client-id 0 --total-clients 2
```
This will read from `data/right_wrong.csv`, partition the data, and start training in synchronization with the Flower server (listening on port `8080` for detector and `8081` for corrector).
