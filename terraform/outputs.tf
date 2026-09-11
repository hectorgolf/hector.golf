# The first four outputs are the values that go into GitHub Actions variables.
# `terraform output -raw <name>` prints one without quotes.

output "workload_identity_provider" {
  description = "Value for the GH_WIF_PROVIDER repository variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "terraform_service_account" {
  description = "Value for the GH_TERRAFORM_SA repository variable."
  value       = google_service_account.terraform_ci.email
}

output "deployer_service_account" {
  description = "Value for the GH_DEPLOYER_SA repository variable."
  value       = google_service_account.admin_deployer.email
}

output "admin_image_repository" {
  description = "Value for the GH_IMAGE_REPO repository variable — the full image name to push to, without a tag."
  value       = local.admin_image_repo
}

output "admin_url" {
  description = "Where the admin UI lives, once something is deployed to it."
  value       = google_cloud_run_v2_service.admin.uri
}

output "firestore_database" {
  description = "The Firestore database id, for FIRESTORE_DATABASE_ID."
  value       = google_firestore_database.hector.name
}

output "project_number" {
  description = "Useful when granting roles to Google-managed service agents by hand."
  value       = data.google_project.this.number
}
