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
