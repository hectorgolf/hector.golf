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
    "roles/iam.serviceAccountUser",          # attach the runtime SA to Cloud Run
    "roles/iam.workloadIdentityPoolAdmin",   # keep github_oidc.tf from drifting
    "roles/resourcemanager.projectIamAdmin", # the project-level bindings in this file
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
# managed by it. See docs/gcp-setup-playbook.md, step 2.

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
