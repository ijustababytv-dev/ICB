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

## Download images into assets

Double-click `download-cloudinary-images.bat`, or run `npm.cmd run images:download`. To preview first without writing files, run `npm.cmd run images:download:plan`.

The separate downloader uses the same credentials and retrieves ICB images under `icb/` created by the uploader. It downloads missing or changed images, checks original checksums and sizes, and skips identical files. It never uploads or deletes images in Cloudinary, and never removes local-only files.

- Original `assets/` images return to their original subfolders, such as `assets/resources/card.png`.
- Images originally uploaded from `images/` or `docs/` become copies under `assets/cloudinary/images/` or `assets/cloudinary/docs/`. Every downloaded file stays inside `assets/`; existing application URLs remain unchanged.
- `assets/cloudinary/` is reserved for those copies and excluded from uploads so they cannot create duplicate Cloudinary images. Restore one of these copies to its original `images/` or `docs/` path separately if needed by the application.
- The upload manifest preserves exact original filename spelling when available. A fresh checkout can recover filenames from Cloudinary's IDs and display names without that manifest. Unrecognized IDs and unsafe paths stop the comparison before writes.
- Downloading chooses the Cloudinary version. Before replacing a differing local file, the script saves its previous contents under `assets/backups/cloudinary-download/<run>/`, preserving subfolders. Uploading chooses the local version. These are two explicit directions, not automatic conflict resolution.
- Downloads use binary temporary files beside their destinations and publish only after verification. Interrupted or corrupt downloads leave the existing image intact. Files edited locally during a download are not replaced. Rerunning safely compares current contents again.

The original upload contained **274 images: 272 from `assets/`, one from `images/`, and one from `docs/`**. All 274 are included by the downloader.

## Image selection and comparison

- Scans `assets/`, `images/`, and `docs/` recursively for image files. Recognizes extensionless PNG, JPEG, GIF and WebP artwork too.
- Excludes scripts, audio, archives, hidden files, backup folders, `assets/cloudinary/` mirror copies and symlinks. It does not scan private state or unrelated folders on the computer.
- Preserves project folders beneath `icb/` in Cloudinary, with the original filename displayed in the Media Library.
- Adds a format suffix to Cloudinary IDs so `card.png`, `card.jpg`, and extensionless `card` stay distinct: `card--png`, `card--jpg`, `card--original`. A rename therefore uploads a new asset and retains the old one.
- Compares Cloudinary's current MD5 checksum and byte size against the original file. Identical contents are skipped, even if a local file's date changed. Different contents replace the corresponding Cloudinary image and invalidate its delivery cache.
- Gets checksums in batches from Cloudinary search and matches them to the current inventory's asset IDs and versions. If indexing is delayed, it downloads the current original to calculate its checksum instead of trusting stale search results.
- Never deletes remote-only images. Only local images mapped to the same project ID are eligible for replacement.
- Uses HTTPS multipart uploads of binary files. Image data is never embedded in scripts or converted to base64.
- Verifies the returned ID, byte size, checksum, and HTTPS URL before recording success. Stops on an error, without suppressing a failed image. Rerun the command to resume by comparing actual remote contents again.

`data/cloudinary-upload-manifest.json` records verified project paths, original SHA-256 hashes, dimensions, Cloudinary IDs, and delivery URLs. It contains no credentials. During a sync it checkpoints verified files in inventory order; a failed run may leave a partial manifest. The next sync rebuilds it from Cloudinary and local originals.

No scheduled job is installed. Run the sync after adding or changing artwork. Uploading does not alter local files, tracker counts, or overlay URLs.

Implementation: `local-server/tools/cloudinary-plan.js` contains upload selection and comparison rules; `local-server/tools/cloudinary-sync.js` handles Cloudinary requests and uploads. `local-server/tools/cloudinary-download-plan.js` validates download paths and compares contents; `local-server/tools/cloudinary-download.js` writes verified images and backups. Unit tests use isolated files and mocked requests; they never upload test images to the real account.

API references: [Cloudinary Admin API](https://cloudinary.com/documentation/admin_api), [Upload API](https://cloudinary.com/documentation/image_upload_api_reference), [authentication signatures](https://cloudinary.com/documentation/authentication_signatures).
