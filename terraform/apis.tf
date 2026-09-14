locals {
  services = [
    # Creating the Gemini API key with gcloud, in phase 2 of the functions
    # migration. Nothing in terraform/ manages the key itself — it is a
    # credential, and credentials do not go in state.
    "apikeys.googleapis.com",
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    # A gen2 function is built from source by a buildpack, which is a Cloud
    # Build job, and the resulting image lands in Artifact Registry above. All
    # three are needed to deploy one, even though only cloudfunctions is the API
    # anybody calls by name.
    "cloudbuild.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "firestore.googleapis.com",
    # The Gemini API the three AI functions call. This one is easy to argue
    # yourself out of, so: the functions authenticate to it with an API *key*,
    # and it is true that a key is a bearer credential which does not care where
    # the caller runs. What it does care about is which project the key belongs
    # to, because that is the consumer project the call is billed and quota'd
    # against — and phase 2 mints the key here.
    #
    # Same trap as sheets.googleapis.com below, which had to be added in a
    # follow-up commit for exactly this reason. It fails as a 403
    # SERVICE_DISABLED naming a project number, which reads like a permissions
    # problem rather than a missing line in this list.
    "generativelanguage.googleapis.com",
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
