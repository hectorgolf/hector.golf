# The secrets this project holds: a GitHub token the admin service dispatches
# workflows and commits with, and the WiseGolf login its handicaps job scrapes
# with.
#
# ## Terraform creates the container and never the value
#
# There is no `google_secret_manager_secret_version` here, on purpose. A version
# managed from this directory is a token written into Terraform state in plain
# text, and unlike the IAP client secret — which the provider gives no way to
# avoid — this one has an alternative that costs nothing: create the version with
# `gcloud`, once, by hand. See the GitHub token step in the playbook.
#
# The consequence to know about is that an apply on a fresh project produces a
# secret with no versions in it. That is a supported state rather than a broken
# one: `admin/src/lib/secrets.ts` reads the secret when somebody presses a button
# rather than when the container starts, so a project without a token yet has an
# admin that runs and one page that says the token is missing.
resource "google_secret_manager_secret" "github_dispatch_token" {
  project   = var.project_id
  secret_id = "github-dispatch-token"

  # Pinned to the same region as everything else rather than automatic. The
  # automatic policy replicates worldwide, which for a token read a handful of
  # times a day buys nothing and spreads it further than it needs to go.
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  labels = {
    component = "admin"
  }

  depends_on = [
    google_project_service.enabled["secretmanager.googleapis.com"],
    # Terraform in CI runs as terraform-ci, and the role that lets it create this
    # secret is granted by *this configuration*, in iam.tf. Without an edge the
    # two are unordered, so the first apply after secretmanager.admin was added
    # raced and lost: "Permission 'secretmanager.secrets.create' denied".
    #
    # This makes the grant happen first. It is not a guarantee — IAM is
    # eventually consistent, so a grant made seconds ago may still not be in
    # effect — but it turns a coin flip into a rare retry. See the troubleshooting
    # note on new terraform-ci roles in docs/playbooks/gcp-bootstrapping.md.
    google_project_iam_member.terraform_ci,
  ]
}

# Read access for the service, and for nothing else. `secretAccessor` can read
# versions but cannot list, create, disable or destroy them, so a compromised
# admin container can use the token — which it must — but cannot quietly replace
# it with one of its own.
resource "google_secret_manager_secret_iam_member" "admin_runtime_reads_github_token" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.github_dispatch_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.admin_runtime.member
}

# ---------------------------------------------------------------------------
# The three keys the Cloud Functions read. Created empty here; the values go in
# by hand, because Terraform must never hold one.
#
# The rule above holds here too and matters more, because these are three keys
# rather than one: **Terraform creates the container and never the value.**
# There is no google_secret_manager_secret_version below, so none of these ever
# enters Terraform state.
#
# This is what the migration buys. Today the three keys reach the functions
# through --set-env-vars from somebody's .env, which is why deploy-functions.yml
# cannot deploy configuration and why rotating a key means finding the laptop
# that has it. Mounted from here with --set-secrets, rotation is
# `gcloud secrets versions add` plus a redeploy — and because the functions
# reference :latest, even the redeploy is optional for a new instance.
# ---------------------------------------------------------------------------

locals {
  # secret id => the environment variable the function reads it as. The
  # right-hand side is not used by Terraform; it is here because it is the thing
  # you need when writing the --set-secrets flag in phase 4, and it is otherwise
  # only knowable by reading package.json's deploy scripts.
  function_secrets = {
    "gemini-api-key"     = "GOOGLE_GEMINI_API_KEY"
    "astrosite-api-key"  = "ASTROSITE_API_KEY"
    "hector-app-api-key" = "HECTOR_APP_API_KEY"
  }
}

resource "google_secret_manager_secret" "functions" {
  for_each = local.function_secrets

  project   = var.project_id
  secret_id = each.key

  # Pinned to var.region, as with the GitHub token above and for the same
  # reason.
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  labels = {
    component = "functions"
  }

  depends_on = [
    google_project_service.enabled["secretmanager.googleapis.com"],
    # See the note on the same edge above: without it, the first apply after
    # secretmanager.admin was granted races the grant and loses.
    google_project_iam_member.terraform_ci,
  ]
}

# secretAccessor reads versions and cannot list, create, disable or destroy
# them, so a compromised function can use its key — which it must — but cannot
# replace it with one of its own. Granted per secret rather than project-wide,
# which also means TournamentLeaderboard's identity could be split off later
# without touching the other two.
resource "google_secret_manager_secret_iam_member" "functions_runtime_reads" {
  for_each = google_secret_manager_secret.functions

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.functions_runtime.member
}

