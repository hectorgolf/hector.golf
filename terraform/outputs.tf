# The first five outputs are the values that go into GitHub Actions variables.
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

output "leaderboard_service_account" {
  description = <<-EOT
    Value for the GH_LEADERBOARD_SA repository variable, and the address the
    HECTOR2024 and HECTOR2025 spreadsheets must be shared with (Viewer) for the
    scrape to see them. Sharing is the whole of its access: this account holds
    no project roles.
  EOT
  value       = google_service_account.leaderboard_reader.email
}

output "functions_deployer_service_account" {
  description = <<-EOT
    Value for the GH_FUNCTIONS_DEPLOYER_SA repository variable, which
    deploy-functions.yml needs before it stops shipping inert. Pairs with the
    existing GH_WIF_PROVIDER — the whole point of the migration is that there is
    one pool, so there is no GH_FUNCTIONS_WIF_PROVIDER to set.
  EOT
  value       = google_service_account.functions_deployer.email
}

output "functions_builder_service_account" {
  description = <<-EOT
    Value for the GH_FUNCTIONS_BUILDER_SA repository variable, and the
    --build-service-account on every `gcloud functions deploy`. Naming it is
    what keeps the build off the project's default compute service account,
    which carries roles/editor.
  EOT
  value       = google_service_account.functions_builder.email
}

output "functions_runtime_service_account" {
  description = <<-EOT
    The identity the four Cloud Functions run as, for the --service-account flag
    on `gcloud functions deploy`.
  EOT
  value       = google_service_account.functions_runtime.email
}

output "function_secrets" {
  description = <<-EOT
    The three Secret Manager containers the functions read their keys from, as
    a map of secret id to the environment variable each is mounted as.
    Terraform creates the containers but never a version — add the values with

      printf %s "$KEY" | gcloud secrets versions add <secret-id> --data-file=-

    `printf %s` rather than `echo`, so no trailing newline ends up in the
    secret. Rendered as --set-secrets flags, this map is what phase 4 of
    docs/plans/functions-migration.md passes to each deploy.
  EOT
  value       = local.function_secrets
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

    See the GitHub token step in docs/playbooks/gcp-bootstrapping.md.
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
