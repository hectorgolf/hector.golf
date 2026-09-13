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

output "github_dispatch_token_secret" {
  description = <<-EOT
    The Secret Manager secret the admin service reads its GitHub token from.
    Terraform creates the container but never a version — add the token with

      gcloud secrets versions add "$(terraform output -raw github_dispatch_token_secret)" --data-file=-

    See the GitHub token step in docs/current/gcp-setup-playbook.md.
  EOT
  value       = google_secret_manager_secret.github_dispatch_token.secret_id
}

output "scheduler_service_account" {
  description = "The identity the scheduled data updates call the admin service as."
  value       = google_service_account.scheduler.email
}

output "admin_dns_records" {
  description = <<-EOT
    The DNS records to create at the registrar for var.admin_domain, as Google
    emits them. Read these rather than assuming the value: the mapping is the
    authoritative source for what the record should be.
  EOT
  value       = try(google_cloud_run_domain_mapping.admin[0].status[0].resource_records, [])
}
