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

variable "scheduler_region" {
  description = <<-EOT
    The region the Cloud Scheduler jobs live in.

    Separate from var.region, and not by choice: **Cloud Scheduler is not
    available in europe-north1**. `gcloud scheduler locations list` is the
    authoritative list, and Finland is not on it — an apply with var.region here
    fails with "Location 'europe-north1' is not a valid location".

    Being in a different region than everything else costs nothing that matters.
    The job makes one HTTPS call to the admin service twice a day, so the
    cross-region hop is a few milliseconds and a few kilobytes of egress on a
    path that runs 730 times a year. Nothing is stored here: the job holds a URL
    and a service account email, both of which are in this repository already.

    europe-west1 (Belgium) is the closest supported region that is also one of
    the cheapest. Change it only to another region on that list.
  EOT
  type        = string
  default     = "europe-west1"
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

  # Empty is not a harmless default here: applying it revokes the bindings that
  # exist, locking everyone out of a service that is otherwise running fine. The
  # realistic way to arrive at empty is CI running without the
  # TF_ADMIN_PRINCIPALS secret, where it would look like an ordinary plan.
  validation {
    condition     = length(var.admin_principals) > 0
    error_message = "admin_principals must not be empty: IAP is deny by default, so applying an empty list removes everyone's access. In CI this means the TF_ADMIN_PRINCIPALS secret is not set."
  }
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

variable "iap_oauth_client_id" {
  description = <<-EOT
    OAuth client id that IAP authenticates with, from the client created in
    step 5 of the playbook.

    Leave unset until that client exists: google_iap_settings is then left out
    of the plan entirely, which is what lets the first apply run before the
    console work has been done.
  EOT
  type        = string
  default     = null
}

variable "iap_oauth_client_secret" {
  description = <<-EOT
    Secret paired with iap_oauth_client_id.

    Terraform stores this in state as plain text — the provider documents it. The
    state bucket is private, uniform-access and public-access-prevented, which
    makes that acceptable rather than harmless; rotate the client if the bucket
    is ever exposed. Supply it from the gitignored terraform.tfvars locally and
    from the TF_IAP_OAUTH_CLIENT_SECRET GitHub secret in CI. Never commit it.
  EOT
  type        = string
  default     = null
  sensitive   = true

  validation {
    # Compares emptiness rather than nullness for the same reason as iap.tf: in
    # CI these arrive as "" when the secret is not set, never as null.
    condition     = ((var.iap_oauth_client_id == null ? "" : trimspace(var.iap_oauth_client_id)) == "") == ((var.iap_oauth_client_secret == null ? "" : trimspace(var.iap_oauth_client_secret)) == "")
    error_message = "Set both iap_oauth_client_id and iap_oauth_client_secret, or neither: IAP needs the pair."
  }
}

variable "admin_domain" {
  description = <<-EOT
    Custom domain for the admin service, e.g. "admin.hector.golf".

    Leave unset until `gcloud domains verify hector.golf` has succeeded — mapping
    a subdomain requires the base domain to be verified, and an apply before that
    fails. `gcloud domains list-user-verified` shows whether it has.

    Verification is per account rather than per project, so the terraform-ci
    service account also has to be an owner of the domain in Search Console. See
    the custom domain section of docs/playbooks/gcp-bootstrapping.md.

    Once applied, `terraform output admin_dns_records` prints the records to add
    at the registrar.
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

    Two means the running build and the one before it. A rollback goes exactly
    one deploy back; two deploys back is a rebuild from the tag, not a traffic
    split. That is the intended trade — this is a site two people administer a
    few times a month, and storage is billed against a budget of about a euro.
  EOT
  type        = number
  default     = 2
}

variable "enable_budget_alert" {
  description = <<-EOT
    Whether to manage the billing budget alert here. Off by default, because it
    needs permissions on the *billing account* rather than the project, which
    terraform-ci deliberately does not have.

    Leave it false and create the budget with `gcloud` — step 9 of the playbook
    has the command. Setting it true *locally only* is the one thing not to do:
    the budget enters state, CI reads this default because terraform.tfvars is
    gitignored and never reaches it, and the next plan proposes destroying what
    you just created — after failing to refresh it for want of billing
    permissions.

    Managing it here means setting it true in CI too, which means granting
    terraform-ci roles/billing.costsManager. That is a CI identity able to
    rewrite billing, in exchange for one resource that is set once.
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
  description = <<-EOT
    Monthly budget in EUR that triggers the alert thresholds.

    Raised from 1 to 2 when the Cloud Functions moved into this project. They
    call Gemini, and `GeneratePlayerAvatar` calls `gemini-2.5-flash-image`,
    which is not free. At €1 the 50% threshold was going to fire on ordinary
    use, and a budget alert that cries wolf is worse than no budget alert: it
    trains you to close the mail without reading it.

    The thresholds are percentages, so this one number moves all three.
  EOT
  type        = number
  default     = 2
}
