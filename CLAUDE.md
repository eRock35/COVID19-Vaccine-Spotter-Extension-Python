# For Claude: bootstrapping this environment

This repo also hosts the Cover Sheet (college football research app) GCP
deployment — see `docs/gcp-deployment.md` for the full picture (project,
Firestore, auth model, deploy pipeline, known blockers). This file is just the
"how do I authenticate to GCP without asking the user to re-upload a key"
bootstrap.

## GCP auth — if `GCP_SERVICE_ACCOUNT_KEY_JSON` is set

Check `echo "$GCP_SERVICE_ACCOUNT_KEY_JSON" | head -c 20` at the start of any
session that needs to touch GCP. If it's set, you have everything you need
without asking the user for anything:

```bash
mkdir -p /tmp/gcp && echo "$GCP_SERVICE_ACCOUNT_KEY_JSON" > /tmp/gcp/sa-key.json
chmod 600 /tmp/gcp/sa-key.json
python3 -m venv /tmp/gcp/venv
/tmp/gcp/venv/bin/pip install --quiet pyjwt cryptography requests google-auth
/tmp/gcp/venv/bin/python3 -c "
import google.oauth2.service_account as sa
from google.auth.transport.requests import Request
creds = sa.Credentials.from_service_account_file('/tmp/gcp/sa-key.json', scopes=['https://www.googleapis.com/auth/cloud-platform'])
creds.refresh(Request())
open('/tmp/gcp/token.txt','w').write(creds.token)
print('ok')
"
```

Then every GCP call is `curl -H "Authorization: Bearer $(cat /tmp/gcp/token.txt)" https://<service>.googleapis.com/...`
— the token expires in about an hour, just re-run the refresh step.

The venv step exists because this sandbox's system-level `cryptography`
package is broken (`ModuleNotFoundError: No module named '_cffi_backend'`) —
`google-auth` needs a real `cryptography`, and a fresh venv is the reliable
fix.

Don't use the `gcloud` CLI — `sdk.cloud.google.com` is blocked by this
environment's egress policy. Everything goes through direct REST calls to
`*.googleapis.com`, which the egress proxy does allow.

## If `GCP_SERVICE_ACCOUNT_KEY_JSON` is NOT set

Ask the user to either add it as a persistent environment variable on this
Claude Code environment ("Erik's World") — the whole JSON key file's contents,
pasted as the value — or re-upload the key file for this session only.

## Vacation app PII — do not commit

`eRock35/COVID19-Vaccine-Spotter-Extension-Python` is a **public** repo. Never
commit the vacation-app source or anything containing the family's real PII
(phone numbers, rental/Airbnb confirmation numbers, host contact info, exact
travel dates) to this repo. `cover-sheet-app/vacation/` is gitignored for this
reason — keep it that way. See `docs/gcp-deployment.md` for where that source
actually lives and how it gets deployed without going through this repo.
