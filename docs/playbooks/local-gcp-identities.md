# Switching GCP identities on your laptop

*A procedure, not a description. Last reviewed: 2026-09-14.*

Some things here run as you, and one runs as a service account. The obvious way to switch —
re-running `gcloud auth application-default login` with and without `--impersonate-service-account`
— works, and means a browser round trip every time you change your mind. This is how to set each
identity up once and pick between them per shell.

**You do not need any of this to run the admin.** `npm run dev:fake` puts a stand-in in front of
Firestore, GitHub and WiseGolf, so it needs no Google identity at all — see
[`architecture.md` §11](../current/architecture.md#11-local-development-and-operations). What follows
is for the things that talk to the real project: Terraform, the leaderboard scripts, and `gcloud`.

## Two credential stores, which is most of the confusion

They are separate, they are configured by different commands, and a change to one does nothing to
the other. Almost every "why is it still using the wrong account" moment is this.

| | Used by | Switched with |
| --- | --- | --- |
| **gcloud's own credentials** | the `gcloud` CLI itself | `gcloud auth login`, `gcloud config set account`, or the global `--impersonate-service-account=` flag on a single command |
| **Application Default Credentials (ADC)** | everything else — the Node code, Terraform, any Google client library | `gcloud auth application-default login`, or the `GOOGLE_APPLICATION_CREDENTIALS` environment variable |

`gcloud auth list` shows the first. It does not tell you what ADC is set to, which is why checking it
feels like it should answer the question and does not.

For a one-off `gcloud` command as another identity, do not switch anything:

```bash
gcloud --impersonate-service-account=leaderboard-reader@hector-golf.iam.gserviceaccount.com \
  storage ls
```

## What needs which identity

| Task | Identity | Why |
| --- | --- | --- |
| `npm run update-leaderboards` | `leaderboard-reader@hector-golf` | Sheets access comes from the spreadsheets being *shared with that account*, not from IAM. Run as yourself and it passes whether or not the sharing is right, so it proves nothing about CI |
| `terraform plan` from a laptop | you | CI runs as `terraform-ci`; a local plan is a read and your own roles cover it |
| `gcloud functions deploy`, `npm run deploy:*` | you | CI runs as `functions-deployer`. Deploying as yourself does *not* exercise that identity's roles — see the note in `terraform/iam.tf` |
| Everything else | you | |

`leaderboard-reader` is the only account here a person can impersonate, and only if their address is
in the `TF_LEADERBOARD_IMPERSONATORS` repository variable, which grants
`roles/iam.serviceAccountTokenCreator` on it and nothing else.

## One ADC file per identity

`gcloud auth application-default login` always writes the same well-known file, so each login
overwrites the last. The fix is to keep a copy per identity and choose with an environment variable,
which client libraries consult **before** the well-known file.

Set up each one once:

```bash
# As yourself.
gcloud auth application-default login
cp ~/.config/gcloud/application_default_credentials.json ~/.config/gcloud/adc-me.json

# As the leaderboard reader.
gcloud auth application-default login \
  --impersonate-service-account=leaderboard-reader@hector-golf.iam.gserviceaccount.com
cp ~/.config/gcloud/application_default_credentials.json ~/.config/gcloud/adc-leaderboard.json
```

Then select per command, or per shell:

```bash
GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/adc-leaderboard.json npm run update-leaderboards

export GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/adc-me.json   # for this shell
```

Leave the variable unset and you get the well-known file, whichever identity last logged in.

**Pointing it at a file that does not exist fails rather than falling back.** That is the property
worth relying on: a typo in the path is a loud error, not a silent run as the wrong identity.

## Which identity am I actually using?

```bash
gcloud auth list                                    # gcloud's own, not ADC
gcloud auth application-default print-access-token | \
  xargs -I{} curl -s "https://oauth2.googleapis.com/tokeninfo?access_token={}" | \
  python3 -c "import json,sys; print(json.load(sys.stdin).get('email','(no email claim)'))"
```

The second reads the well-known file, not `GOOGLE_APPLICATION_CREDENTIALS`, so it answers "what am I
by default" rather than "what will this command use".

## What not to do

Do not paste a downloadable service account key into `.env` as `GOOGLE_CREDENTIALS`.
`google-sheets.ts` still honours it, and it is the mechanism this repository spent a migration
getting rid of: a key is permanent, copyable and does not expire, which is how one ended up inside a
Cloud Function source bundle in a public bucket. ADC is yours, short-lived, and revocable:

```bash
gcloud auth application-default revoke
```

## Gotchas

- **ADC tokens expire.** Expect to redo a login occasionally. A service account key never expired,
  which is exactly the convenience being traded away.
- **Re-running a login overwrites the well-known file, not your copies.** Refresh a copy by
  re-running its login and copying again.
- **`.env` must still exist**, even empty. `env-cmd` fails without it, which is why `test-unit` runs
  `touch .env` first. What it no longer needs to contain is `GOOGLE_CREDENTIALS`.
- **A quota project warning** on an impersonated login is normal; the calls here are billed to the
  project the service account lives in.
