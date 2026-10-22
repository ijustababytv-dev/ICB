# Cloudinary image sync

Baby selected Cloudinary on 2026-10-22. The sync uploads original image files while ICB continues to serve its local artwork during streams.

Double-click `sync-cloudinary-images.bat` to sync. The window shows the results and stays open for review.

Or run from the project directory with Node 24 or later:

```powershell
npm.cmd run images:plan
npm.cmd run images:sync
```

`images:plan` compares the local files with Cloudinary without uploading. `images:sync` uploads new images and replaces images whose contents changed. Both commands read the current Cloudinary inventory; they do not rely on file dates or on the local manifest being current. Running the sync again skips identical images.

## Credentials

Put the `CLOUDINARY_URL` from Cloudinary **Settings > API Keys** in `.env.cloudinary` at the project root. The file is excluded from Git. A process environment variable named `CLOUDINARY_URL` also works; the local file takes precedence when populated. Never paste credentials into source, documentation, logs, or chat.

## Image selection and comparison

- Scans `assets/`, `images/`, and `docs/` recursively for image files. Recognizes extensionless PNG, JPEG, GIF and WebP artwork too.
- Excludes scripts, audio, archives, hidden files, backup folders and symlinks. It does not scan private state or unrelated folders on the computer.
- Preserves project folders beneath `icb/` in Cloudinary, with the original filename displayed in the Media Library.
- Adds a format suffix to Cloudinary IDs so `card.png`, `card.jpg`, and extensionless `card` stay distinct: `card--png`, `card--jpg`, `card--original`. A rename therefore uploads a new asset and retains the old one.
- Compares Cloudinary's current MD5 checksum and byte size against the original file. Identical contents are skipped, even if a local file's date changed. Different contents replace the corresponding Cloudinary image and invalidate its delivery cache.
- Gets checksums in batches from Cloudinary search and matches them to the current inventory's asset IDs and versions. If indexing is delayed, it downloads the current original to calculate its checksum instead of trusting stale search results.
- Never deletes remote-only images. Only local images mapped to the same project ID are eligible for replacement.
- Uses HTTPS multipart uploads of binary files. Image data is never embedded in scripts or converted to base64.
- Verifies the returned ID, byte size, checksum, and HTTPS URL before recording success. Stops on an error, without suppressing a failed image. Rerun the command to resume by comparing actual remote contents again.

`data/cloudinary-upload-manifest.json` records verified project paths, original SHA-256 hashes, dimensions, Cloudinary IDs, and delivery URLs. It contains no credentials. During a sync it checkpoints verified files in inventory order; a failed run may leave a partial manifest. The next sync rebuilds it from Cloudinary and local originals.

No scheduled job is installed. Run the sync after adding or changing artwork. Uploading does not alter local files, tracker counts, or overlay URLs.

Implementation: `js/tools/cloudinary-plan.js` contains selection and comparison rules; `js/tools/cloudinary-sync.js` handles Cloudinary requests and the command. Unit tests use isolated files and mocked requests; they never upload test images to the real account.

API references: [Cloudinary Admin API](https://cloudinary.com/documentation/admin_api), [Upload API](https://cloudinary.com/documentation/image_upload_api_reference), [authentication signatures](https://cloudinary.com/documentation/authentication_signatures).
