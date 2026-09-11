variable "project_id" {
  description = "The GCP project everything lives in."
  type        = string
  default     = "hector-golf"
}

variable "region" {
  description = <<-EOT
    The region for Firestore, Cloud Run and Artifact Registry. Keeping all three
    in one region means no cross-region egress and the lowest write latency from
    the admin service to the database.
  EOT
  type        = string
  default     = "europe-north1"
}

variable "github_repository" {
  description = "owner/repo allowed to mint tokens through Workload Identity Federation."
  type        = string
  default     = "hectorgolf/hector.golf"
}

variable "firestore_database_id" {
  description = <<-EOT
    Firestore database id. Note that only ONE database per project gets the
    no-cost quota — "the first database that is created in a project without a
    free tier database will get the free tier" — so create this one first and
    do not create others casually.
  EOT
  type        = string
  default     = "hector"
}

variable "admin_principals" {
  description = <<-EOT
    Who may open the admin UI, as IAM principal strings, e.g.
    ["user:someone@example.com", "group:hector-admins@example.com"].
    These are granted roles/iap.httpsResourceAccessor on the Cloud Run service.
    An empty list means nobody can get in — IAP is deny by default.
  EOT
  type        = list(string)
  default     = []
}

variable "admin_image" {
  description = <<-EOT
    Overrides the container image for the admin service.

    Leave this unset. The service normally runs whatever deploy-admin.yml last
    pushed, and cloud_run.tf falls back to `<repo>/admin:latest` when it needs a
    value of its own — see local.admin_image_repo there.

    The one time to set it is the very first apply on a new project, before any
    image exists: Cloud Run cannot create a service whose image will not pull, so
    point it at a public placeholder for that one run and then remove it again:

      admin_image = "us-docker.pkg.dev/cloudrun/container/hello"
  EOT
  type        = string
  default     = null
}

variable "artifact_keep_count" {
  description = <<-EOT
    How many recent image versions Artifact Registry keeps. This is effectively
    the Cloud Run rollback window: the admin service scales to zero and pulls
    its image on every cold start, so deleting the image a live revision points
    at breaks that revision the next time it wakes up, not at deploy time.
  EOT
  type        = number
  default     = 5
}

variable "enable_budget_alert" {
  description = <<-EOT
    Whether to create the billing budget alert. Off by default because it needs
    permissions on the *billing account* rather than the project, which the
    Terraform CI service account deliberately does not have. Set it true and run
    `terraform apply` locally as yourself once, or create the budget by hand in
    the console. See docs/gcp-setup-playbook.md, step 8.
  EOT
  type        = bool
  default     = false
}

variable "billing_account" {
  description = "Billing account id (e.g. 01ABCD-234567-89EFGH). Only used when enable_budget_alert is true."
  type        = string
  default     = ""
}

variable "budget_amount_eur" {
  description = "Monthly budget in EUR that triggers the alert thresholds."
  type        = number
  default     = 1
}
