import os
import pandas as pd

# CONFIG
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUTPUT_DIR = os.path.join(BASE_DIR, "data_cleaned")

os.makedirs(OUTPUT_DIR, exist_ok=True)

all_texts = []
all_rows = []

# SAFE CSV LOADER
def safe_read_csv(file_path):
    # try multiple strategies
    try:
        return pd.read_csv(
            file_path,
            engine="python",
            on_bad_lines="skip",   # key fix
            encoding="utf-8"
        )
    except Exception:
        try:
            return pd.read_csv(
                file_path,
                engine="python",
                on_bad_lines="skip",
                encoding="latin1"
            )
        except Exception as e:
            print(f"[FAILED READ] {file_path} -> {e}")
            return None


def extract_text(file_path):
    df = safe_read_csv(file_path)
    if df is None or df.empty:
        return []

    preferred_cols = ["text", "content", "article", "news", "description"]

    text_col = None
    for col in preferred_cols:
        if col in df.columns:
            text_col = col
            break

    if text_col is None:
        text_col = df.columns[0]

    return df[text_col].dropna().astype(str).tolist()


print(f"[INFO] Scanning: {BASE_DIR}")

csv_count = 0
processed_files = 0

for root, _, files in os.walk(BASE_DIR):
    for file in files:
        if file.endswith(".csv"):
            csv_count += 1
            file_path = os.path.join(root, file)

            texts = extract_text(file_path)

            if texts:
                processed_files += 1

            for t in texts:
                cleaned = " ".join(t.split())

                if len(cleaned) > 5:  # avoid junk
                    all_texts.append(cleaned)
                    all_rows.append({
                        "source_file": file_path,
                        "text": cleaned
                    })

print(f"[INFO] CSV files found: {csv_count}")
print(f"[INFO] Successfully processed: {processed_files}")
print(f"[INFO] Total cleaned rows: {len(all_texts)}")


csv_path = os.path.join(OUTPUT_DIR, "clean.csv")
txt_path = os.path.join(OUTPUT_DIR, "clean.txt")

pd.DataFrame(all_rows).to_csv(csv_path, index=False, encoding="utf-8")

with open(txt_path, "w", encoding="utf-8") as f:
    for text in all_texts:
        f.write(text + "\n")

print("\n[DONE]")
print(f"CSV → {csv_path}")
print(f"TXT → {txt_path}")