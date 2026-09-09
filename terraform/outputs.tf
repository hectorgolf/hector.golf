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
  description = "Value for the GH_IMAGE_REPO repository variable — the Docker path to push to."
  value       = "${google_artifact_registry_repository.admin.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.admin.repository_id}"
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
