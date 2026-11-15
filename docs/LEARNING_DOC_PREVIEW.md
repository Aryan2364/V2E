# Learning — Document Preview & Materials

_Last updated: 2026-07-19_

How course materials are stored, previewed in-app, and controlled in the Learning
module. Read this before touching the material-file or preview code.

---

## Current policy (what we decided)

**Course creators upload slides as PDF.** PowerPoint has a built-in "Export to PDF" —
exporting first means the deck plays perfectly inside the app with zero server
dependencies. This is the active policy.

### What plays in-app today (no extra software required)

| File type | In-app preview | How |
|-----------|----------------|-----|
| **PDF** | ✅ Plays in-app | rendered page-by-page via `pdfjs-dist` (canvas, no browser toolbar) |
| **Images** (png/jpg/jpeg/gif/webp) | ✅ Plays in-app | native `<img>` |
| **Video** (mp4/webm/mov) | ✅ Plays in-app | native `<video>` |
| **Audio** (mp3) | ✅ Plays in-app | native `<audio>` |
| **Office** (ppt/pptx/doc/docx/xls/xlsx) | ⬇️ Uploads, but opens by **download** | conversion is **dormant** — see below |
| Other (zip, etc.) | ⬇️ Download only | no preview |

So the feature is fully usable right now: upload PDFs/images/video and they preview
in the app. Office files still upload and download fine; they just don't render inline
until the converter below is switched on.

---

## The Office→PDF converter is BUILT but DORMANT (kept for later)

We built a LibreOffice-based converter that turns ppt/pptx/doc/docx/xls/xlsx into a
preview PDF on upload, so Office files would also play in-app. We are **not using it
right now** (policy = upload PDFs), but the code is intact and switched off so it never
runs, never spawns LibreOffice, and never burdens the server. Turn it back on any time.

### Why it's off

- It needs **LibreOffice** installed on the server (~600 MB) plus RAM per conversion.
- Our EC2 (`t3.small`, 16 GB disk sitting at ~88% full) didn't have comfortable room.
- Uploading PDFs directly gives perfect fidelity for free, so the converter wasn't worth
  the operational cost yet.

### How it's switched off

A single env flag, **off by default**:

```
LEARNING_DOC_CONVERSION       # unset / anything but "on" = OFF (default)
LEARNING_DOC_CONVERSION=on    # enables Office→PDF conversion on upload
```

Read in `DocumentConversionService.enabled` (`backend/src/storage/document-conversion.service.ts`).
When off, `LearningFilesService.uploadItemFile` skips conversion entirely — an Office
file just uploads as "download-to-view" (`preview_status = 'failed'`). No LibreOffice
process is ever started.

### Files involved (don't delete these — they're the dormant feature)

- `backend/src/storage/document-conversion.service.ts` — LibreOffice wrapper (`soffice
  --headless --convert-to pdf`); fails soft if the binary is missing. Has the `enabled` flag.
- `backend/src/storage/r2.service.ts` — `getSignedInlineUrl`, `getObjectBuffer` support preview.
- `backend/src/learning/learning-files.service.ts` — `uploadItemFile` decides native
  preview vs convert vs download-only; gated on `converter.enabled`.
- `frontend/components/learning/MaterialViewer.tsx` — renders pdf/image/video/audio inline
  (used by both the converted-PDF path and native PDFs, so it already works today).

---

## How to re-enable Office→PDF conversion later

1. **Install LibreOffice on the server** (headless is enough).

   Amazon Linux 2023 / RHEL:
   ```bash
   sudo dnf install -y libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress
   sudo dnf clean all
   which soffice   # confirm on PATH
   ```
   Ubuntu / Debian:
   ```bash
   sudo apt-get update && sudo apt-get install -y --no-install-recommends \
     libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress fonts-liberation
   ```
   Docker: add the same `apt-get install` line to the backend Dockerfile.
   If `soffice` isn't on PATH, set `LIBREOFFICE_PATH=/full/path/to/soffice`.

2. **Set the flag** in the backend environment:
   ```
   LEARNING_DOC_CONVERSION=on
   ```

3. **Restart the backend** so it reads the env var.

4. **Re-upload** any Office files that were added while conversion was off — use the
   **Replace (↻)** button on the material and re-pick the same file. Only files uploaded
   *after* the switch convert automatically; old ones stay download-to-view until re-uploaded.

### Sizing (from the 2026-07-19 EC2 check — `t3.small`)

- **Disk:** LibreOffice ≈ 600 MB installed + ~1 GB peak during `dnf`/`apt` install.
  Keep **≥ 1.5 GB free**. Our box was 88% full (2 GB free) → grow the EBS volume first.
  AL2023 uses **xfs**: after enlarging the volume in the AWS console,
  `sudo growpart /dev/nvme0n1 1 && sudo xfs_growfs /`.
- **RAM:** ~150–300 MB per conversion. `t3.small` (2 GB + 2 GB swap) is fine for
  one-at-a-time conversions. On a 1 GB instance, add a swap file first.
- **CPU:** conversions are short and single-threaded; 2 vCPU is plenty.

### Alternatives considered (if we ever want to avoid LibreOffice on the box)

- **In-browser rendering** — `pptx-preview` / `docx-preview` / SheetJS render Office files
  client-side. No server dependency, but lower fidelity on complex decks and the browser
  receives the original file (weaker for "view-only").
- **LibreOffice on AWS Lambda** (prebuilt layer) — same fidelity, offloads RAM/disk from
  EC2, stays inside our AWS account. More setup, pennies per file.
- **Third-party API** (CloudConvert, Adobe PDF Services) — no infra, but the file leaves to
  a vendor and there's a per-file cost.

---

## Storage model (where files actually live)

Uploaded materials live in **Cloudflare R2** (private bucket), NOT on the EC2 disk — same
storage the Tasks module uses. EC2 disk is only touched transiently during a conversion
(when the converter is enabled). Downloads use short-lived **signed URLs**
(`getSignedDownloadUrl`, forces download). Images/video/audio preview via a signed inline
URL (`getSignedInlineUrl`) — fine cross-origin because `<img>`/`<video>` don't enforce CORS.

**PDFs are different:** pdf.js fetches via `fetch`, which R2 blocks cross-origin (no CORS
config). So PDF bytes are streamed **through the backend** (`GET .../items/:id/view-file`,
`@Res()` raw, bypassing the JSON `ResponseInterceptor`) — authenticated, same-origin, and
for view-only materials the R2 URL never reaches the browser at all. The frontend fetches
those bytes with axios (`responseType: 'arraybuffer'`) and hands them to pdf.js as `data`.
The pdf.js worker is served same-origin from `frontend/public/pdf.worker.min.mjs`.

Per-material **`allow_download`** is the course-decider's one switch:
- **Download allowed** — learner sees a Download button.
- **View-only** — no download; the PDF renders via pdf.js (no browser download/print
  toolbar), a **personalised watermark** (name · email · date) is tiled over the content,
  and right-click / text-select / drag-save / media-download are suppressed.

> Note: true screenshot prevention is impossible on the web. The watermark makes any leak
> **traceable to the person** who viewed it — that's the deterrent, by design.

## Engagement analytics ("who accessed what")

`LearningItemView` records, per (learner, material), how many times it was opened and when
(upserted on view). The Engagement tab on a course (`components/learning/EngagementPanel.tsx`,
`GET .../paths/:id/engagement`) shows per-material open/complete counts and a per-learner
matrix. "Opened" (a view) is distinct from "completed" (progress) — the gap is the signal.
