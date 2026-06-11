import math
import torch
from core.models import CharTransformerDetector, NepaliCorrectionModel, Seq2SeqCorrector
from core.tokenizer import CharTokenizer

def detect_word(
    word: str,
    model: CharTransformerDetector,
    tokenizer: CharTokenizer,
    device: torch.device,
    max_len: int = 30,
) -> dict:
    model.eval()

    indices = tokenizer.encode(word, max_len)
    x = torch.tensor([indices], dtype=torch.long).to(device)

    with torch.no_grad():
        prob_incorrect = model(x).item()

    return {
        "word": word,
        "correct": prob_incorrect < 0.5,
        "confidence": round(1 - prob_incorrect, 4),
    }
def correct_word_beam(
    wrong_word: str,
    model: Seq2SeqCorrector | NepaliCorrectionModel,
    tokenizer: CharTokenizer,
    device: torch.device,
    max_len: int = 100,
    beam_width: int = 5,
    top_k: int = 3,
) -> list[dict]:
    """
    Beam search decoding.
    Returns top_k candidates: [{"word": ..., "score": ...}, ...]
    """
    # run beam search on given device; if a CUDA device-side assert occurs
    # we fallback to CPU to avoid crashing the server (slower but safe).
    def _run(on_device: torch.device):
        model.to(on_device)
        model.eval()
        src = torch.tensor(
            [tokenizer.encode(str(wrong_word), max_len)], dtype=torch.long
        ).to(on_device)

        SOS = tokenizer.char2idx[tokenizer.SOS]
        EOS = tokenizer.char2idx[tokenizer.EOS]

        with torch.no_grad():
            encoded = model.encoder(src)
            if isinstance(encoded, tuple):
                enc_out, h, c = encoded
                h = h.squeeze(0)
                c = c.squeeze(0)
            else:
                enc_out = encoded
                enc_mean = enc_out.mean(dim=1)
                h = torch.tanh(model.fc_h(enc_mean))
                c = torch.tanh(model.fc_c(enc_mean))

        beams: list = [(0.0, [], h, c)]
        completed: list = []

        for _ in range(max_len):
            if not beams:
                break
            candidates = []
            for lp, tokens, bh, bc in beams:
                if tokens and tokens[-1] == EOS:
                    completed.append((lp, tokens))
                    continue
                last = torch.tensor(
                    [tokens[-1] if tokens else SOS], dtype=torch.long
                ).to(on_device)
                with torch.no_grad():
                    step_out = model.decoder.forward_step(
                        last, bh, bc, enc_out
                    )
                    pred, new_h, new_c = step_out[:3]
                log_p = torch.log_softmax(pred[0], dim=-1)
                topk_lp, topk_idx = log_p.topk(beam_width)
                for tlp, tidx in zip(topk_lp.tolist(), topk_idx.tolist()):
                    candidates.append((lp + tlp, tokens + [tidx], new_h, new_c))
            candidates.sort(key=lambda x: x[0], reverse=True)
            beams = candidates[:beam_width]

        for lp, tokens, _, _ in beams:
            completed.append((lp, tokens))
        completed.sort(key=lambda x: x[0], reverse=True)

        return completed

    try:
        completed = _run(device)
    except Exception as e:
        msg = str(e).lower()
        if "device-side assert" in msg or "cuda" in msg:
            # CUDA is in an error state — avoid further CUDA ops (moving
            # the model will re-trigger the same error). Return a safe
            # fallback (no suggestions) so the server stays healthy.
            print("Warning: CUDA device-side assert during beam search; returning no suggestions.")
            return []
        else:
            raise

    def decode_tokens(tokens):
        out = []
        for idx in tokens:
            ch = tokenizer.idx2char.get(idx, tokenizer.UNK)
            if ch == tokenizer.EOS:
                break
            if ch not in (tokenizer.PAD, tokenizer.SOS):
                out.append(ch)
        return "".join(out)

    seen, results = set(), []
    for lp, tokens in completed:
        word = decode_tokens(tokens)
        if word and word not in seen:
            seen.add(word)
            norm_score = round(math.exp(lp / max(len(tokens), 1)), 4)
            results.append({"word": word, "score": norm_score})
        if len(results) == top_k:
            break

    return results


def predict_sentence(
    text: str,
    detector: CharTransformerDetector,
    corrector: Seq2SeqCorrector | NepaliCorrectionModel,
    detect_tok: CharTokenizer,
    correct_tok: CharTokenizer,
    device: torch.device,
    threshold: float = 0.5,
    beam_width: int = 5,
    detect_max: int = 30,
    correct_max: int = 100,
) -> dict:
    """
    Full pipeline:
      1. Split sentence into words
      2. Detector scores each word
      3. Wrong words get beam-search top-3 suggestions
      4. Best suggestion used in output sentence
    """
    detector.eval()
    words   = text.split()
    output  = []
    details = []

    for word in words:
        indices = detect_tok.encode(word, detect_max)
        x       = torch.tensor([indices], dtype=torch.long).to(device)
        with torch.no_grad():
            prob = detector(x).item()

        if prob <= threshold:
            suggestions = correct_word_beam(
                word, corrector, correct_tok, device, correct_max, beam_width
            )
            best = suggestions[0]["word"] if suggestions else word
            details.append({
                "word":        word,
                "status":      "wrong",
                "confidence":  round(prob, 4),
                "suggestions": suggestions,
                "corrected":   best,
            })
            output.append(best)
        else:
            details.append({
                "word":        word,
                "status":      "correct",
                "confidence":  round(prob, 4),
                "suggestions": [],
                "corrected":   word,
            })
            output.append(word)

    has_errors = any(d["status"] == "wrong" for d in details)
    return {
        "input":   text,
        "output":  " ".join(output),
        "status":  "corrected" if has_errors else "ok",
        "details": details,
    }
