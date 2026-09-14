# ---------------------------------------------------------------------------
# Runtime identity: what the admin service itself is, at rest.
# ---------------------------------------------------------------------------

resource "google_service_account" "admin_runtime" {
  project      = var.project_id
  account_id   = "hector-admin"
  display_name = "hector.golf admin service (runtime)"
  description  = "Identity the admin Cloud Run service runs as. Reads and writes Firestore; nothing else."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]

}

# datastore.user is read/write on documents but cannot create, delete or
# reconfigure a database. The service should not be able to drop its own store.
resource "google_project_iam_member" "admin_runtime_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = google_service_account.admin_runtime.member
}

# ---------------------------------------------------------------------------
# Terraform's own identity in CI.
#
# The role list is explicit rather than roles/editor so that the blast radius of
# a compromised GitHub Actions run is legible. Every role here exists because
# something in this directory needs it; if you add a resource type, add its role
# and say why.
# ---------------------------------------------------------------------------

resource "google_service_account" "terraform_ci" {
  project      = var.project_id
  account_id   = "terraform-ci"
  display_name = "Terraform (GitHub Actions)"
  description  = "Plans and applies terraform/ from CI. Authenticates by Workload Identity Federation; holds no key."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]

}

locals {
  terraform_ci_roles = [
    "roles/serviceusage.serviceUsageAdmin", # enable the APIs in apis.tf
    "roles/datastore.owner",                # create and configure the Firestore database
    "roles/artifactregistry.admin",         # the image repo and its cleanup policies
    "roles/run.admin",                      # the admin Cloud Run service
    # These two are not interchangeable and neither implies the other, which is
    # easy to get wrong because the names suggest otherwise: iap.admin carries
    # only *.getIamPolicy and *.setIamPolicy (who may sign in), while the
    # settings on the service itself — the OAuth client in iap.tf — live behind
    # iap.settingsAdmin's *.getSettings and *.updateSettings.
    "roles/iap.admin",                       # google_iap_web_cloud_run_service_iam_member
    "roles/iap.settingsAdmin",               # google_iap_settings
    "roles/iam.serviceAccountAdmin",         # create the service accounts above
    "roles/iam.serviceAccountUser",          # attach the runtime SA to Cloud Run, and the scheduler SA to its jobs
    "roles/iam.workloadIdentityPoolAdmin",   # keep github_oidc.tf from drifting
    "roles/resourcemanager.projectIamAdmin", # the project-level bindings in this file
    # The secret container in secrets.tf and the binding on it. There is no role
    # that can create a secret without also being able to read it, so this does
    # mean a Terraform CI run can read the GitHub token. That is the same trade
    # already made for admin_deployer below and holds for the same reason: this
    # identity has run.admin and can act as the runtime service account, so it
    # can already read the token by deploying a container that does. Granting it
    # directly adds convenience rather than reach. Terraform still never creates
    # a secret *version*, so the token stays out of state.
    "roles/secretmanager.admin",
    "roles/cloudscheduler.admin", # the jobs in scheduler.tf
  ]
}

resource "google_project_iam_member" "terraform_ci" {
  for_each = toset(local.terraform_ci_roles)

  project = var.project_id
  role    = each.value
  member  = google_service_account.terraform_ci.member
}

# Access to the state bucket is granted in the bootstrap step rather than here,
# because the bucket is created before Terraform runs and is deliberately not
# managed by it. See docs/playbooks/gcp-bootstrapping.md, step 2.

# ---------------------------------------------------------------------------
# The application deploy identity: builds and ships the admin container, and
# can do nothing else. Separate from terraform-ci so that shipping application
# code does not require an identity that can rewrite the infrastructure.
# ---------------------------------------------------------------------------

resource "google_service_account" "admin_deployer" {
  project      = var.project_id
  account_id   = "admin-deployer"
  display_name = "hector.golf admin deploy (GitHub Actions)"
  description  = "Pushes admin images and rolls out Cloud Run revisions. Cannot change infrastructure."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]

}

