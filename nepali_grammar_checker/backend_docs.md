# Backend API Documentation

This document explains the hosted FastAPI production backend structure and endpoints used by the client for inference tasks.

## System Architecture

The hosted FastAPI backend runs on a cloud server (e.g. Hugging Face Spaces on port `7860`). It is loaded with:
- **`detector_best.pth`**: A character-level transformer encoder model classifying whether a Nepali word is grammatically/spelling-wise correct or wrong.
- **`seq2seq_best.pth`**: A transformer encoder + LSTM attention decoder model proposing candidate spell corrections.
- **CharTokenizers**: Trained char-level tokenizers converting input characters into vocabulary indices.

---

## REST Endpoints

### 1. GET `/health`
- **Description**: Returns the load state of both models and the running device (CPU/CUDA).
- **Response**: `200 OK`
  ```json
  {
    "status": "healthy",
    "device": "cpu",
    "detector_loaded": true,
    "corrector_loaded": true
  }
  ```

### 2. POST `/detect`
- **Description**: Evaluates if a single Nepali word is correct or wrong.
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

### 3. POST `/correct`
- **Description**: Proposes candidate corrections for a misspelled word using beam search decoding.
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
      { "word": "कलम", "score": 0.9421 },
      { "word": "कमल", "score": 0.8124 }
    ]
  }
  ```

### 4. POST `/check`
- **Description**: Splits an entire input sentence into individual words, scores them with the detector, corrects words classified as wrong using the corrector, and reconstructs the sentence.
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
