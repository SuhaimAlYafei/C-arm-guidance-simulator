# X-ray Dataset Builder

This directory defines the data pipeline for a future radiograph anatomy/projection verifier.

## Design principles

1. Do not scrape arbitrary web images.
2. Only ingest datasets/images whose access terms permit the intended research use.
3. Preserve source, license/access terms, patient/study identifiers when available, anatomy label, projection label when explicitly provided, and file hash.
4. Never infer a projection label from a filename/source that does not provide trustworthy projection metadata.
5. Split at patient/study level before augmentation to prevent leakage.
6. Keep the simulator's hand-verified `python/bridge/reference_xrays/` library outside model training.
7. Augmented copies never count as independent samples.

## Planned model

A multi-task verifier is preferred over 41 unrelated classes:

- Anatomy head: body region / joint
- Projection head: AP, lateral, oblique, axillary, or unknown

Projection training must use only records with verified projection labels.

## Pipeline

`source dataset -> manifest -> integrity/hash audit -> deduplication -> label audit -> patient/study split -> augmentation (train only) -> training -> held-out evaluation -> calibration`

## Manifest schema

See `manifest_schema.csv`.

The `split` field must be assigned at patient/study level. `projection` may be `unknown`; unknown projection samples can still contribute to anatomy training but must be masked from projection-head loss/evaluation.

## Important scientific limitation

A classifier trained on public diagnostic radiographs does not validate physical C-arm positioning accuracy. It can only provide an image-level verification signal for anatomy/projection under the distribution represented by its independently held-out evaluation data.