resource "google_project_iam_member" "admin_deployer_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = google_service_account.admin_deployer.member
}

resource "google_artifact_registry_repository_iam_member" "admin_deployer_push" {
  project    = var.project_id
  location   = google_artifact_registry_repository.admin.location
  repository = google_artifact_registry_repository.admin.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.admin_deployer.member
}

# Deploying a service that runs as another identity means acting as it. Scoped
# to the one runtime service account rather than granted project-wide.
# Firestore documents, for the two workflows that move data in and out:
# export-admin-data.yml reads, and refresh-admin-mirror.yml writes the scraped
# players and Hector events back into the mirror the admin UI reads.
#
# This was datastore.viewer when only the export existed. The refresh needs to
# write, so it is datastore.user now — read and write documents, but not create,
# delete or reconfigure a database, the same ceiling the runtime identity has.
#
# On this service account rather than a separate one, because the separation
# would be decorative rather than real: admin_deployer holds run.developer over
# the admin service and serviceAccountUser over its runtime identity, which has
# datastore.user. It can therefore already write any document by deploying a
# container that does. Granting it directly adds convenience, not reach. If that
# stops being true — if the deployer ever loses the ability to act as the runtime
# identity — this should become its own service account.
resource "google_project_iam_member" "admin_deployer_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = google_service_account.admin_deployer.member
}

resource "google_service_account_iam_member" "admin_deployer_act_as" {
  service_account_id = google_service_account.admin_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.admin_deployer.member
}

# ---------------------------------------------------------------------------
# The Google Sheets read identity: update-leaderboards.yml, and nothing else.
#
# Deliberately holds NO project roles. Sheets access is not granted by GCP IAM
# at all — it comes from sharing the spreadsheet with this account's email
# address — so there is nothing for a google_project_iam_member to usefully say
# here. If a change appears to need one, that is a sign something other than
# reading a spreadsheet is being asked of this identity.
#
# It replaces update-hector-leaderboard@gen-lang-client-…, which authenticated
# with a downloadable JSON key and carried secretmanager.secretAccessor and
# cloudbuild.builds.builder left over from a deleted Cloud Function. See
# docs/plans/sheets-credential-wif.md.
# ---------------------------------------------------------------------------

resource "google_service_account" "leaderboard_reader" {
  project      = var.project_id
  account_id   = "leaderboard-reader"
  display_name = "Reads tournament leaderboards from Google Sheets"
  description  = "Read-only Google Sheets scrape for update-leaderboards.yml. Authenticates by Workload Identity Federation; holds no key and no project roles."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]

}

# Lets a human run the scrape locally as this exact identity:
#
#   gcloud auth application-default login \
#     --impersonate-service-account=<the leaderboard_service_account output>
#
# Which matters because the alternative — running as yourself — proves less: you
# own the spreadsheets, so a local run passes whether or not the sheets have
# been shared with the service account, and a sharing mistake then shows up only
# in Actions.
resource "google_service_account_iam_member" "leaderboard_reader_impersonation" {
  for_each = toset(var.leaderboard_reader_impersonators)

  service_account_id = google_service_account.leaderboard_reader.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
}

# ---------------------------------------------------------------------------
# The Cloud Functions identities: one the four functions run as, one that
# deploys them. Phase 1 of docs/plans/functions-migration.md.
#
# Same runtime/deployer split as admin_runtime and admin_deployer above, and for
# the same reason: shipping a new version of a function should not require an
# identity that can change infrastructure.
#
# Terraform deliberately does not manage the functions themselves. There is no
# google_cloudfunctions2_function here and there should not be — deploying a new
# version must not require a `terraform apply`, so CI ships them wholesale with
# `gcloud`, exactly as deploy-admin.yml ships Cloud Run revisions while
# Terraform owns the service.
# ---------------------------------------------------------------------------

