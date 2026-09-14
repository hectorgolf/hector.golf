locals {
  services = [
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "iap.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    # The leaderboard scrape reads two spreadsheets. This is the one API here
    # that is not enabled for the sake of a resource in this directory: nothing
    # in terraform/ calls Sheets, and nothing here can, because a spreadsheet is
    # shared with an email address rather than granted by IAM. It is enabled
    # because the *consumer project* of a service account's calls is the project
    # the account lives in, so leaderboard-reader cannot call Sheets from
    # hector-golf until hector-golf has the API on.
    #
    # It was invisible before the move off the downloadable key, because the old
    # identity lived in gen-lang-client-… where it was already enabled. Without
    # this, both sheets fail with a SERVICE_DISABLED 403 that names a project
    # number rather than the sharing problem you would go looking for.
    "sheets.googleapis.com",
    "sts.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  project = var.project_id
  service = each.value

  # Leave the API enabled when the resource goes away. Disabling an API can
  # cascade into deleting the resources built on it, which is more than any
  # single `terraform destroy` should be able to reach.
  disable_on_destroy         = false
  disable_dependent_services = false
}
