# IAP reaches the service as its own service agent, so that agent needs to be
# allowed to invoke it. Without this binding the sign-in succeeds and the
# service then answers "Your client does not have permission to get URL".
resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.admin.location
  name     = google_cloud_run_v2_service.admin.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-iap.iam.gserviceaccount.com"
}

# Who is allowed through the front door. IAP is deny by default: with
# admin_principals empty, nobody gets in — including you.
resource "google_iap_web_cloud_run_service_iam_member" "admins" {
  for_each = toset(var.admin_principals)

  project                = var.project_id
  location               = google_cloud_run_v2_service.admin.location
  cloud_run_service_name = google_cloud_run_v2_service.admin.name
  role                   = "roles/iap.httpsResourceAccessor"
  member                 = each.value
}

# The custom OAuth client IAP authenticates with.
#
# Two independent reasons make a custom client the only supported shape here,
# rather than a workaround for one: this project is not in a Google Cloud
# organization, and every Hector admin signs in with a personal Google account,
# which is an *external* user. Google's managed client covers neither case, so
# putting the project into an organization would not remove the requirement.
#
# The client itself is created in the console — see step 5 of the playbook. The
# IAP OAuth Admin APIs were shut down in March 2026 and google_iap_brand needs
# an organization, so neither the consent screen nor the client can be created
# from here. What this resource does is record *which* client the service uses,
# so a project rebuilt from this directory comes back working rather than
# answering "Empty Google Account OAuth client ID(s)/secret(s)".
#
# Left out of the plan until the credentials exist, so that the first apply on
# a new project — which necessarily happens before the client does — is not
# blocked by a chicken-and-egg.
resource "google_iap_settings" "admin" {
  count = var.iap_oauth_client_id == null ? 0 : 1

  name = "projects/${data.google_project.this.number}/iap_web/cloud_run-${var.region}/services/${google_cloud_run_v2_service.admin.name}"

  access_settings {
    oauth_settings {
      client_id     = var.iap_oauth_client_id
      client_secret = var.iap_oauth_client_secret
    }
  }

  # Destroying this resets IAP's settings, which locks everyone out of a service
  # that is otherwise still running. Drop it from state and leave the live
  # settings alone instead.
  deletion_policy = "ABANDON"
}