# No project roles, like leaderboard_reader and for a similar reason: none of
# the four functions calls a Google API with this identity. The three AI
# functions authenticate to Gemini with an API key, and TournamentLeaderboard is
# an HTTP proxy to app.hector.golf. All this account does is read the three
# secrets granted in secrets.tf.
resource "google_service_account" "functions_runtime" {
  project      = var.project_id
  account_id   = "hector-functions"
  display_name = "hector.golf Cloud Functions (runtime)"
  description  = "Identity the four functions run as. Reads three secrets; nothing else."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]

}

resource "google_service_account" "functions_deployer" {
  project      = var.project_id
  account_id   = "functions-deployer"
  display_name = "hector.golf functions deploy (GitHub Actions)"
  description  = "Deploys the Cloud Functions. Cannot change infrastructure."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]

}

# Deliberately the *minimum* rather than the list in deploy-functions.yml's
# header, which was written for a cross-project setup and names six roles. Start
# here and add only what a failed deploy actually names; a role added because a
# real error asked for it comes with the reason attached, and one added
# speculatively never gets removed.
#
# In particular, do NOT reach for roles/storage.objectAdmin. It is the obvious
# way to let a deployer upload source, and here it would be a mistake: the
# Terraform state bucket hector-golf-tfstate is in this same project, so a
# project-wide storage role hands the application deploy identity the
# infrastructure state. It is also unnecessary — `gcloud functions deploy`
# uploads through a signed URL it gets from generateUploadUrl, which
# cloudfunctions.developer already covers.
#
# The likeliest genuine addition is serviceAccountUser on the Cloud Build
# builder identity, since a gen2 deploy runs a build as it. Wait for the error.
resource "google_project_iam_member" "functions_deployer_deploy" {
  project = var.project_id
  role    = "roles/cloudfunctions.developer"
  member  = google_service_account.functions_deployer.member
}

# Deploying a function that runs as another identity means acting as it. Scoped
# to the one runtime account rather than granted project-wide, as with
# admin_deployer_act_as above.
resource "google_service_account_iam_member" "functions_deployer_act_as" {
  service_account_id = google_service_account.functions_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.functions_deployer.member
}

# ---------------------------------------------------------------------------
# The build identity.
#
# A gen2 deploy runs a Cloud Build job, and the deployer has to be able to act
# as whatever identity that build runs as. Left alone, that is the project's
# default compute service account — which carries roles/editor, granted by
# Google when the API was enabled and not by anything here.
#
# Going along with that is the obvious fix and the wrong one. The first deploy
# failed with exactly the error that invites it:
#
#   Caller is missing permission 'iam.serviceaccounts.actAs' on service account
#   …-compute@developer.gserviceaccount.com
#
# Granting functions_deployer serviceAccountUser on an editor-privileged account
# would let it run a build as project editor, which is most of what
# roles/editor can do and is flatly at odds with this account's own description:
# "Deploys the Cloud Functions. Cannot change infrastructure." The same argument
# as the storage.objectAdmin note above — the convenient grant reaches much
# further than the thing being asked for.
#
# So the build gets its own identity, named explicitly with
# --build-service-account, holding one role.
# ---------------------------------------------------------------------------

resource "google_service_account" "functions_builder" {
  project      = var.project_id
  account_id   = "functions-builder"
  display_name = "hector.golf Cloud Functions (build)"
  description  = "Identity the gen2 buildpack builds run as. Holds cloudbuild.builds.builder and nothing else."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]

}

# The role Google documents for a user-managed Cloud Build service account. It
# is a bundle — logging, reading the uploaded source, writing the built image to
# Artifact Registry — and it is the supported floor rather than a convenience:
# a build cannot report its own result without it.
resource "google_project_iam_member" "functions_builder_build" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.builder"
  member  = google_service_account.functions_builder.member
}

# The actAs the failed deploy was asking for, pointed at this account instead of
# at the default compute one. Scoped to the single service account, as with
# functions_deployer_act_as above.
resource "google_service_account_iam_member" "functions_deployer_act_as_builder" {
  service_account_id = google_service_account.functions_builder.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.functions_deployer.member
}
