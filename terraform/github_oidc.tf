# Keyless authentication for GitHub Actions. No service account key is created,
# downloaded or stored in a GitHub secret — Actions presents its OIDC token and
# exchanges it for a short-lived GCP token. There is no long-lived credential in
# this design to leak or rotate.
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "Identity pool for hectorgolf/hector.golf workflows"
  depends_on                = [google_project_service.enabled["iam.googleapis.com"]]

}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # This condition is what stops *any* repository on GitHub from exchanging a
  # token here. It is not optional in practice: without it the pool trusts every
  # workflow on github.com. Because the repository is pinned at this level, the
  # bindings below can safely scope on ref alone.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
  depends_on = [google_project_service.enabled["iam.googleapis.com"]]

}

# Terraform's identity is bound to the repository rather than to a branch,
# because `terraform plan` has to run on pull requests, where the ref is
# refs/pull/N/merge. Apply is gated by the `production` GitHub environment
# instead of by IAM — see .github/workflows/terraform-apply.yml.
resource "google_service_account_iam_member" "terraform_ci_wif" {
  service_account_id = google_service_account.terraform_ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# The deploy identity only ever runs from main, so it is bound to that ref.
# Combined with the provider's attribute_condition above, this reads as
# "the main branch of hectorgolf/hector.golf and nothing else".
resource "google_service_account_iam_member" "admin_deployer_wif" {
  service_account_id = google_service_account.admin_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.ref/refs/heads/main"
}
