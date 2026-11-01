# Cloud sign-in and remembered access

ICB requires Cloud sign-in for dashboards, overlays, artwork, feature APIs,
local controls and event streams. Each local Node server has one active cloud
account, shared by its browser tabs and Meld layers. Usernames ignore case.

## Startup and daily use

The launchers open `/cloud.html?startup=1`. A signed-out installation serves only
the login page and its assets, authentication endpoints, minimal readiness health,
and the startup URL list pointing to login. Direct page links redirect to login;
feature/API/artwork/event requests receive HTTP 401.

Sign in once with your ICB username and password. Successful login returns to the
requested local page, or Home. Saved startup tabs can open when the launcher finds
a validated remembered session. An already signed-in account page also offers
**Continue to ICB** and **Sign out**.

## Fourteen days on this computer

The cloud issues an opaque token with a fixed 14-day expiry. PostgreSQL stores only
its hash, account, expiry and revocation state. Local Node protects the token with
Windows DPAPI `CurrentUser`, together with its endpoint, account and expiry.
The password is never saved. Tokens never enter browser storage, cookies, URLs,
Terraform state or application logs.

The protected file is `%LOCALAPPDATA%\ICB\auth\<endpoint-hash>.dpapi`, outside this
checkout, OneDrive and ordinary project backups. It is scoped to the Windows user
and cloud endpoint. Do not copy it into Git or recovery bundles. The implementation
uses Windows PowerShell through anonymous pipes; credentials are never process
arguments. Secure persistence requires Windows; there is no plaintext fallback.
Tests use isolated temporary storage and fake credentials.

On restart, Node decrypts the file and validates it through cloud `/v1/me` and the
feature protocol endpoint before granting access. Restarting or using ICB never
extends the original deadline. Expiry, revocation, disabled accounts and unauthorized
cloud responses lock access and remove the saved token. Other tabs return to login;
event streams close immediately. Overlays return to their original URL after sign-in.

Connection failure during restoration leaves ICB locked and retains the protected
file for **Retry saved sign-in**. Corrupt or expired saved state requires a new
password sign-in. **Sign out** clears the local saved session immediately and
attempts cloud revocation, even if the cloud is unreachable.
If Windows refuses to erase the file, ICB locks access and explicitly reports the
failure instead of claiming it forgot the session. Fix its file permissions and
retry Sign out before closing ICB; a file that could not be removed can remain
restorable if remote revocation also failed.

## Implementation and verification

- Cloud expiry and `/me`: `cloud-server/src/activity/auth.js`; existing `icb.sessions`
  schema needs no migration. Existing older tokens retain their original expiry.
- Local session lifecycle: `local-server/src/cloud/session-controller.js` and
  `credential-store.js`; HTTP boundary: `local-server/src/http/auth-gate.js`.
- Browser transitions: `ui/js/local-api.js`, `cloud-auth.js` and `cloud.html`.
- Run unit, E2E, structure and format checks. `npm run test:browser` includes the
  real local login boundary, rejected passwords, DPAPI persistence through server
  restart, fixed expiry, and logout across a dashboard and overlay. Cloud PostgreSQL
  tests verify actual 14-day issuance, revocation and expiry in disposable schemas.

Deploy the cloud code before restarting an updated local bridge. The active local
server is never restarted as part of a source edit. AWS access/release instructions
are in [AWS.md](../AWS.md) and [Step 2 operations](STEP2-OPERATIONS.md).
