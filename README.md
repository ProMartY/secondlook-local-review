# SecondLook

A local invoice comparison workspace for bookkeepers and small studios. It finds candidate pairs with repeated invoice IDs or related descriptions, then lets a person compare the source rows, record a decision and export a review.

Built from scratch during October 17, 2026 for the DEV Hacktoberfest Week 2 “Side Hustle” challenge. This is an independent prototype, not a production accounting service. No customers, revenue or real invoice savings are claimed.

## Demo

[Watch the 35-second walkthrough](demo/SecondLook-demo.mp4)

The silent video shows the running local application using only fictional sample invoices.

## Run

Requires Node.js 22.13 or later, a modern browser and an internet connection for the initial package/model download.

```sh
npm ci --ignore-scripts
npm run model:prepare
npm start
```

Open **http://127.0.0.1:4173/**. The server binds to loopback only. The supplied `START-WINDOWS.cmd` starts an already prepared checkout; it also recognizes the bundled Codex Node runtime on the current user's computer.

After the model has been downloaded, remote model access can be explicitly disabled:

```powershell
# Windows PowerShell
$env:SECONDLOOK_OFFLINE = '1'
npm start
```

```sh
# macOS/Linux
SECONDLOOK_OFFLINE=1 npm start
```

`SECONDLOOK_MODEL_CACHE` can override the default `.cache/models` directory. `PORT` can change the loopback port (default 4173). The Windows launcher uses offline mode; run `npm run model:prepare` first on a fresh installation.

## Try the example

1. Select **Use sample**. Every vendor and invoice in this example is fictional.
2. Select **Find possible duplicates**.
3. Compare each pair and choose **Mark as duplicate**, **Keep both** or **Needs context**. These labels record your review, without changing an invoice or payment.
4. Add a note and download CSV or JSON before closing the page. Decisions exist only in browser memory.

CSV columns, in any order: `id,vendor,date,currency,amount,description`.

Accepts 2–150 rows, at most 256 KB, YYYY-MM-DD dates, positive amounts with at most two decimal places and supported two-decimal ISO currencies. It rejects invalid input with a row/field explanation instead of silently dropping rows. Credit notes, PDFs, OCR, tax reconciliation and currency conversion are outside this version.

## Actual comparison rules

A real four-step [Mastra workflow](https://mastra.ai/docs/workflows/overview) parses CSV, validates invoices, computes local embeddings and creates the review queue. Stage durations in the interface come from that run.

Each candidate must have the same normalized vendor, the same currency and amounts within one cent. Vendor normalization handles case, punctuation and spaces; it cannot establish legal identity or resolve every spelling difference.

- A repeated normalized invoice identifier creates an **exact-ID candidate** even if descriptions differ or dates are over 14 days apart. Reused numbering may still be legitimate.
- Otherwise, dates must be within 14 days and the description cosine similarity must reach **0.78**. This is an explicit prototype preset, not a validated production decision threshold.
- Every unordered pair appears at most once. The app presents both original descriptions, identifiers, dates, currencies, amounts and logical CSV record numbers.

The model is [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), pinned to revision `6fa4bf687ce79106377b66d10009c0e513715e24`, using quantized q8 ONNX weights, CPU inference, mean pooling and normalized 384-dimensional embeddings through Transformers.js 3.8.1. It is primarily an English model. Long descriptions may be token-truncated. Similarity is not a probability that a bill is duplicated.

## Privacy and review boundaries

The browser sends CSV only to this computer's loopback server. CSV and embeddings are processed in memory. The app has no accounts, analytics, cloud inference, database or automatic accounting actions. Mastra snapshots and step events are disabled; workflow trace input/output are hidden. Raw CSV is not written to files or server logs.

Initial setup downloads open-source packages and model assets. In explicit offline mode, remote model access is disabled. Downloaded model files remain in the local cache; clearing a browser session does not remove those public model assets.

CSV exports escape spreadsheet formula prefixes. The app renders invoice text as text rather than HTML. The local server rejects unrelated origins and host headers, caps input size and allows only one analysis at a time. These checks do not make this an independently audited security product.

## Verification

```sh
npm test
SECONDLOOK_OFFLINE=1 npm run test:integration
```

On October 17, 2026, 27 unit/workflow/HTTP/export tests passed. A separate real-model run succeeded with remote access disabled. The public 12-row fictional example returned exactly two expected review pairs:

- `TC-007` at CSV records 7 and 8: repeated ID and identical descriptions.
- `NS-201` / `NS-218` at records 2 and 3: different IDs, paraphrased descriptions, cosine similarity **0.9307**.

The example's other controls include different services at the same price, a different currency, a different vendor, different amounts and monthly charges 30 days apart. Those controls were not flagged. This small synthetic fixture is a regression check; it does not establish accuracy on real customer invoices. Nearby recurring charges can still be false positives and true duplicates outside the gates can be missed.

Machine-readable evidence is in `tests/verification-real-model-offline.json`, `tests/verification-public-sample.json` and `tests/verification-unit.json`. Warm-run timing from one computer is not a general performance benchmark.

## Side-hustle hypothesis

A bookkeeper could use a focused local review to reduce manual searching across a client's invoice export. A proposed $19 supported desktop license is a pricing hypothesis; no one has bought it or validated that price. The prototype remains openly licensed. A useful next validation step is a consenting bookkeeper testing redacted invoices and comparing the queue against their own labels.

## Credits

Implementation and documentation were produced with OpenAI Codex assistance and checked with automated tests and a real-model local run. The model, Mastra, Transformers.js, ONNX Runtime, csv-parse and Zod retain their own licenses. See `THIRD-PARTY-NOTICES.txt`. No real client records or protected third-party artwork are included.

Project code: MIT. Model weights are downloaded separately and are not bundled in the source archive.
