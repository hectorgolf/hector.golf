# The one secret this project holds: a GitHub token the admin service dispatches
# workflows with.
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
# The three keys the Cloud Functions read, once they live in this project.
# Phase 1 of docs/plans/functions-migration.md; the values go in by hand in
# phase 3.
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
