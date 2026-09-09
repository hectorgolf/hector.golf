resource "google_artifact_registry_repository" "admin" {
  project       = var.project_id
  location      = var.region
  repository_id = "hector-admin"
  format        = "DOCKER"
  description   = "Container images for the hector.golf admin service"

  # Set to true to have the cleanup policies report what they would delete
  # without deleting it. Results only appear in Data Access audit logs, and the
  # background job takes about a day, so this is a slow feedback loop — see the
  # playbook before relying on it.
  cleanup_policy_dry_run = false

  # Which of these two does the work depends on how images are tagged. The
  # deploy workflow tags by commit SHA, so versions stay TAGGED forever and
  # `keep-recent` is the policy that actually prunes; `delete-untagged` is there
  # for anything pushed as a floating tag by hand.
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "7d"
    }
  }

  # KEEP beats DELETE, so this is a floor the delete policy cannot cut through.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = var.artifact_keep_count
    }
  }

  depends_on = [google_project_service.enabled["artifactregistry.googleapis.com"]]
}
