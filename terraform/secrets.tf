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
    # note on new terraform-ci roles in docs/current/gcp-setup-playbook.md.
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