# ---------------------------------------------------------------------------
# The WiseGolf login, for the handicaps job running inside the admin service.
#
# These credentials already exist — as GitHub Actions secrets, which is where
# `update-handicaps.yml` reads them from. This is the same login in the place the
# service can reach, not a second one: the scrape moves from a runner to Cloud
# Run in docs/plans/handicaps-to-firestore.md, and a Cloud Run container cannot
# read a GitHub secret.
#
# Two secrets rather than one payload holding both, because Secret Manager
# versions the whole payload and rotating the password should not mean rewriting
# the username beside it.
#
# The rule from the top of this file holds here too: **Terraform creates the
# container and never the value.** There is no google_secret_manager_secret_version
# below, so neither credential ever enters Terraform state. The two commands that
# put the values in are the WiseGolf step in docs/playbooks/gcp-bootstrapping.md,
# written against `terraform output` so they cannot drift from the secret ids
# here.
#
# An apply that runs before that produces two empty secrets, which is a supported
# state and not a broken one: `wisegolfCredentials()` returns undefined, the job
# runs against a NullHandicapSource, and it reports a sweep that reached nobody
# rather than failing to start.
# ---------------------------------------------------------------------------

locals {
  # The two halves of the WiseGolf login. A map rather than two resources so that
  # the accessor binding below is one resource too, and so adding a third
  # credential later is one line.
  wisegolf_secrets = toset(["wisegolf-username", "wisegolf-password"])
}

resource "google_secret_manager_secret" "wisegolf" {
  for_each = local.wisegolf_secrets

  project   = var.project_id
  secret_id = each.value

  # Pinned to var.region, as with the GitHub token above and for the same reason.
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  labels = {
    component = "admin"
  }

  depends_on = [
    google_project_service.enabled["secretmanager.googleapis.com"],
    # See the note on the same edge above: without it, the first apply after
    # secretmanager.admin was granted races the grant and loses.
    google_project_iam_member.terraform_ci,
  ]
}

# secretAccessor reads versions and cannot list, create, disable or destroy them.
# Granted to the admin's runtime identity, which is the only thing that scrapes.
resource "google_secret_manager_secret_iam_member" "admin_runtime_reads_wisegolf" {
  for_each = google_secret_manager_secret.wisegolf

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.admin_runtime.member
}

# ---------------------------------------------------------------------------
# The admin calls one private Cloud Function, and needs the key it checks.
#
# `GeneratePlayerBiography` compares the Authorization header against exactly one
# value — `token !== process.env.ASTROSITE_API_KEY` — so a caller either presents
# that key or is answered 401. The admin's biographies job is about to be such a
# caller, which is why this grant exists.
#
# ONE KEY, TWO CALLERS. The site's workflows present the same secret. A key of
# the admin's own would be tidier and is not free: the function would have to
# accept a set rather than a value, which means editing and redeploying a
# deployed function. The cost of sharing is that rotating the key rotates it for
# both at once — they fail together, which is at least a failure mode with one
# cause rather than two.
#
# This is a read of the *value*, and the narrowest role that allows it:
# secretAccessor reads versions and cannot list, create, disable or destroy them.
# The function's own runtime identity already holds the same grant, above.
resource "google_secret_manager_secret_iam_member" "admin_runtime_reads_functions_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.functions["astrosite-api-key"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.admin_runtime.member
}

# ---------------------------------------------------------------------------
# The admin reads app.hector.golf, and needs the key it checks.
#
# The `leaderboards` job asks app.hector.golf for the standings of a tournament
# being played and commits them, which is a request that must carry `x-api-key`.
#
# THE SAME KEY AS THE FUNCTION'S, for the same reasons as the grant above: it is
# app.hector.golf that decides what a valid key is, so "a key of our own" is a
# change on somebody else's side. `TournamentLeaderboard` already presents this
# one, and now so does the admin. They rotate together.
#
# Unset is a supported state. The job reports a missing key as `not-configured`
# rather than as a failure, and `/api/jobs/leaderboards/run` answers 503 with the
# setup step named — which is what a fresh project should say, four times a day,
# without anybody treating it as an incident.
resource "google_secret_manager_secret_iam_member" "admin_runtime_reads_hector_app_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.functions["hector-app-api-key"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.admin_runtime.member
}
