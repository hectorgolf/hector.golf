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

  # A KEEP policy does not delete anything. It only exempts artifacts from a
  # DELETE policy — "when an artifact matches the criteria for both a delete
  # policy and a keep policy, the artifact is kept". So `keep-recent` below is a
  # floor, not a broom, and something has to sweep.
  #
  # This used to be the only DELETE policy and it was conditioned on UNTAGGED,
  # which matches nothing here: the deploy workflow tags every image with a
  # commit SHA, so no version is ever untagged and nothing was ever deleted. The
  # repository grew from every merge for as long as it existed.
  #
  # ANY, with no age condition, because the retention we want is a count and not
  # a duration: keep the last N builds, drop the rest at the next sweep. An
  # `older_than` here would mean "N, or everything from the last X days,
  # whichever is more", which on a busy day is a lot of gigabytes to pay for.
  cleanup_policies {
    id     = "delete-superseded"
    action = "DELETE"
    condition {
      tag_state = "ANY"
    }
  }

  # The floor. var.artifact_keep_count is effectively the rollback window: a
  # revision whose image has been swept still exists, but cannot start.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = var.artifact_keep_count
    }
  }

  # Belt as well as braces, and cheap. `delete-superseded` matches everything, so
  # the live image is safe only because `keep-recent` exempts it — and if that
  # policy were ever removed or its count set to zero, the sweep would take the
  # image the serving revision pulls on its next cold start. The service scales
  # to zero, so "next cold start" is soon, and the failure would look like the
  # site going down for no deployed reason. The deploy workflow pushes `latest`
  # alongside the SHA tag, so this always names the newest build.
  #
  # A separate policy because Artifact Registry does not allow a conditional keep
  # and a most-recent-versions keep in the same one.
  cleanup_policies {
    id     = "keep-latest"
    action = "KEEP"
    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["latest"]
    }
  }

  depends_on = [google_project_service.enabled["artifactregistry.googleapis.com"]]
}
